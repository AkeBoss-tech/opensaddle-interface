# OpenSaddle edit-command v1

This bundle is the deterministic, language-neutral client contract for governed
human and agent editing. The JSON Schema exposes only typed, allowlisted field
operations. It is not a dynamic UI or code-execution schema.

An edit session is bound to an exact Phase 1 `ResourceRef`, capability version
and digest, author/delegation, optimistic version, policy snapshot, availability
version, autosave recovery digest, and draft/history truth. Implementations must
recheck live permission, delegation revocation, policy, capability, availability,
resource version, and resource digest for every command.

The capability also binds the exact registered action ID, version, digest, and
effect class used for consequential edits. Command digests cover operation kind,
session/base identity, exact expected resource version/digest/source, optimistic
version, and typed input; they are not trusted caller labels. Undo and revert
re-read that exact live resource before mutating session state. A session that
opens under proposal-required policy cannot be downgraded to direct commit by
changing only a later policy outcome.

Low-risk draft commits are permitted only when both the resource schema and the
live policy explicitly allow them. Publish, deploy, configuration, or other
consequential effects produce the exact strict `CreateOperationProposalRequest`
body accepted by the existing immutable OperationProposal flow. The edit
boundary never grants approval or exposes an execution transition.

Evidence, source captures, approvals, audit events, verification receipts, and
effect receipts are immutable. Clients may offer only annotation, correction,
or supersession commands for those records.
