# Scaffold proposal notes

- The proposal application mapper creates `Member` inputs, but `StoreApi` has no member-create/upsert method. The review page therefore cannot persist selected git-log members without expanding the store API (outside this task's owned files). All currently supported entities are committed only after explicit Create.
