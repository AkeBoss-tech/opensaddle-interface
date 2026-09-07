# Signed renderer state contract dependency

Interface treats renderer state as package-defined data. It does not execute package-supplied migration code.

Core catalog and selected-renderer projections need these signed contribution fields:

- `state_schema_version`: positive integer.
- `state_schema`: a bounded scalar-object schema: `type: object`, `additionalProperties: false`, `maxProperties` 0–32, and explicit property definitions limited to bounded strings, finite numbers, or booleans. Optional `required` names must exist in `properties`.
- `state_migrations`: at most one declared edge per source/target version. Each edge has `from_version`, `to_version`, and at most 16 declarative operations: `rename`, `drop`, or `set_default`. Paths are top-level declared keys. Unknown fields and operations are invalid.

Core should reject malformed schemas, ambiguous duplicate edges, rename collisions, defaults that do not validate against the destination property, migration output that cannot satisfy the destination schema, and undeclared lossy changes at package installation. Catalog/content responses must preserve the exact signed fields.

The host validates state against the active schema on every inbound renderer message and before every init. Replacement applies only the exact signed edge and validates its output. Missing or invalid migration starts the replacement with empty state and reports that loss. Rollback restores the exact prior package snapshot; it never guesses an inverse migration.
