# Desktop release

OpenSaddle Desktop v0.2.0 is released by the manual **Desktop release** GitHub
Actions workflow. It produces an Apple-silicon DMG that is Developer ID signed,
notarized, stapled, smoke-tested, checksummed, and uploaded to a new immutable
GitHub release. The workflow never creates a tag and never overwrites a release
or asset.

Release order is KRAIL 1.2, OpenSaddle 1.2, then Desktop v0.2.0. Release
candidate versions such as `1.2.0rc1` are supported. Both selected wheels must
be published through trusted publishing and visible through the official PyPI
JSON API before the desktop workflow begins. The workflow resolves their
`files.pythonhosted.org` URLs and SHA-256 digests from that API; it never accepts
an arbitrary package URL.

## One-time repository setup

Create a protected GitHub environment named `desktop-release`, require the
appropriate approver, and add these environment secrets:

- `MACOS_CERTIFICATE_BASE64`: base64-encoded Developer ID Application PKCS#12
- `MACOS_CERTIFICATE_PASSWORD`: PKCS#12 export password
- `MACOS_SIGNING_IDENTITY`: exact Developer ID Application identity
- `MACOS_KEYCHAIN_PASSWORD`: strong throwaway CI keychain password
- `APPLE_ID`: Apple account used by `notarytool`
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for that account
- `APPLE_TEAM_ID`: Apple Developer team identifier
- `RELEASE_ADMIN_TOKEN`: fine-grained GitHub token with repository
  Administration read and Contents write access

Enable GitHub immutable releases for the repository before dispatch. The
workflow queries `GET /repos/{owner}/{repo}/immutable-releases` with API version
`2026-03-10` and aborts unless it returns `enabled: true`. The admin-capable token
is necessary because an ordinary Actions token may not read that setting.

## Prepare and dispatch v0.2.0

1. Publish and verify the selected KRAIL and OpenSaddle release-candidate or
   final wheels. Do not reuse an older package version for newer source.
2. Confirm `electron/package.json` is version `0.2.0` and all release changes
   are merged.
3. Create and push the annotated tag `desktop-v0.2.0` at that reviewed commit.
   Do not reuse or move an existing release tag.
4. Select a pinned arm64 install-only Python `.tar.gz` containing
   `python/bin/python3`. Retain its immutable URL, SHA-256, upstream release
   page, and license record.
5. Dispatch **Desktop release** with tag `desktop-v0.2.0`, the exact KRAIL and
   OpenSaddle versions, the Python archive URL, and its 64-character lowercase
   SHA-256.

The workflow checks out the tag itself and requires its version to match the
Electron package. It resolves the exact versioned wheels from the official PyPI
JSON responses, requires a single universal wheel for each package, and verifies
the downloaded bytes against PyPI's digests. It also verifies the supplied
Python digest before extracting anything.

Packaging fails closed when a required secret is absent or when signing,
notarization, stapling, Gatekeeper assessment, manifest validation, or any
sanitized launcher smoke test fails. The mounted DMG is checked independently
from the pre-package bundle.

## Outputs and verification

The successful workflow attaches three files to the immutable release:

- the signed, notarized, and stapled arm64 DMG;
- a `.sha256` file for the final stapled DMG;
- provenance JSON recording tag, commit, architecture, both PyPI wheel URLs and
  digests, the Python URL and digest, the DMG digest, and signing status.

Download all three and verify from the containing directory with:

```bash
shasum -a 256 -c OpenSaddle-*.dmg.sha256
xcrun stapler validate OpenSaddle-*.dmg
```

The GitHub Actions artifact is retained only as a diagnostic copy. The
immutable GitHub release is the distribution record.

## Rollback and incident response

An immutable release and its assets are intentionally not editable or
replaceable. If v0.2.0 is defective, stop directing users to it, document the
issue, fix it on a new version, and publish a higher `desktop-vX.Y.Z` tag and
release. Never move the old tag or replace its DMG under the same filename.

Revoking a compromised Developer ID certificate or GitHub token is an Apple or
GitHub administrative action and should happen immediately; rotating the
repository secrets alone does not invalidate an already distributed binary.
The application still requires its packaged OpenSaddle backend to serve the
local API. A KRAIL-only bundle is not a complete desktop release.
