# Investigation contract snapshot provenance

These files are exact, read-only client snapshots. They are not an independent
backend contract and must be replaced atomically when the accepted source
revision changes.

- OpenSaddle source head: `24856350ef6a593ac6f925ec91160cfebdb3060e`
- OpenSaddle proposal/conformance source head: `3add2326907a0f495f86b5ad1bd10a382e5d89b6`
- Grounded-investigation README SHA-256: `8b4379bfdb8dd0150da25c635d24515cbdd657f85c400d168eef51562bcfd8d1`
- Grounded-investigation schema SHA-256: `322f7724d6f855a5cc9e95f481eff7fa21f8c5f4980bee15094fe77c05f7ed60`
- Golden fixture SHA-256: `b45ad5d3f434c748d8f4ba8ee252634dd80fdd06f2002feeb975fa6730bf7ffa`
- Phase 2 conformance fixture SHA-256: `0b308af6b2afa524fe48dd3411775432924288b1d13c28c8f7af04b291a7da8f`
- KRAIL bundle source commit: `21da6d42619410e8d1cfc4f823681e4eac47d21a`
- KRAIL bundle SHA-256: `e6baed1891e5451aa4598e75d3b8fc93595ae8dc98f1b080c0f23d9c10eae434`
- KRAIL manifest SHA-256: `b687da9caa99f690f439c84aaf3b767596d4005b678599f1e61a9ad3aed81cff`
- Published descriptor digest: `sha256:bfe1bd6af513f24df70b59617565a2262610119f13d0a8a7fb937fbca70098fd`
- Published manifest digest: `sha256:3fa4bb326946fe0555321b0790150dbbb2a92964fba23eae492f448e8c0655a7`

The frontend consumes only the authorized projection described here. It does
not import KRAIL runtime code or expose provider-internal assertion content.
