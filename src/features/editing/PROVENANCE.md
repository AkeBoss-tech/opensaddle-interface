# Interface editing presentation contract

`opensaddle.interface-editing.presentation/v1` is a strict, client-owned domain and presentation snapshot. It is not an OpenSaddle backend or shared contract and is not evidence of a mutation endpoint.

No compatible authoritative edit-command or operation-proposal contract was present at the accepted Interface Phase 2 baseline (`792df03cf0659e47e167e5ae71fd0b0c4f20b6be`). Adapters therefore fail closed on unknown variants, project consequential changes only as non-executing proposal intent, and expose no production mutation transport.

A future backend integration must supply a versioned capability discovery contract, optimistic concurrency semantics for both version and digest, live policy/delegation evaluation, immutable proposal/approval/execution records, and a registered mutation transport. That contract must be adapted at this boundary rather than inferred from this client snapshot.
