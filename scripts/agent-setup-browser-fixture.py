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
import tempfile

import uvicorn

from opensaddle.control_plane.api import ControlPlaneSettings, create_control_plane_app
from opensaddle.control_plane.agent_research import MediaWikiSearchAdapter
from opensaddle.control_plane.auth import LocalBootstrapAuthenticator
from opensaddle.control_plane.connectors import GitHubReadOnlyBroker
from opensaddle.control_plane.policy import RolePolicyEngine
from opensaddle.control_plane.secret_leases import DeterministicSecretLeaseIssuer


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
    args = parser.parse_args()
    token = os.environ.get("OPENSADDLE_BROWSER_FIXTURE_TOKEN", "")
    if len(token) < 16:
        raise SystemExit("Set a throwaway 16+ character OPENSADDLE_BROWSER_FIXTURE_TOKEN")
    with tempfile.TemporaryDirectory(prefix="opensaddle-agent-browser-") as directory:
        root = Path(directory)
        research_adapter = MediaWikiSearchAdapter() if args.research_provider == "mediawiki" else None
        lease = DeterministicSecretLeaseIssuer()
        broker = GitHubReadOnlyBroker(FixtureRepository(), FixtureRepositoryAccess(), lease)
        app = create_control_plane_app(ControlPlaneSettings(
            database_path=root / "control.db", authenticator=LocalBootstrapAuthenticator("fixture-owner", token),
            policy_engine=FixturePolicy(), worker_credential_pepper="fixture-worker-pepper-32-characters",
            agent_session_pepper="fixture-agent-pepper-32-characters", connectors={"github": broker},
            agent_research_adapter=research_adapter,
            secret_lease_issuer=lease, allowed_origins=("http://127.0.0.1:5176", "http://localhost:5176"),
        ))
        store = app.state.run_store
        store.create_project("browser-fixture", "fixture-owner")
        store.create_source(project_id="browser-fixture", source_kind="git", revision="fixture-rev-1",
                            snapshot_digest=sha256(b"browser fixture source").hexdigest(), created_by="fixture-owner")
        print(f"READY http://127.0.0.1:{args.port} project=browser-fixture", flush=True)
        try:
            uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
        finally:
            if research_adapter is not None:
                research_adapter.close()


if __name__ == "__main__":
    main()
