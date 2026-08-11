# Desktop managed runtimes

The desktop package carries a pinned, relocatable Python runtime plus the
official KRAIL and OpenSaddle wheels. The KRAIL launchers and the OpenSaddle
backend launcher therefore do not depend on Homebrew, Xcode tools, a system
Python, or a source checkout on the target Mac. Electron only reports a runtime
as bundled after its manifest and executable paths validate.

## Runtime inputs

Builds require all three inputs:

```bash
KRAIL_WHEEL=/absolute/path/krail-1.1.13-py3-none-any.whl \
OPENSADDLE_WHEEL=/absolute/path/opensaddle-1.1.1-py3-none-any.whl \
KRAIL_PYTHON_RUNTIME=/absolute/path/python-install-only-arm64.tar.gz \
KRAIL_PYTHON_RUNTIME_SHA256=<64-lowercase-hex-characters> \
npm run runtime:krail:bundle
```

The Python input must be an immutable, Apple-silicon-compatible `.tar.gz`
whose extracted layout contains `python/bin/python3`. Record the archive's
permanent URL and SHA-256; do not use a mutable `latest` URL. A pinned
`python-build-standalone` install-only archive is one suitable source.

The staging command extracts Python, installs both wheels and their dependencies
with that interpreter, writes relocatable launchers, performs sanitized smoke
tests, and writes the runtime manifest last. That manifest records the KRAIL
wheel, OpenSaddle wheel, and Python archive digests. A digest mismatch, missing
launcher, failed install, or failed smoke test aborts the build without claiming
the runtime is bundled.

At launch, explicit environment commands continue to take precedence.
Otherwise Electron uses validated bundled commands for
`OPENSADDLE_KRAIL_ADMIN_COMMAND`, `OPENSADDLE_KRAIL_MUTATION_COMMAND`, and the
OpenSaddle backend. When a bundle is absent, the existing environment and
`PATH` fallback remains available.

## Product semantics and smoke testing

Candidate promotion captures reviewed material into KRAIL's `raw_inbox`; it
does not declare the candidate trusted knowledge. A clean-machine test should
launch the packaged app without a source checkout, initialize a temporary
project, run doctor and reindex, and capture a reviewed candidate. The receipt
must report `raw_inbox`.

The release workflow repeats launcher smoke tests with a nearly empty
environment both before packaging and from the mounted DMG. See
[Desktop release](./desktop-release.md) for the signed release procedure.

To recover from a bad local bundle, remove the entire staged runtime and rebuild
from known-good pinned inputs. Never retain a manifest after removing a launcher
or staged dependency.
