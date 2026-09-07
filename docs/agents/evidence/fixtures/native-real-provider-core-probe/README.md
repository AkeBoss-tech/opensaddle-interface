# Native provider Core probe

These probes require a disposable Core fixture with a mode-0600 `fixture.json` containing `base_url`, `project_id`, `source_id`, `worker_id`, `worker_credential_path`, `member_token_path`, and `workspace`. The workspace must contain the synthetic `FACT.txt`. Set `OPENSADDLE_NATIVE_EVIDENCE_DIR` to that private directory. Never stage its metadata or tokens.

`create_run.py` creates the bounded member-owned Run. `run_codex_worker.py` composes the production Core worker classes with the installed Codex app server and explicit `gpt-5.6-sol`. Use the public Run/artifact endpoints as member and owner to verify terminal state and identical artifact bytes. Claude uses the production `opensaddle serve-claude-worker ... --once` command with the same fixture shape and its own enrolled worker credential.
