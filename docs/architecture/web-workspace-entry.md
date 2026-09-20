# Web workspace entry and machine connections

Status: September 20, 2026. Entry-screen repair implemented; cloud design below is a proposal, not an activated service.

## Why the hosted page failed

The GitHub Pages site is a static Interface build, not a hosted Core runtime.
An unconfigured browser previously selected `http://127.0.0.1:8765` and probed
health every three seconds. That address is the visitor's computer. The supplied
screenshot shows requests blocked because its server did not allow the website's
origin. Changing CORS alone would not start a server or establish identity.

A second bug made the empty screen narrow: the team sidebar returned no element
when there were no projects, while the application still allocated a sidebar
column. The main view occupied that column. The shell now uses one column when
there is no sidebar to render.

## Implemented entry flow

A non-loopback browser origin with no configured or saved server enters an
unconfigured state. It makes no automatic Core requests and offers no simulated
runtime or connector actions. Desktop, local development, explicit build URLs,
and previously chosen session connections preserve their existing behavior.

The welcome screen fills the available width, explains the server and local
runtime paths, and links directly to the connection form. Future cloud sign-in
and remote enrollment are labeled planned. The interactive example is explicitly illustrative; its Plan, Execute, and Review
controls update only local presentation state. It does not claim live project
activity or launch agents. A configured but unreachable connection still uses
existing reconnect behavior; this change does not diagnose all browser failures.

The unconfigured store starts empty and does not render prior cached projects.
It also leaves the previous cache bytes unchanged while the visitor explores the
landing page. Protected application routes return to the entry screen until a
connection is selected.

## Landing-page design research

A dedicated ChatGPT web conversation in the akashgpt project compared three
visual directions using the user-provided sources. The selected direction is an
open workbench: warm light canvas, dark typography, a readable product preview,
short narrative sections, and one primary connection action. The page borrows
Stripe's product-led storytelling and spacing, without copying its branding,
customer claims, metrics, or pricing structure.

- [Research conversation](https://chatgpt.com/g/g-p-6a9da0752ed88191bea396a9e4cf0c50-akashgpt/c/6aaf6890-495c-83ea-a1c8-80b6bd0fa45a)
- [Courey Wong: landing-page design](https://coureywong.medium.com/how-to-design-a-killer-landing-page-22a893d3b9fb)
- [Figma: landing-page examples](https://www.figma.com/resource-library/landing-page-examples/)
- [Stripe](https://stripe.com/)

The existing OpenSaddle logo anchors the header, preview, architecture, and
footer. Integration marks have adjacent capability labels rather than a generic
"supported everywhere" badge. Asset provenance is in `public/brands/README.md`.
Codex native, Claude CLI, Cursor bridge, Gemini detection, bounded Docker worker,
MCP, GitHub, and private Tailscale setup have different contracts. macOS desktop
and Linux workers are distinguished from pending Windows qualification. Cloud
sign-in and enrollment remain clearly planned in the FAQ.

## Proposed authenticated product flow

1. Sign in or connect a self-hosted server. An account selects a workspace; no
   browser-supplied user header becomes proof of identity.
2. The workspace lists only authorized projects, machines, agents, and pending
   approvals. Start with outcome/status views; retain project, task, and audit
   inspection behind them.
3. Enroll a machine with a short-lived, one-use pairing exchange. On the machine,
   show the account/workspace, selected project roots, allowed adapters, and
   execution limits before confirmation. Give each enrolled machine its own
   revocable identity. A machine connection never grants access to every file.
4. Core admits work using the human, agent, project, worker, and Run identities.
   Scoped connector credentials remain with the broker. External harnesses use
   the agent identity delegated for that Run.
5. Show machine heartbeat separately from verified task progress. A disconnected
   machine is unavailable/unknown, not successfully stopped. Revocation prevents
   new admission; execution leases and termination acknowledgements govern work
   already running. Reconnection does not blindly replay uncertain actions.

## Deployment choices

| Mode | Path | Tradeoff |
| --- | --- | --- |
| Personal desktop | Interface and Core on the same computer | Offline/local operation; no cloud account required. |
| Private team | HTTPS workspace gateway reachable on Tailscale; enrolled workers connect to Core | Small infrastructure footprint; browser device needs tailnet access. |
| Managed cloud | HTTPS web application and backend session gateway; machine workers establish outbound authenticated connections | Browser access without a VPN; adds tenancy, sessions, enrollment, relay availability, and operational responsibility. |

For a private beta, serve Interface and its API through one trusted HTTPS origin
where practical. [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve)
can expose a local service within a tailnet and provide HTTPS. It supplies network
reachability; OpenSaddle still enforces project membership, agent capabilities,
approvals, and audit policy. This proposal does not enable Funnel or expose any
machine publicly.

A managed cloud version needs a server-side session gateway (for example an OIDC
login with secure, HttpOnly cookies and CSRF protection), not secrets compiled
into this static Pages bundle. Bind sessions to validated subjects and workspace
membership, check authorization per operation, rotate/revoke sessions, and keep
worker credentials separate. If cross-origin deployment remains necessary,
allow exact approved origins. Avoid automatically trusting every visitor origin.
The current manual bearer-token form is an interim self-hosted connection path,
not the intended consumer sign-in experience.

## Acceptance gates for the next slices

- Account A cannot list or operate account B's workspace even by guessing IDs;
  session expiry and membership revocation immediately remove protected views.
- Pairing codes expire, are single-use, and cannot enroll a worker into a
  substituted workspace. Revocation blocks its subsequent claims and tools.
- A financial agent cannot read a marketing-only source or widen its own grants;
  the owner reviews inferred scopes during agent setup.
- Restart the gateway and disconnect a worker during an operation: preserve the
  audit trail and reservations, reject stale results, reconcile uncertain effects.
- Exercise each connection state on desktop and mobile: first visit, expired
  login, denied permission, offline machine, reconnect, and successful project
  entry. Separate network errors from authentication and authorization errors.

Existing Core membership, worker, execution, and audit primitives should remain
authoritative; this entry screen must not introduce another scheduler or local
permission database that overrides them.

## Static-host deep links

Hosted verification of PR67 found that opening `/home` directly returned GitHub
Pages' generic 404. The build now publishes `home/index.html` and
`settings/index.html` with the same absolute asset URLs as the root document.
Other SPA routes use a `404.html` application fallback. Electron builds with
`VITE_APP_BASE=./` retain their single relative entry document. Public entry
routes can therefore load directly without first visiting the site root.
