# OpenSaddle Architecture: Substrate, Projection, Surface

> Status: agreed direction, 2026-08-01. This is the frame every other document in
> `docs/architecture/` derives from. Read this first.

## The product goal

A team should be able to bring its own methodology to OpenSaddle rather than adopt one.

- A team that plans with **Wayfinder** gets a DAG of decision tickets with a frontier.
- A team that runs **agile** gets a Jira-style board with columns and WIP limits.
- A team that runs a **spec-driven software factory** gets a spec tree where approved,
  unimplemented specs are the work queue.

These are not three features. They are three *views* over one mechanism.

| | Wayfinder | Jira-style board | Spec factory |
|---|---|---|---|
| Artifacts | decision tickets | stories | specs |
| View | DAG / map | kanban columns | tree |
| "What can I pick up?" | frontier | unblocked in sprint | approved, unimplemented |
| Start work | → Thread | → Thread | → Thread |
| Write back | comment + close | move column | mark implemented |

Four of five rows are identical mechanisms with different vocabulary. **Only the view
genuinely differs.** That is the entire architectural thesis.

## The three layers

### Substrate

Identity, permission, Project, Thread, Run, approval, audit.

Small, stable, and **methodology-blind**. The substrate must never learn what a
"frontier" or a "sprint" or a "spec" is.

> **Rule:** if the substrate contains a concept that only one methodology uses, the
> membrane has already leaked.

### Projection

Actionability, status, inbox ranking, unread state, staleness.

Pure functions over substrate + external data. **Never stored.**

> **Rule:** if you cannot recompute it from scratch, it is substrate, not projection.

Storing a methodology's status is how you accidentally build a competing tracker. The
canonical source stays canonical precisely because nothing local claims authority.

### Surface

Channel, board, map, spec tree, wiki, Work inbox.

Many, pluggable, replaceable. Renders projections and dispatches intents.

> **Rule:** surfaces own no state.

## Why this frame earns its keep

It is a diagnostic, not a philosophy. Every known defect in the interface is one of the
two rules being broken:

| Symptom | Location | Violation |
|---|---|---|
| `@mention` is a regex that substring-matches an agent name, then strips the text | `src/pages/ChatPage.tsx:751-780` | Channel surface performing entity resolution the substrate should own |
| Skills exist only as a field on an imported local folder | `src/types/index.ts:48,73` | Substrate concept modeled as a surface-local field |
| Reactions are a single hardcoded 👍 counter in `useState`, styled at 8px | `src/pages/ChatPage.tsx:1854`, `src/styles/team-channel.css:263` | Surface owning state |
| Risk of an authoritative ticket-status column | proposed, not yet built | Substrate learning a methodology |
| ~35 hardcoded routes; no plugin type contributes UI | `src/App.tsx:211-247` | No surface layer exists at all |

These are not five problems. They are one problem with five faces: **there is no membrane
between substrate and surface.**

## The consequence for Wayfinder

Wayfinder is consumer #1 of a capability that has not been scoped. Built alone, its
artifact model, linkage, actionability projection, and writeback policy become private
Wayfinder internals, and the second methodology pays for the migration.

Name things generically. `ExternalArtifact`, not `WayfinderTicket`. That single naming
decision is the fork in the road.

## The honest counterargument

Generalizing from one consumer is the standard way to produce the wrong abstraction. A
view registry, an artifact entity, and a component tier is real scaffolding to build
before any team gets a working board.

Mitigation, in order of preference:

1. Build **two** view consumers simultaneously (Wayfinder DAG + a minimal board) against
   shared layers. Two is the minimum that produces a real boundary.
2. Note that **Slice 1** (`<EntityRef>` / `<EntityPicker>`) is unconditionally correct —
   it fixes shipped defects today and needs no backend change. Do it regardless.
3. Treat slices 3–5 as the genuine bet, and be deliberate about where commitment ends.

## Documents

| File | Contents |
|---|---|
| `README.md` | This document — the frame |
| `ui-components.md` | Component specs, three tiers |
| `backend-contracts.md` | Permission model deltas, endpoints, adapter boundary |
| `roadmap.md` | Slices, sequencing, acceptance criteria |
