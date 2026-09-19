# Portable continuation RemoteJourney receipt — 2026-09-07

## Boundary

This was a disposable, synthetic two-machine Git fixture. The HTTP server, Run/checkpoint stores, worker protocol, patch application, and Interface `RemoteJourneyClient` were production code paths. The task, repository, identities, credentials, and patch were generated only for this test. It did not contact a coding-agent provider and did not touch the canonical local service on port 8765.

Core was exported into an immutable private directory at `a20628be2451a2ad49dfb1284d95f12bc120bc38`. The fixture used `LocalBootstrapAuthenticator` with a generated mode-0600 bearer token; the token and worker credentials were neither printed nor copied here.

## Journey

1. Machine A claimed a real Run, published a unified diff changing `calc.value()` from 1 to 2, and paused it with a portable checkpoint.
2. Production `RemoteJourneyClient.snapshot()` read the paused Run and parsed the actual `created_by_worker_id: machine-a` checkpoint contract.
3. Interface durably prepared an owner/Project/Run-scoped continuation for machine B.
4. Fault injection allowed the first real continuation POST to return HTTP 201 from Core, then discarded that response before Interface received it.
5. A newly constructed `RemoteJourneyClient`, sharing only the durable scoped intent, observed the authoritative Run as queued and exposed the same pending target.
6. Explicit retry sent byte-identical JSON, including the same idempotency key. Core returned its existing continuation receipt.
7. Machine B claimed the next lease, applied the checkpoint patch, executed `assert calc.value() == 2`, published one terminal verification artifact, and completed the same Run.

Observed scrubbed client receipt:

```json
{"snapshot":"paused","checkpoint_worker":"machine-a","after_loss":"queued","replay_exact":true,"response_loss_fault_injected":true}
```

Observed server receipt:

```json
{"status":"completed","artifact_count":2}
```

The private executed driver SHA-256 was `c38be0c0045164141df3e87702814185530955cbf72b16d82bcd30744e9e736f`; the server harness SHA-256 was `c64b4cbb6ac5d992bb54f1f685fef2471c1c012ccc6567de7a6fcb1e7fd49120`. The server terminated after completion.

## Limits

This proves HTTP integration, persistence, exact response-loss replay, and two-machine portable patch continuation. It does not prove provider-native session resume; the negotiated capability explicitly reports `native_session_resume: false`. Visible desktop proof remains pending because macOS was locked, and no lock bypass was attempted.
