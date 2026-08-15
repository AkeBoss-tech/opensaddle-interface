# Authoritative snapshot provenance

These files are verbatim snapshots from the OpenSaddle repository at commit
`742da04bf46a27ef5bd7988d0b1007f4a08338a0`. They are authoritative for wire
shape only; Interface editing types remain non-authoritative presentation types.

| Snapshot | Source path | SHA-256 |
| --- | --- | --- |
| `schema.json` | `contracts/opensaddle.edit-command.v1/schema.json` | `13442f5b5a6e0d3d7bc76025091d1dc2007cf28336a2eca0c88cfd0889d2dc38` |
| `fixtures/client.json` | `contracts/opensaddle.edit-command.v1/fixtures/client.json` | `837757617b03f3d6eba2428b4dc63f63fce8a651fb3bc09b71d64158f1f278fd` |
| `README.md` | `contracts/opensaddle.edit-command.v1/README.md` | `c75a122c00e1f7b41fb606efe27e567cf205be89db537e70f2bddc5eff721574` |

No authorization or integrity decision may use Interface's presentation-only
FNV fingerprint. The adapter derives authoritative SHA-256 digests from the
canonical OpenSaddle command material and never performs transport.
