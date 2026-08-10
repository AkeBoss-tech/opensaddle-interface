# OpenSaddle grounded investigation v1

This client-facing contract describes the read-only issue-to-outcome-Thread
workflow exposed by the OpenSaddle control plane. `schema.json` validates create
requests and safe presentation projections; `fixtures/golden.json` pins the
accepted KRAIL Context Brief descriptor/manifest identities and a deterministic
create/projection journey.

The outcome Thread is stable for a project plus authority-qualified repository,
issue identity, and investigation intent. Exact version changes require explicit
reconciliation; changing intent creates a different investigation identity.
Context Brief assembly is read-only. A human plan remains a draft and creates an
immutable, non-executing `OperationProposal` through the registered-action path.
This contract defines no connector write, approval lease, credential, runtime,
proposal mutation, or execution transition.

Client summaries preserve provider order and contain at most 256 evidence
references. Larger provider results are explicitly truncated with an opaque
local projection gap and never disclose the omitted count or identities. Plan
version validation, proposal creation, and binding are one atomic persistence
operation; exact retries reuse the immutable proposal.
