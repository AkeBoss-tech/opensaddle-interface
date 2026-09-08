# Interface invariants

- **LOCAL-PROJECT-EMPTY-START-1** — A new Interface workspace contains no fabricated Projects, people, machines, Runs, or conversations. Local Projects appear only after the authoritative local service registers a user-selected folder and remain available after the service restarts.
- **AUTHORIZED-CONTEXT-INSPECTOR-1** — A Run Inspector shows only a currently reauthorized immutable launch packet whose packet, request, capability, Project, and Run identities match the admitted Run. Protected packet content is cleared before refresh and synchronously on authority, Project, or Run replacement; denial and malformed responses reveal only an unavailable state.
