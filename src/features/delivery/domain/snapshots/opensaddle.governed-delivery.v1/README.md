# OpenSaddle governed delivery v1

This bundle is the language-neutral client projection of OpenSaddle's governed
coding execution and GitHub pull-request effect boundary. It is a read model,
not an alternate mutation API. Clients may edit only the explicitly declared
publication fields and must submit changes through a separately authorized edit
command or proposal flow.

The projection binds the complete canonical execution admission, exact source
and change evidence, KRAIL verification receipt, publication proposal, consumed
approval, opaque credential-lease metadata, provider-confirmed pull request and
CI observation, and terminal effect receipt. Proposal, approval, dispatch, and
provider observation are distinct states. A proposal or approval never implies
that an external effect occurred.

Security properties:

- admission identity and digest are repeated at each authority boundary;
- resource and artifact references carry immutable versions and SHA-256 digests;
- cancellation advances the operation fence and revokes active credential leases;
- exact retries use the request digest; conflicting reuse is denied;
- provider URLs are canonical HTTPS URLs without credentials, query, or fragment;
- secrets, raw provider bodies, selectors, and unrestricted errors are omitted;
- KRAIL omissions and non-verified CI states remain explicit;
- typed failures use constant disclosure codes.

`schema.json` is the normative Draft 2020-12 schema. `fixtures/golden.json` is a
complete deterministic serialization. `fixtures/conformance.json` lists replay,
fencing, cancellation, authority-drift, provider, redaction, and correction
scenarios. `manifest.json` pins the schema digest and implementation provenance.

Authoritative implementation lineage: OpenSaddle commit
`ab25b92f5c3da8cfd7eaa4298655433ea2f78da2`, corrected by its reviewed
descendants. KRAIL evidence is referenced through the pinned Phase 3 fixture
contract and is never reinterpreted by this bundle.
