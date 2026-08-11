# Desktop KRAIL runtime

The desktop package discovers KRAIL through a validated, versioned bundle. It
never describes an absent or incomplete runtime as bundled.

Build KRAIL 1.1.13 first, then stage its wheel before packaging:

```bash
KRAIL_WHEEL=/absolute/path/krail-1.1.13-py3-none-any.whl npm run runtime:krail:bundle
KRAIL_WHEEL=/absolute/path/krail-1.1.13-py3-none-any.whl npm run desktop:package
```

The staging command installs the wheel and its Python dependencies under
`electron/runtime-bundle/krail-runtime`, writes relocatable `krail-admin` and
`krail-mutate` launchers, and writes `manifest.json` last. The manifest carries
the wheel name and SHA-256 digest. Electron only injects
`OPENSADDLE_KRAIL_ADMIN_COMMAND` and `OPENSADDLE_KRAIL_MUTATION_COMMAND` after
the manifest and both executable paths validate. Explicit environment commands
always win; an absent bundle falls back to the installed commands on `PATH`.

Release order is KRAIL 1.1.13, OpenSaddle 1.1.0, then the desktop artifact. For
a clean-machine smoke test, launch the packaged app without a source checkout,
initialize a temporary project, run doctor and reindex, and capture a reviewed
candidate. The final receipt must report `raw_inbox`; capture never declares the
candidate trusted knowledge.

To roll back, remove the staged runtime and repackage, or set both command
environment variables to a known-good installation. Do not retain a manifest
when either launcher or its staged dependencies are removed.
