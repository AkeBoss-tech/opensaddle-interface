"""Disposable local Core fixture for the Interface agent setup journey.

Run with OPENSADDLE_BROWSER_FIXTURE_TOKEN set to a throwaway value. This serves
only loopback, keeps all state under a temporary directory, and never contacts
an external provider. Stop the process to remove the fixture state.
"""
from __future__ import annotations

import argparse
from dataclasses import replace
from hashlib import sha256
import os
from pathlib import Path
import subprocess
import tempfile

import uvicorn
from fastapi.testclient import TestClient

from opensaddle.control_plane.api import ControlPlaneSettings, create_control_plane_app
from opensaddle.control_plane.agent_research import MediaWikiSearchAdapter
from opensaddle.control_plane.auth import LocalBootstrapAuthenticator
from opensaddle.control_plane.connectors import GitHubReadOnlyBroker
from opensaddle.control_plane.local_project_bridge import bridge_registered_local_project
from opensaddle.control_plane.personal_knowledge import configure_personal_knowledge
from opensaddle.control_plane.personal_runtime import PersonalLocalPolicyEngine
from opensaddle.control_plane.policy import RolePolicyEngine
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
    def evaluate_run(self, principal, **kwargs):
        decision = super().evaluate_run(principal, **kwargs)
        return replace(decision, obligations={**decision.obligations, "connector_actions": {"github": ["get_repository"]}})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8767)
    parser.add_argument("--research-provider", choices=("none", "mediawiki"), default="none")
    parser.add_argument("--reviewed-memory", action="store_true", help="seed one reviewed local test note")
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
                if args.reviewed_memory else FixturePolicy()), worker_credential_pepper="fixture-worker-pepper-32-characters",
            agent_session_pepper="fixture-agent-pepper-32-characters", connectors={"github": broker},
            agent_research_adapter=research_adapter,
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
            store.create_source(project_id=project, source_kind="git", revision="fixture-rev-1",
                                snapshot_digest=sha256(b"browser fixture source").hexdigest(), created_by="fixture-owner")
        print(f"READY http://127.0.0.1:{args.port} project=browser-fixture", flush=True)
        try:
            uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
        finally:
            if research_adapter is not None:
                research_adapter.close()


if __name__ == "__main__":
    main()
