# Real native providers through Core 8941

Date: 2026-09-07

## Boundary

A private disposable loopback Core and synthetic workspace exercised installed provider CLIs through the production `OutboundWorkerClient`, `FencedWorkerLoop`, native executors, public worker lease/result endpoints, artifact store, and member/owner authorization. No generated provider executable, provider API key, login change, auth-file read, GUI automation, or production data was used. Visible GUI proof remains pending because macOS was locked; no bypass was attempted.

The exact synthetic file was `The exact fixture fact is: SADDLE-CERULEAN-7429.`

## Codex success

- Installed tool: `codex-cli 0.147.0`, existing ChatGPT authentication.
- Requested model: `gpt-5.6-sol` through the app-server command configuration.
- Core source base: `780e5b120136cd7335235e4bc0c64c821871bf44` with the checkout's then-active uncommitted capacity work. The durable dispatch began at `2026-09-07T23:28:40.764616Z`; Git reflog shows `780e5b1` remained HEAD until `2026-09-07T23:29:01Z`, when `2765223` was committed. The Core and worker Python processes loaded their modules before that later commit. This was a live checkout, not an immutable archive; the commit and timestamps establish the loaded base but cannot reproduce the uncommitted bytes by themselves.
- Run `run_9ac02abb528d47da8be3ad37106155ec` was claimed and started by `native-real-codex-worker` at lease epoch 1.
- The real provider returned exactly `SADDLE-CERULEAN-7429`.
- Core reached `completed` and published artifact `art_e520f4226bfb4aa59ba9bcc05365b36f`.
- Artifact bytes and recorded digest both equal SHA-256 `05b239bd7ff499d76bd6eef4a79337eafdfe0ac5f1f59124730c890623da1ff4`.
- The requesting member and a second authorized owner each read the completed Run through public Core APIs with HTTP 200.
- The durable native row records attempt 1, `codex-app-server`, `app-server-v1`, `completed`, the same digest, and no error class.

The fixture wrapper initially raised `AttributeError` only while printing a nonexistent `WorkerLoopResult.completed` field after `run_once()` returned. Core and the native row had already completed. The preserved probe uses the real `status` and `fenced` fields.

## Codex cancellation

A second real turn reached Core `running`. The member called the public cancel endpoint; Core returned HTTP 200 and converged to `cancelled`. The next worker renewal received 409, the worker returned fenced `effect_unknown`, and no artifact was published.

The native row remains `effect_unknown` with `authority_changed_after_dispatch`, no result digest. This proves the lease fence prevents late publication, but the current composition does not persist an affirmative provider `turn/completed(status=interrupted)` receipt. Successful provider thread identity is also absent from the native row (`provider_session_id` remained null), limiting resume/provenance proof.

## Claude attempt

- Installed tool: Claude Code `2.1.263`.
- A bounded coarse status probe returned `loggedIn:true`, `authMethod:claude.ai`, `apiProvider:firstParty`; no account details or auth files were read and no login action occurred.
- Core source revision: `d43283383af20db822ff1c0af6952e4e2e254d41`; active uncommitted Core39 work had diff SHA-256 `ff0a53a9aa6c7227da5ea9e31811b175a642e8119744fa54bc3ad5e46a7f99a0` at capture time.
- The actual `serve-claude-worker` claimed and started Run `run_f18645d2234c471ea1cadbd8dbd84786` on `native-real-claude-worker`.
- The provider terminal was classified `provider_failure`; Core reached `failed`, both member and owner could read that state, and no artifact was published.
- The command contract was present in Claude 2.1.263 (`--print`, stream JSON, partial messages, hook events, forwarded subagent text, and plan permission mode). The process completed in about 1.21 seconds and produced a captured-output digest, so this was not a timeout or missing terminal event.
- The current executor intentionally persists only the aggregate result digest and `provider_failure`; it does not retain sanitized stderr, exit code, terminal subtype, or `is_error`. The private runtime contained no output chunks or events for this Run. Therefore the existing evidence cannot distinguish nonzero exit, `is_error:true`, or a terminal subtype other than `success` without another provider call. This missing diagnostic receipt is itself a Core observability gap.

This is an unavailable result journey, not a successful Claude provider proof. No retry or authentication change was attempted.

## Durable files

- `native-real-codex-core8941-result-2026-09-07.json`
- `native-real-codex-core8941-cancellation-2026-09-07.json`
- `native-real-claude-core8941-result-2026-09-07.json`
- `fixtures/native-real-provider-core-probe/`

The receipts contain synthetic identities and no credentials. Private fixture metadata and token files remain outside the repository.
