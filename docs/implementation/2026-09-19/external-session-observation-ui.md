# External-session registry observation

Core now accepts only `source_managed` for new external-session registration and
checkpoint requests. A registry entry records source metadata; it does not
prove that OpenSaddle enforced the native harness's tools or permissions.
Operations accordingly labels every external entry **Observed** and keeps the
separate Core Run section for managed execution evidence. A legacy row's
`declared_authority_mode` and `recorded_authority_hash` appear in detail only
as an unverified historical declaration. The transport rejects an unprojected
managed/cooperative effective mode instead of displaying it as current
authority. The create/checkpoint client accepts only `source_managed`, including
at runtime when called from untyped JavaScript.

Invariant: `EXTERNAL-SESSION-OBSERVATION-1` in `docs/testing/invariants.md`.
The mounted Operations assertion failed before this change because only one
of three external rows displayed `Observed`; the other two displayed
`Cooperative` and `Managed`. The same assertion passes now. Owning transport
and mounted tests passed 13/13, TypeScript typecheck and production build
passed, lint exited 0 (existing warnings elsewhere), and `git diff --check`
passed.

This patch does not alter local native-chat continuation modes in
`SessionBridgePage`; those use a separate local execution path and need their
own authority review. It also does not alter native Run status or policy
labels. A packaged desktop visual journey was not run for this label-only
registry change; the mounted page test verifies the rendered content.
