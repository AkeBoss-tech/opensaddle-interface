# Open Saddle Product UX Blueprint

**Status:** Design-review decisions captured for implementation  
**Scope:** Open Saddle interface (web and Electron clients)  
**Example project:** Scarlet Sync

## Purpose and product model

Open Saddle Runtime is the shared control plane for the work performed in Open
Saddle. It owns the durable, auditable record of projects, identities,
permissions, knowledge, agents, runs, audits, versions, and artifacts.

Web and Electron are clients of that control plane, not separate products with
different conceptual models. Electron may additionally expose capabilities of
the user's computer: local folders and repositories, a SQLite cache, and
locally installed coding runtimes. Those capabilities must appear only when
available and must not redefine the shared workspace model.

The interface should let a person answer four questions quickly:

1. Where am I in the workspace, and what artifact am I viewing?
2. What can this person or agent read, change, or use here?
3. What is running, what changed, and what requires approval?
4. Is the displayed information current from the runtime or a local fallback?

## Information architecture

The primary containment and inheritance chain is:

```text
Organization
  └── Team
        └── Project (for example, Scarlet Sync)
              └── Folder / nested project
                    └── Artifact
```

An artifact is the user-facing output or working surface of a project: a wiki,
site, coding-agent workspace, document, run output, version, or similar
deliverable. Runs, audits, agents, and knowledge are related resources that
are always shown in the context of this chain, even when they have their own
views.

Use the containment chain for navigation, selection, inheritance, and access
scope. Do not repeat a long `Organization / Team / Project` breadcrumb in each
main header. The selected item in the sidebar establishes context. A compact
context label or an overflow menu is acceptable when users need to change or
inspect the active scope.

### Sidebar: the persistent navigator

The sidebar is the durable orientation surface. It contains, in this order:

1. **Workspace controls** — workspace switching and global actions.
2. **Project tree** — organization, team, projects, nested projects/folders,
   and their artifacts; Scarlet Sync is a representative project in this tree.
3. **Runs** — active, waiting-for-approval, and recent runs relevant to the
   selected scope, with a route to the fuller run history.

The project tree is the place to reveal hierarchy. It should support expand,
collapse, selection, and contextual actions without requiring a separate
hierarchy page for ordinary navigation. Show a meaningful state badge only
when it helps scanning (for example, a running indicator or approval count).

At the upper-left, consolidate controls into exactly two persistent controls:

- **Workspace switcher:** product/workspace identity plus a menu for switching
  workspace, team, or administrative context and for global workspace actions.
- **Sidebar toggle:** collapses or restores the navigator.

Do not retain independent, competing app-brand, organization/team selector,
and project selector controls in this area. On small screens, the same sidebar
becomes the navigation drawer; the control semantics remain unchanged.

### Main canvas

The main canvas is for the selected artifact or operational view, not for
repeating navigation chrome. Use a concise header containing only what helps
perform the current task: artifact name, state, key action, and a compact
context affordance where needed.

Cross-cutting configuration such as access, inheritance, connected runtime,
and version details belongs in a drawer or dedicated scope/settings view,
rather than dominating every artifact canvas.

## Artifact canvas patterns

Artifact types share the sidebar context and run model, but each has a
different primary working surface. Do not force them into one generic page
template.

| Artifact | Foreground of the canvas | Secondary information | Default interaction |
| --- | --- | --- | --- |
| Wiki | Wikipedia-like reading, in-page structure, and page-to-page navigation | Wiki settings and source/configuration controls in a drawer | Read, navigate, search, then edit or configure intentionally |
| Site | Live preview | Publishing status, version/history, assigned agent, and details in a drawer | Inspect the preview, then publish, compare, or configure from the drawer |
| Coding agent | Title, purpose, task composer, and recent work | Workflows and nested projects are secondary navigation/context | State the goal, start or continue work, and review recent output |

### Wiki

The wiki should feel like a knowledge product first: clear reading typography,
table of contents, linked pages, search, and visible provenance where useful.
Keep page navigation in the canvas or artifact-level navigation. Put settings,
connected knowledge, indexing, and access configuration in a drawer so they do
not displace the page being read.

### Site

The site canvas prioritizes the rendered experience. The preview remains the
dominant surface across viewports. A details drawer contains publishing,
version selection/history, assigned agent, and technical or ownership details.
Publishing actions must identify the target, selected version, approval state,
and whether an action changes a live destination.

### Coding agent

The coding-agent canvas starts with the work, not a generic agent profile:

- a clear title and one-sentence purpose;
- a composer that establishes or continues the task;
- recent work, run state, outputs, and reviewable changes.

Workflows and nested projects remain accessible but secondary. A coding agent
can be assigned to a project or folder; it should retain the visible scope of
the task and the resource lineage used for it.

## Shared inheritance and access model

Skills, knowledge, permissions, and runtime connections inherit down this
chain:

```text
Organization → Team → Project → Folder / nested project → Artifact or run
```

An inherited value is the effective default. A child may make a narrow,
explicit override. Avoid copy-on-write configuration screens that make every
child look independently configured. The UI should show the effective value,
its source, and a deliberate action to override it at the current scope.

Examples:

- An organization-approved knowledge source is available to Scarlet Sync unless
  a narrower policy limits it.
- Scarlet Sync may grant a coding agent access to one repository folder without
  changing access for the rest of the team.
- A nested project may select a different coding-runtime connection while still
  inheriting its team’s skills and knowledge policy.

### Access UI requirements

Every access surface — resource details, agent configuration, approval prompt,
and run inspector — must make these facts legible:

| Field | Meaning |
| --- | --- |
| **Can read** | Data the subject may view or retrieve. |
| **Can change** | Data, configuration, or artifacts the subject may modify. |
| **Can use** | Tools, skills, knowledge sources, runtime connections, or services the subject may invoke. |
| **Scope** | The organization, team, project, folder, artifact, or single-run boundary where the permission applies. |
| **Source** | Whether the effective permission is inherited, directly granted, overridden, or explicitly denied, including the originating scope. |
| **Approval** | Whether use is allowed now, denied, or requires an approval; show the approver and expiry when applicable. |

Show effective access first, then reveal the policy lineage and edit controls.
If a policy conflicts, display the governing result and why. Explicit denial
continues to win, and an agent’s execution access is constrained by both the
initiating person and the agent’s grants.

## Runtime and client boundary

The runtime remains the system of record for shared workspace state, policies,
run events, audit records, artifacts, and versions. Client-specific features
must be labeled as local capabilities rather than being presented as shared
workspace resources.

| Capability | Web client | Electron client |
| --- | --- | --- |
| Shared projects, identities, permissions, knowledge, agents, runs, audits, versions, and artifacts | Consumes the shared runtime | Consumes the shared runtime |
| Local folders and repositories | Only through an explicitly available browser capability or remote connection | Native local selection and repository access, within approved scope |
| Local SQLite cache | Optional browser storage/cache | Local SQLite cache may support richer offline work |
| Locally installed coding runtimes | Not assumed | Discoverable and selectable when installed and permitted |

### Coding runtimes are adapters

Codex, Claude Code, and future coding tools are pluggable runtime adapters.
Open Saddle selects, configures, invokes, and observes them through a common
adapter contract; it does not attempt to reproduce each tool’s native
interface. The product UI should expose the common decision points:

- adapter/provider identity and availability;
- execution environment and project/folder scope;
- effective access and approval requirements;
- task status, streamed events, outputs, files changed, and audit trail.

Tool-specific setup or diagnostics may be available behind an adapter details
surface, but the main coding canvas remains consistent across providers.

## Offline and degraded operation

Offline cache is an explicit fallback, never an invisible alternate source of
truth. When the client cannot reach the runtime, show a persistent but
non-disruptive status that identifies:

- that the view is using cached data;
- when the cached data was last synchronized;
- which actions are unavailable, queued, or locally provisional;
- how to retry and how reconciliation will occur after reconnecting.

Do not present a cached permission state as authorization for an action that
requires online runtime validation. Clearly distinguish read-only cached
content, locally staged work, queued requests, and completed runtime actions.
Where an Electron-only local capability is involved, distinguish local machine
state from synchronized project state in both wording and visual treatment.

## Implementation sequence

1. **Establish context primitives.** Model the selected organization, team,
   project, folder, and artifact as one shared navigation context; use it for
   tree selection, resource queries, and scope-aware actions.
2. **Recompose navigation.** Make the sidebar project tree and runs the
   persistent navigator. Consolidate upper-left controls into the workspace
   switcher and sidebar toggle; remove duplicated header breadcrumbs/selectors.
3. **Create an artifact-shell contract.** Support artifact-specific foreground
   canvases plus a standard drawer API for details, versions, publishing,
   ownership, and settings.
4. **Implement the three primary canvases.** Start with wiki reading/navigation,
   site preview, and coding-agent task/recent-work surfaces; preserve their
   distinct primary task flows.
5. **Add effective-policy presentation.** Reuse a single access summary and
   lineage component wherever a person decides, grants, approves, or reviews
   access.
6. **Introduce runtime adapters.** Represent coding providers through shared
   adapter metadata and run events, with Electron capability discovery isolated
   from server/client shared data.
7. **Make fallback visible.** Add connection, cache-age, queue, and
   reconciliation states before enabling offline-capable mutations.

## Acceptance checks

- A user can navigate to `Scarlet Sync → artifact` from the sidebar without
  reading a repeated long breadcrumb in the main header.
- The top-left has one workspace switcher and one sidebar toggle, with no
  competing organization, team, or project selectors.
- Wiki, site, and coding-agent artifacts each foreground their stated task;
  settings and operational detail do not displace that work.
- Any effective permission visibly answers can read, can change, can use,
  scope, source, and approval.
- A narrower policy can override an inherited default without obscuring the
  parent source or creating an unrelated copy of configuration.
- Codex and Claude Code can be represented as selectable adapters without
  embedding or imitating their proprietary/full native interfaces.
- An offline user can tell cached state from runtime-confirmed state and cannot
  mistake stale authorization for current authorization.

## Open implementation questions

These are intentionally not settled by the design review and need product or
technical decisions before detailed implementation:

- Which artifact types beyond wiki, site, and coding agent are first-class in
  the initial navigator and artifact-shell contract?
- Which offline mutations, if any, may queue locally, and how should conflicts
  be resolved after reconnecting?
- What adapter contract is required for third-party coding runtimes beyond
  discovery, invocation, event streaming, and audit metadata?
- Which scopes can grant exceptions, and which organization policies must be
  immutable at narrower scopes?
