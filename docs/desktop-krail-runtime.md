# Desktop managed runtimes

The desktop package carries a pinned, relocatable Python runtime plus the
official KRAIL and OpenSaddle wheels. The KRAIL launchers and the OpenSaddle
backend launcher therefore do not depend on Homebrew, Xcode tools, a system
Python, or a source checkout on the target Mac. Electron only reports a runtime
as bundled after its manifest and executable paths validate.

## Runtime inputs

Builds require all three inputs:

```bash
KRAIL_VERSION=1.2.0rc2 \
KRAIL_WHEEL=/absolute/path/krail-1.2.0rc2-py3-none-any.whl \
OPENSADDLE_VERSION=1.2.0rc4 \
OPENSADDLE_WHEEL=/absolute/path/opensaddle-1.2.0rc4-py3-none-any.whl \
KRAIL_PYTHON_RUNTIME=/absolute/path/python-install-only-arm64.tar.gz \
KRAIL_PYTHON_RUNTIME_SHA256=<64-lowercase-hex-characters> \
KRAIL_RUNTIME_LOCK=electron/runtime-lock/runtime-lock-macos-arm64-python3.13.json \
KRAIL_REQUIREMENTS_LOCK=electron/runtime-lock/requirements-macos-arm64-python3.13.txt \
KRAIL_WHEELHOUSE=/absolute/path/to/validated-wheelhouse \
npm run runtime:krail:bundle
```

The declared versions are mandatory and must exactly match the wheel filenames.
This prevents an old published backend from being relabeled as the current
desktop release. Final `1.2.0` wheels can replace the release candidates without
changing the bundler.

The Python input must be an immutable, Apple-silicon-compatible `.tar.gz`
whose extracted layout contains `python/bin/python3`. Record the archive's
permanent URL and SHA-256; do not use a mutable `latest` URL. A pinned
`python-build-standalone` install-only archive is one suitable source.

Desktop 0.2.1 pins CPython 3.13.15 from the immutable 20260814
`python-build-standalone` release. The committed runtime lock records all 35
official PyPI wheels by immutable URL, byte size, and SHA-256. The matching
requirements file is installed strictly with `--no-index --require-hashes`.

The staging command validates the complete wheelhouse before extracting Python,
installs the locked wheels offline with that interpreter, writes relocatable launchers, performs sanitized smoke
tests, and writes the runtime manifest last. That manifest records the KRAIL
wheel, OpenSaddle wheel, Python archive, requirements, runtime-lock, wheel-set,
and dependency-report digests. A digest mismatch, unexpected wheel, missing
launcher, failed install, or failed smoke test aborts the build without claiming
the runtime is bundled.

At launch, explicit environment commands continue to take precedence.
Otherwise Electron uses validated bundled commands for
`OPENSADDLE_KRAIL_ADMIN_COMMAND`, `OPENSADDLE_KRAIL_MUTATION_COMMAND`, and the
OpenSaddle backend. When a bundle is absent, the existing environment and
`PATH` fallback remains available.

Finder-launched applications do not inherit a login-shell `PATH`. Desktop CLI
discovery therefore checks `OPENSADDLE_CODEX_EXECUTABLE` and
`OPENSADDLE_CLAUDE_EXECUTABLE` first, then `OPENSADDLE_CLI_SEARCH_PATH`, the
inherited path, and bounded common Homebrew and Node-version-manager bins. The
same resolved path is passed to the bundled backend, so its harness readiness
and later agent execution agree with Electron. OpenSaddle deliberately does not
evaluate interactive shell startup files during launch.

The desktop only adopts a loopback daemon whose health response advertises the
`project_onboarding` capability and binds it to the exact
`opensaddle.project-onboarding/v1` contract. If the default port is occupied by
an unowned older daemon, the packaged app starts its bundled backend on a free
loopback port and passes that exact URL to the renderer. An explicitly configured
`OPENSADDLE_URL` is never silently replaced: stop or upgrade the incompatible
daemon, or choose another loopback port. The selected URL and any compatibility
notice remain visible in Connection settings.

## Product semantics and smoke testing

Candidate promotion captures reviewed material into KRAIL's `raw_inbox`; it
does not declare the candidate trusted knowledge. A clean-machine test should
launch the packaged app without a source checkout, initialize a temporary
project, run doctor and reindex, and capture a reviewed candidate. The receipt
must report `raw_inbox`.

The release workflow repeats launcher smoke tests with a nearly empty
environment both before packaging and from the mounted DMG. It also boots the
sidecar before packaging and boots the actual Electron application from the
mounted DMG. Both paths require `project_onboarding` at the exact v1 contract,
register a disposable Git project, and perform a read-only KRAIL prepare while
execution is deliberately gated. See
[Desktop release](./desktop-release.md) for the signed release procedure.

To recover from a bad local bundle, remove the entire staged runtime and rebuild
from known-good pinned inputs. Never retain a manifest after removing a launcher
or staged dependency.
