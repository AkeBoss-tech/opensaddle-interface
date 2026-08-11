# Desktop release

OpenSaddle Desktop v0.1.1 is released by the manual **Desktop release** GitHub
Actions workflow. It produces an Apple-silicon DMG that is Developer ID signed,
notarized, stapled, smoke-tested, checksummed, and uploaded to a new immutable
GitHub release. The workflow never creates a tag and never overwrites a release
or asset.

Release order is KRAIL 1.1.13, OpenSaddle 1.1.1, then Desktop v0.1.1. The
OpenSaddle wheel must be visible through the official PyPI JSON API before the
desktop workflow begins. KRAIL is pinned to the official wheel at:

```text
https://files.pythonhosted.org/packages/bf/c8/2d916c513febf9a3d9b17ce6af91f05c68e307c6bb725394bed7f9086c3d/krail-1.1.13-py3-none-any.whl
SHA-256: f4f153e3c5499d98af44a67258f9c540cc6df554e8d9becada7b9eccd6dcec1c
```

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

## Prepare and dispatch v0.1.1

1. Confirm `electron/package.json` is version `0.1.1` and all release changes
   are merged.
2. Create and push the annotated tag `desktop-v0.1.1` at that reviewed commit.
   Do not reuse or move an existing release tag.
3. Select a pinned arm64 install-only Python `.tar.gz` containing
   `python/bin/python3`. Retain its immutable URL, SHA-256, upstream release
   page, and license record.
4. Dispatch **Desktop release** with tag `desktop-v0.1.1`, the Python archive
   URL, and its 64-character lowercase SHA-256.

The workflow checks out the tag itself and requires its version to match the
Electron package. It downloads KRAIL from its fixed `files.pythonhosted.org`
URL. It resolves the exact `opensaddle-1.1.1-py3-none-any.whl` from the official
PyPI JSON response and verifies the downloaded bytes against PyPI's digest. It
also verifies the supplied Python digest before extracting anything.

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
replaceable. If v0.1.1 is defective, stop directing users to it, document the
issue, fix it on a new version, and publish a higher `desktop-vX.Y.Z` tag and
release. Never move the old tag or replace its DMG under the same filename.

Revoking a compromised Developer ID certificate or GitHub token is an Apple or
GitHub administrative action and should happen immediately; rotating the
repository secrets alone does not invalidate an already distributed binary.
The application still requires its packaged OpenSaddle backend to serve the
local API. A KRAIL-only bundle is not a complete desktop release.
