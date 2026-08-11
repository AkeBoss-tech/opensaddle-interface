# OpenSaddle Interface

Interactive enterprise agent workspace — React + Vite + TypeScript.

**Live demo:** https://akeboss-tech.github.io/opensaddle-interface/ (also https://akashdubey.me/opensaddle-interface/)

## Features

- Codex-style chat with streaming agent runs, tool cards, diffs, artifacts
- Auto routing pill (model · harness · runtime)
- **Agents** and **Workflows** areas (separate from chats)
- **Permissions** matrix scoped to users and agents (deny wins; intersection required)
- **Files** workspace with OPFS persistence + Worker WASM sandbox
- OAuth tool broker client (GitHub/Jira/Slack mock PKCE flow)
- Project sources (GitHub repos), folders, and inheritance-aware grants
- Environments wired to local / browser / KRAIL sessions
- OpenSaddle HTTP client for estimate/runs (falls back to mock)
- Dual-mode control plane for local computers or company servers
- Electron desktop harness scaffold (`electron/`) for on-device CLIs

## Develop

```bash
npm install
npm run dev
```

Optional sidecars:

```bash
# Real routing, runs, server-side permissions, approvals, and runtimes
npm install --prefix packages/control-plane
npm run server

# Session execution bridge (the `krail` script remains a compatibility alias)
npm install --prefix packages/session-bridge
npm run session-bridge
```

Desktop harness:

```bash
npm install --prefix electron
npm run desktop
```

Set `VITE_RUNTIME=mock|browser|desktop` to force capability mode.

The control plane defaults to a loopback-only local daemon. It can connect to
Ollama, vLLM, LM Studio, an enterprise gateway, or another OpenAI-compatible
model endpoint. Company mode adds bearer authentication and Docker runtime
provisioning. See [`packages/control-plane/README.md`](packages/control-plane/README.md).

For OpenRouter free models, put your key in the backend-only file:

```bash
cp packages/control-plane/.env.example packages/control-plane/.env
# Edit packages/control-plane/.env:
# OPENROUTER_API_KEY=sk-or-v1-...
# OPENROUTER_MODEL=openrouter/free
npm run server:dev
```

Do not use a `VITE_` variable for this key. Vite variables are bundled into the
browser. The control plane loads `.env.local` and `.env` automatically.

For a remote control plane:

```bash
VITE_OPENSADDLE_URL=https://control.example.com \
VITE_ALLOW_MOCK_FALLBACK=false \
npm run build
```

## Build

```bash
npm run build
npm run preview
```

GitHub Pages serves from `/opensaddle-interface/`.

## Demo data

The browser keeps an offline cache in `localStorage` (`opensaddle-data-v5`) plus
OPFS for files. When the control plane is connected, the workspace, chats,
messages, projects, permissions, runs, runtimes, and approvals persist in
`.opensaddle/opensaddle.sqlite`. Reset UI state from **Settings → Reset to seed**.
