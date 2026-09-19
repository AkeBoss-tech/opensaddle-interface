# Authorized context Inspector HTTP receipt — 2026-09-08

This is deterministic fault and authorization-boundary evidence. The authority,
fixture content, and worker executor were synthetic. The Core CLI, local Project
registry, Knowledge packet provider, public HTTP API, outbound worker client,
durable packet and artifact stores, and Interface `RemoteJourneyClient` were the
production implementations.

- Core: `dbde13d3d1e5ba47aa27a26329e4a9957b25b94b`, loaded from an immutable Git archive.
- Knowledge: `d4dde4b62443c29b72a09bb3dd33390c96c6fbbb`, loaded from an immutable Git archive.
- The server used the supported `authorized_packet_runtime_factory:create_provider`
  fixture on a separate ephemeral loopback port. The normal desktop service on
  port 8765 was not changed.
- Production `RemoteJourneyClient.snapshot()` discovered one runtime Project
  source and three separately identified immutable Knowledge source versions.
  Their ID namespaces did not overlap.
- Production `RemoteJourneyClient.delegate()` submitted the runtime source as
  `source_id` and the three Knowledge IDs as `authorized_context_source_ids`.
- The production outbound worker fetched the packet after its fenced Run start,
  then published the exact protected result `protected cli echo`.
- The worker and Inspector returned the same packet digest:
  `sha256:bd4a9380d91a67876cac0185ae085d71db269b89ea16c9e1098576af668696b4`.
- The immutable request digest was
  `sha256:0c5e7a4457426a8f5d0e65f0310c2468e992047754fc74421763a274f121bdf6`.
- The artifact digest was
  `a4ce2e02ef8b8e101b1ff8697def512c04a07c45ba22e6b97088e852eed6431f`.
- Core was stopped after PID 40985 and restarted as PID 41016 over the same
  durable stores. The Inspector packet and artifact remained exact after restart.
- Touching the fixture's explicit revocation marker made both the Inspector and
  artifact-content reads return unavailable through `RemoteJourneyClient`; neither
  protected response remained readable.

The replayable TypeScript boundary driver is
`docs/agents/evidence/fixtures/authorized-context-remote-journey-probe.ts`. It
expects an already provisioned instance of Core's supported synthetic CLI fixture
and receives its generated fixture credential only through process environment.
No token, credential, personal path, or provider account data is stored here.

Mounted behavior tests separately prove that a Project or authority replacement
rejects a late Inspector response, and that an Inspector or artifact refresh
clears displayed protected bytes before a denial settles. Visible desktop proof
remains pending because the macOS session is locked; no lock bypass was attempted.
