# Native coding-agent selection and real Claude receipt

Date: 2026-09-07

## Boundary

Core ran from an immutable `git archive` of `80b708e` on loopback port 8952. Its module import root was the archive's `src` directory. The private disposable fixture used synthetic identities, a synthetic Project/source/workspace, and mode-0600 credentials outside the repository. The production Interface `RemoteJourneyClient` performed actual HTTP readiness reads, selected-adapter Run creation, terminal outcome reads, and result provenance mapping.

Visible Electron proof remains pending because macOS was locked; no bypass was attempted.

## Readiness and selection

Actual worker CLI probes reported both installed adapters ready for the exact source revision and digest. The production Interface transport parsed those worker-reported observations without a ready fallback and created Run `run_c5d6172ca6044310af08f2f7f77cc7dd` with `native_adapter_id=claude-code-stream-json`. Core policy retained that admitted adapter. After the Codex observation expired, the same Interface transport returned Codex as unavailable with `readiness_stale`; it did not synthesize readiness.

The live capability document exposed `native_adapters` at the top level of `/api/v2/capabilities`. This actual response corrected the earlier draft assumption that it was nested under `features`.

## Real Claude result

Claude Code 2.1.263 used the existing `claude.ai` subscription authentication. No login, auth-file read, API key, purchase, or fallback provider was used. One controlled provider call read the synthetic fixture fact and returned exactly `SADDLE-AMBER-8031`.

- Core Run status: `completed`
- Assigned worker: `native-ui-claude-worker`
- Artifact: `art_05b5578bfd9e48d9b15aac9188d87835`
- Exact result SHA-256: `902cc7065fbb7730a3c4490f5f552835fb41cb7be7882f53767af437d2ae2e77`
- Member Run/list/content: HTTP 200; exact bytes matched
- Owner Run/list/content: HTTP 200; exact bytes matched
- Private capture: exit 0, terminal type `result`, subtype `success`, `is_error=false`, empty stderr
- Durable provider receipt: completed, exit 0, subtype success, not an error

The raw provider stdout and stderr remain private in the disposable runtime and are not staged. The repository receipt contains only the exact synthetic result and bounded diagnostic fields.

## Product limits

The public Run exposes the admitted adapter and optional requested model through policy obligations. It does not expose the executed provider receipt, so Interface labels this as requested/admitted provenance rather than provider-reported execution provenance. Worker readiness is self-reported and expires; it is not hardware or account attestation.
