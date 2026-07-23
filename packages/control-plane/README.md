# OpenSaddle control plane

One backend for two deployment profiles:

- **Local mode** binds to `127.0.0.1`, accepts only loopback clients, provisions
  private local workspaces, and can use an on-device OpenAI-compatible server.
- **Company mode** binds to the configured network interface, requires bearer
  authentication, keeps grants/runs/audit events on the server, and provisions
  locked-down Docker runtimes.

The React client uses the same HTTP/SSE API in both modes.

## Local computer

```bash
cp packages/control-plane/.env.example packages/control-plane/.env
# The control plane loads this file automatically.
npm run server
npm run dev
```

For OpenRouter, paste the key into `packages/control-plane/.env`. Free routing is
the default, so OpenRouter chooses from currently available free models:

```ini
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openrouter/free
OPENROUTER_APP_NAME=OpenSaddle
```

The key stays in the control-plane process. It is never returned by an API or
included in the frontend bundle.

For Ollama, vLLM, or LM Studio, set its OpenAI-compatible base URL and model:

```bash
OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:11434/v1 \
OPENAI_COMPATIBLE_MODEL=your-installed-model \
npm run server
```

The browser defaults to `http://127.0.0.1:8765`. A fresh local daemon imports
the demo workspace's permission grants once. After that, the server copy is
authoritative.

## Company server

Generate random API keys using your secrets manager. Do not put model keys or
control-plane tokens in source control.

```bash
OPENSADDLE_MODE=company \
OPENSADDLE_HOST=0.0.0.0 \
OPENSADDLE_CORS_ORIGINS=https://agents.example.com \
OPENSADDLE_API_KEYS_JSON='{"a-long-random-token-from-your-vault":{"userId":"admin@example.com","roles":["admin"]}}' \
OPENSADDLE_BOOTSTRAP_ADMIN=admin@example.com \
OPENSADDLE_RUNTIME_PROVIDER=docker \
OPENSADDLE_DOCKER_IMAGE=ghcr.io/acme/opensaddle-runtime:latest \
OPENSADDLE_MODEL_ROUTES_JSON='{"gpt":{"baseUrl":"https://models.acme.internal/v1","model":"approved-general","apiKeyEnv":"MODEL_GATEWAY_KEY"}}' \
npm run server
```

Build the frontend with:

```bash
VITE_OPENSADDLE_URL=https://control.agents.example.com \
VITE_ALLOW_MOCK_FALLBACK=false \
npm run build
```

For production browser auth, terminate OIDC at an identity-aware reverse proxy
and inject a short-lived bearer credential. The static `VITE_OPENSADDLE_TOKEN`
option is not supported for production because Vite embeds it in browser JavaScript.
Use a short-lived credential through the Settings connection panel instead.

Put TLS and request-rate limits in front of the service. Company mode refuses
to start without API keys and never imports permissions from browser state.

## Runtime isolation

The Docker provisioner creates containers with:

- no network
- read-only root filesystem
- all Linux capabilities dropped
- `no-new-privileges`
- CPU, memory, PID, and temporary-storage limits
- a dedicated expiring workspace mount

Running the Docker provider requires Docker CLI access. If the control plane is
itself containerized, access to the Docker socket is security-sensitive and
should use a dedicated rootless daemon or a hardened provisioning proxy. Do not
mount a production Docker socket into an internet-facing container.

Local mode validates repository paths against
`OPENSADDLE_ALLOWED_REPO_ROOTS`. Provisioning records a source path for future
tool mounts; it does not automatically make the repository writable.

## Coding harnesses

Coding tasks are executed by a **harness provider**, not just a model call:

| Provider | Kind | Notes |
|---|---|---|
| `opensaddle` | native | Built-in coding agent: model gateway + workspace tools (`list_dir`, `read_file`, `write_file`, `run_shell`) |
| `codex` / `claude` / `cursor` / `gemini` / `opencode` | CLI | Spawns the local binary with `shell:false`, streams stdout into SSE events |
| custom | CLI | Register via `OPENSADDLE_HARNESS_PROFILES_JSON` (KRAIL-style) |

```bash
# Prefer native OpenSaddle agent (default)
OPENSADDLE_DEFAULT_CODING_PROVIDER=opensaddle

# Or prefer an installed CLI when present
OPENSADDLE_DEFAULT_CODING_PROVIDER=codex
OPENSADDLE_CODING_PROVIDERS=opensaddle,codex,claude,cursor,gemini,opencode
```

Discover what is available on the host:

```bash
curl -H 'X-OpenSaddle-User: user-ad' http://127.0.0.1:8765/api/harnesses
```

Pass `provider_key` on `/api/runs` or `/api/routes/estimate` to pin a harness.
Pass `model_key` to choose the model; for CLI providers this is mapped into the
CLI's `--model` flag (Codex `gpt-5.4`, Claude Code `opus`/`sonnet`, etc.).
With `model_key=auto`, the router picks a stronger model for architecture /
migrations and a faster one for typos / lint / short fixes.

Chat/research tasks still use the model gateway directly.

## APIs

- `GET /api/health`, `GET /api/capabilities`, `GET /api/harnesses`
- `GET|PUT /api/workspace` (durable workspace, chats, and messages)
- `POST /api/routes/estimate`
- `GET|POST /api/runs`, `GET /api/runs/:id/events` (SSE),
  `POST /api/runs/:id/cancel`
- `GET /api/permissions`, `POST /api/permissions/check`,
  `PUT|DELETE /api/permissions/grants`
- `GET|POST /api/approvals`, `POST /api/approvals/:id/resolve`
- `GET|POST /api/runtimes`, `DELETE /api/runtimes/:id`

Permission checks are enforced again on the server. Agent execution requires
the intersection of the initiating user's grant and the agent's grant. Explicit
denial wins. Approval-required runs accept only a matching, approved,
single-use approval record.

## Persistence and limits

State is stored in `$OPENSADDLE_DATA_DIR/opensaddle.sqlite`. SQLite runs in WAL
mode and stores the workspace snapshot plus indexed documents for chats,
messages, projects, runs, permissions, approvals, and runtimes. Existing
`control-plane.json` data is imported once on startup. Before horizontal
scaling, move the same store interface to a network database and use a shared
event bus.
