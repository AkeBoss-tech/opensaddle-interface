"""Disposable local Core fixture for the Interface agent setup journey.

Run with OPENSADDLE_BROWSER_FIXTURE_TOKEN set to a throwaway value. This serves
only loopback, keeps all state under a temporary directory, and never contacts
an external provider. Stop the process to remove the fixture state.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from hashlib import sha256
import base64
import os
from pathlib import Path
import subprocess
import tempfile
import threading

import httpx
import uvicorn
from fastapi.testclient import TestClient

from opensaddle.control_plane.api import ControlPlaneSettings, create_control_plane_app
from opensaddle.control_plane.agent_research import MediaWikiSearchAdapter
from opensaddle.control_plane.auth import LocalBootstrapAuthenticator
from opensaddle.control_plane.artifact_blobs import ScopedLocalArtifactBlobStore
from opensaddle.control_plane.connectors import GitHubReadOnlyBroker
from opensaddle.control_plane.local_project_bridge import bridge_registered_local_project
from opensaddle.control_plane.personal_knowledge import configure_personal_knowledge
from opensaddle.control_plane.personal_runtime import PersonalLocalPolicyEngine
from opensaddle.control_plane.policy import PolicyOutcome, RolePolicyEngine
from opensaddle.control_plane.secret_leases import DeterministicSecretLeaseIssuer
from opensaddle.project_service import ProjectService


class FixtureRepository:
    name = "github"

    def invoke(self, action, arguments):
        return {"full_name": f"{arguments['owner']}/{arguments['repo']}", "private": False, "fixture": True}


class FixtureRepositoryAccess:
    def authorize(self, connector, action, arguments):
        return connector == "github" and action == "get_repository" and arguments == {"owner": "fixture", "repo": "public"}


class FixturePolicy(RolePolicyEngine):
    def __init__(self, require_approval=False):
        self.require_approval = require_approval

    def evaluate_run(self, principal, **kwargs):
        decision = super().evaluate_run(principal, **kwargs)
        return replace(decision, outcome=PolicyOutcome.APPROVAL_REQUIRED if self.require_approval and decision.outcome is PolicyOutcome.ALLOW else decision.outcome,
                       obligations={**decision.obligations, "connector_actions": {"github": ["get_repository"]}})


def fixture_worker(base_url, credential, stop):
    """Run one provider-free task through the real worker and scoped connector HTTP routes."""
    worker = "fixture-worker"
    headers = {"authorization": "Bearer " + credential}
    with httpx.Client(base_url=base_url, timeout=10) as client:
        while not stop.is_set():
            claimed_run = None
            try:
                claimed = client.post(f"/api/v2/workers/{worker}/claim", headers=headers)
                if claimed.status_code == 204:
                    stop.wait(0.25)
                    continue
                claimed.raise_for_status()
                run = claimed.json()
                run_id, epoch = run["run_id"], run["lease_epoch"]
                claimed_run = run_id
                path = f"/api/v2/workers/{worker}/runs/{run_id}"
                started = client.post(path + "/start", headers=headers, json={"lease_epoch": epoch})
                started.raise_for_status()
                assignment = client.get(path + "/participant-assignment", headers=headers,
                                        params={"lease_epoch": epoch})
                assignment.raise_for_status()
                message_id = assignment.json()["message_id"]
                session = client.post(path + "/agent-sessions", headers=headers, json={
                    "message_id": message_id, "lease_epoch": epoch, "harness_id": "codex"})
                session.raise_for_status()
                scoped = {"authorization": "Bearer " + session.json()["token"],
                          "idempotency-key": "fixture-read"}
                read = client.post("/api/v2/agent-session/connectors/github/get_repository",
                                   headers=scoped, json={"arguments": {"owner": "fixture", "repo": "public"}})
                read.raise_for_status()
                data = b"Fixture-only result: the scoped repository read returned fixture/public. No model or external provider ran."
                result = client.post(path + "/result", headers=headers, json={
                    "lease_epoch": epoch, "idempotency_key": "fixture-result",
                    "content_digest": sha256(data).hexdigest(),
                    "content_base64": base64.b64encode(data).decode("ascii")})
                result.raise_for_status()
                completed = client.post(path + "/complete", headers=headers,
                                        json={"lease_epoch": epoch, "succeeded": True})
                completed.raise_for_status()
                print(f"FIXTURE_RUN_COMPLETED {run_id}", flush=True)
            except (httpx.HTTPError, KeyError, ValueError) as exc:
                print(f"FIXTURE_WORKER_UNAVAILABLE phase={'after_claim' if claimed_run else 'before_claim'} {type(exc).__name__}", flush=True)
                if claimed_run:
                    return  # A dispatched fixture read may have occurred; never replay automatically.
                stop.wait(0.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--research-provider", choices=("none", "mediawiki"), default="none")
    parser.add_argument("--reviewed-memory", action="store_true", help="seed one reviewed local test note")
    parser.add_argument("--approval-worker", action="store_true", help="require task review, then use a provider-free fixture worker")
    args = parser.parse_args()
    token = os.environ.get("OPENSADDLE_BROWSER_FIXTURE_TOKEN", "")
    if len(token) < 16:
        raise SystemExit("Set a throwaway 16+ character OPENSADDLE_BROWSER_FIXTURE_TOKEN")
    with tempfile.TemporaryDirectory(prefix="opensaddle-agent-browser-") as directory:
        root = Path(directory)
        research_adapter = MediaWikiSearchAdapter() if args.research_provider == "mediawiki" else None
        project = "browser-fixture"
        workspace = root / "repository"
        registry = None
        source = None
        if args.reviewed_memory:
            workspace.mkdir()
            (workspace / "README.md").write_text("# Fixture note\nReview this local test note. Codeword MINT-SKY-42.\n")
            subprocess.run(["git", "init", "-q", str(workspace)], check=True)
            subprocess.run(["git", "-C", str(workspace), "add", "README.md"], check=True)
            subprocess.run(["git", "-C", str(workspace), "-c", "user.name=Fixture", "-c",
                            "user.email=fixture@example.invalid", "commit", "-qm", "Fixture note"], check=True)
            registry = ProjectService(root / "projects.db")
            registry.register_project(project, workspace)
        lease = DeterministicSecretLeaseIssuer()
        broker = GitHubReadOnlyBroker(FixtureRepository(), FixtureRepositoryAccess(), lease)
        settings = ControlPlaneSettings(
            database_path=root / "control.db", authenticator=LocalBootstrapAuthenticator("fixture-owner", token),
            policy_engine=(PersonalLocalPolicyEngine(owner_subject="fixture-owner", project_id=project,
                resource_demand={"cpu_millicores": 100, "memory_mib": 64, "concurrency": 1})
                if args.reviewed_memory else FixturePolicy(require_approval=args.approval_worker)), worker_credential_pepper="fixture-worker-pepper-32-characters",
            agent_session_pepper="fixture-agent-pepper-32-characters", connectors={"github": broker},
            agent_research_adapter=research_adapter,
            artifact_blob_store=ScopedLocalArtifactBlobStore(root / "blobs") if args.approval_worker else None,
            secret_lease_issuer=lease, local_project_registry=registry,
            allowed_origins=("http://127.0.0.1:5176", "http://localhost:5176"),
        )
        app = create_control_plane_app(settings)
        store = app.state.run_store
        store.create_project(project, "fixture-owner")
        if args.reviewed_memory:
            source = bridge_registered_local_project(registry=registry, run_store=store, local_project_id=project,
                project_id=project, created_by="fixture-owner")["source"]
            configure_personal_knowledge(settings=settings, store=store, installation_id="fixture-installation",
                owner_subject="fixture-owner", project_id=project, workspace=workspace, state_root=root / "knowledge")
            with TestClient(app) as client:
                headers = {"authorization": "Bearer " + token}
                path = f"/api/v2/projects/{project}/retained-evidence"
                assert client.post(path + "/setup", headers=headers, json={"setup_id": "fixture-once"}).status_code == 201
                captured = client.post(path + "/captures", headers=headers, json={
                    "capture_id": "note", "path": "README.md", "commit": source["revision"]})
                assert captured.status_code == 201, captured.text
                reviewed = client.post(path + "/captures/note/review", headers=headers, json={
                    "review_id": "fixture-note-review", "expected_content_digest": captured.json()["content_digest"]})
                assert reviewed.status_code == 201, reviewed.text
        else:
            source = store.create_source(project_id=project, source_kind="git", revision="fixture-rev-1",
                                         snapshot_digest=sha256(b"browser fixture source").hexdigest(), created_by="fixture-owner")
        worker_stop = threading.Event()
        worker_thread = None
        if args.approval_worker:
            store.register_worker(worker_id="fixture-worker", organization_id="local",
                                  project_ids=frozenset({project}), runtime_kind="remote_worker",
                                  registered_by="fixture-owner")
            credential = store.issue_worker_credential("fixture-worker", issued_by="fixture-owner",
                                                       pepper="fixture-worker-pepper-32-characters")
            now = datetime.now(timezone.utc)
            store.report_native_adapter_readiness("fixture-worker", project_id=project, payload={
                "adapter_id": "codex-app-server", "source_id": source["source_id"],
                "revision": source["revision"], "digest": source["snapshot_digest"],
                "executable_state": "installed", "executable_version": "fixture", "authentication_state": "authenticated",
                "account_mode": "fixture", "protocol_state": "compatible", "protocol_version": "app-server-v1",
                "workspace_state": "configured", "ready": True, "reason": None,
                "observed_at": now.isoformat(), "expires_at": (now + timedelta(minutes=8)).isoformat()})
            worker_thread = threading.Thread(target=fixture_worker,
                                             args=(f"http://127.0.0.1:{args.port}", credential["token"], worker_stop),
                                             daemon=True)
            worker_thread.start()
        print(f"READY http://127.0.0.1:{args.port} project=browser-fixture", flush=True)
        try:
            uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
        finally:
            worker_stop.set()
            if worker_thread is not None:
                worker_thread.join(timeout=3)
            if research_adapter is not None:
                research_adapter.close()


if __name__ == "__main__":
    main()
