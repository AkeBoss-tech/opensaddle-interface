# Personal dashboard layout

The connected landing page discovers `dashboard_layout_v1` and reads the user's
saved widget order from Core. Customize dashboard provides native checkboxes,
move-up/down buttons, Save dashboard, Use default layout and Reload saved layout.
Only successful saves update visible content. Saved order is actual DOM order,
including for keyboard and assistive-technology navigation; CSS does not reorder
it independently. Empty layouts have a route back to customization.

Conflict errors retain the draft. Reload saved layout explicitly replaces the
draft with current server state. Account/connection changes clear old layout and
ignore late requests. On an unavailable settings read, the host shows its default
layout and offers another read. Older servers retain the default dashboard without
advertising customization. Core owns authentication and authorization for all
underlying dashboard data.

Unrecognized widget IDs remain as unavailable placeholders and can be removed.
They never load URLs, scripts or plugins. This checkpoint still uses the five
built-in widgets; a signed widget contribution host and a cross-Project manager
conversation remain unfinished. Global navigation and authority controls remain
outside the customizable content.

Twelve focused dashboard/Command Center tests and the production build pass.
The real browser could not be opened on 2026-09-10 because the Mac was locked.
Visual appearance, keyboard operation and actual browser save/reload therefore
remain pending, distinct from Core's tested restart persistence.
