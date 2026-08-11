# Backend Contracts

> Derives from `README.md`. Read the three-layer frame first.

## The headline

**The backend needs far less new work than the frontend.** The permission model and the
governed mutation lifecycle — the two genuinely hard parts — are already built. What is
missing is one entity, two resource kinds, and a registry.

## What already exists and is good

### Permission model

`src/types/index.ts:549-571`

```ts
type PrincipalKind = 'user' | 'group' | 'agent'
type ResourceKind  = 'organization' | 'project' | 'folder' | 'repository'
                   | 'source' | 'tool' | 'workflow' | 'thread' | 'agent'
type CapabilityAction = 'read' | 'write' | 'execute' | 'administer' | string

interface PermissionGrant {
  principalKind, principalId
  resourceKind, resourceId
  action, effect: 'allow' | 'deny'
  inheritance?: 'direct' | 'inherited' | 'override'
  approvalRequired?: boolean
  expiresAt?: number
  pathPrefix?: string
  scope?: 'once' | 'thread' | 'project' | 'organization'
  scopeId?: string
  usesRemaining?: number
  // …
}
```

This is a well-designed grant model. Note in particular:

- **`agent` is already a first-class principal kind.** Agents-as-principals — the thing
  that keeps the audit log meaningful and prevents silent privilege inheritance from the
  invoking user — is already modeled. Do not regress to agent-acts-as-user.
- `approvalRequired`, `expiresAt`, `scope`, `usesRemaining` together already express
  scoped, expiring, single-use, approval-gated grants.

`packages/control-plane/src/permissions.ts:12-88` — `evaluatePermissions()` already
implements user ∩ agent intersection with deny-wins.

### Governed mutation lifecycle

`/api/integrations/connections`, `/api/integrations/tools`,
`/api/integrations/invocations`, and
`/api/integrations/invocations/:id/{approve,deny,execute}`.

This is the approval-gated external mutation path. **Writeback must reuse it.** Do not
build a second mutation route — an artifact adapter is a *tool* in this model.

### Existing control-plane surface

```
/api/health          /api/workspace       /api/capabilities
/api/threads         /api/threads/search  /api/threads/available
/api/runs            /api/approvals       /api/runtimes
/api/permissions     /api/permissions/check  /api/permissions/grants
/api/harnesses       /api/harness-capabilities
/api/git/{status,branch,commit,compare,push,pull-request}
/api/routes/estimate /api/routes/telemetry
/api/local-sessions  /api/sites/generate  /api/public/sites/:slug
```

## What must be added

### 1. Resource kinds

```diff
 type ResourceKind =
   | 'organization' | 'project' | 'folder' | 'repository'
   | 'source' | 'tool' | 'workflow' | 'thread' | 'agent'
+  | 'artifact'   // an ExternalArtifact
+  | 'surface'    // a registered view
```

Grants on an `artifact` resolve through the **owning** Project via the existing
`inheritance: 'inherited'` mechanism. Do not add a parallel inheritance path.

### 2. `ExternalArtifact`

Identity is the provider-qualified tuple. **Never mint an OpenSaddle ticket id.**

```ts
interface ExternalArtifact {
  provider: string        // 'github' | 'jira' | 'fs' | …
  collection: string      // repo slug, project key, directory
  externalId: string      // issue number, story key, path
  title: string
  body?: string
  tags: string[]          // labels
  openState: 'open' | 'closed'
  assignees: string[]
  links: Array<{ rel: string; href: string }>
  fetchedAt: number
  raw: unknown            // provider-specific passthrough
}
```

**Field ownership is disjoint, and that is the whole point** — it means there is no
conflict resolution to write:

| Provider owns | OpenSaddle owns |
|---|---|
| title, body, tags, openState, assignees, comments | owning Project, linked Threads, produced Runs, in-workspace claim |

### 3. Linkage

- Artifact → Project: **exactly one owner**, N references. Ownership confers permission
  and mutation rights. References are read-only and owned by the referencing Project.
  (Rationale: with deny-wins, a multi-owner artifact would intermittently vanish for
  users holding access via another Project.)
- Artifact → Thread: **1:many over time**. Thread → Artifact: **0..1**.

### 4. Actionability projection

Declarative config, not code. Maps provider fields/labels onto the universal vocabulary:

```yaml
# example: wayfinder over github labels
states:
  blocked:     { labels: ["blocked"] }
  claimed:     { assignee: present }
  done:        { openState: closed }
  actionable:  { default: true }
```

`in-progress` is the one state OpenSaddle legitimately knows better than the provider —
derive it from live Thread/Run state and mark it clearly as a **local overlay**,
visually distinct from provider-derived state.

**Never persist a computed status field.** If a status column exists in the store, a
competing tracker has been built regardless of intent.

### 5. Two-gate authorization

`evaluatePermissions()` currently returns a single verdict. Mutation requires **both**
gates, evaluated independently:

1. OpenSaddle grant against the owning Project (deny wins)
2. Provider authorization for the acting identity's token

Neither substitutes for the other. The response must report **which** gate failed —
"your Project role cannot close tickets" and "you lack GitHub write on this repo" need
different remedies, and collapsing them into one `denied` is a support burden.

```ts
interface EffectivePermission {
  allowed: boolean
  reason: string
  gate?: 'workspace' | 'provider'   // NEW: which gate denied
  approvalRequired?: boolean
}
```

Re-check at mutation time. **Never trust the check that rendered the button** — sessions
outlive grants.

### 6. New endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/artifacts` | list, filtered by project/state; returns projected actionability |
| `GET /api/artifacts/:id` | single artifact, provider-qualified id |
| `POST /api/artifacts/:id/link` | attach to a Project as owner or reference |
| `POST /api/artifacts/:id/thread` | launch or resume; **idempotency key on `(artifact, project, active)`** |
| `GET /api/surfaces` | registered views, scoped per Project |
| `GET /api/entities/resolve` | batch entity resolution for `<EntityRef>` / `<EntityPicker>` |

Writeback goes through the existing `/api/integrations/invocations` lifecycle.

## Behavioral policy

### Writeback

**Write evidence, not judgment.**

- Run completes → post a comment with what happened. Additive, reversible, unattended.
- Ticket resolved → **human decision, approval-gated.** Automating closure means an agent
  decides a product question is settled.
- Reversibility is the test for what may be automated: a wrong comment is noise; a wrong
  closure loses a decision.
- Key writeback to Run **terminal** states, not Thread activity. A Thread that runs six
  times must not produce six comments.

### Staleness and failure

Since the provider is canonical, **every artifact the interface shows is a cache read.**

- Provider unavailable → serve cache, banner the degradation, **disable mutations.**
- **No optimistic updates for external mutations.** Optimism is right when you own the
  write; here an optimistic close that gets rejected has already told the user a false
  thing about a shared system other people are reading. Pend, show pending, reconcile.
- Concurrent claims → the provider arbitrates (last writer wins there); the interface
  reconciles. The loser must find out fast and *specifically*: "Maya claimed this 30s ago",
  not a generic conflict error.
- Partial write failure → keep operations independently retryable. Comment-then-close is
  two auditable steps; a failed close leaves a posted comment, not a half-state to unwind.
- A Thread whose artifact closed underneath it is **not an error**. Surface it, let the
  human decide, do not auto-terminate work someone may still want.

## Non-goals

State these in any implementation handoff:

- OpenSaddle stores no authoritative artifact status
- OpenSaddle mints no artifact ids
- Externally visible mutations are approval-gated by default
- No registered view has privileged data access
