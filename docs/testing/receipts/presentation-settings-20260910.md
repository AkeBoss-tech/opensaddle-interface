# Scoped appearance UI

Core scope test and mounted editor test passed. Renderer and Electron builds passed. In a disposable loopback Core/Chrome fixture, personal light theme and compact spacing applied after save. A private Astra-demo dark override took precedence, and resetting it restored personal light defaults. Effective value provenance is shown in the page.

Evidence: out/screenshots/presentation-settings-20260910/project-override.png and inherited.png. Screenshots were captured before provenance labels were renamed to plain-language scope labels. No real account settings were changed. Tests cover preserved Perspective keys, exact revision writes, inheritance reset and conflict handling; Core covers permissions and restart persistence.

Scope limits: density currently affects host navigation; plugin layout density and Perspective activation are pending. Team settings and mobile/accessibility review remain pending. Legacy palette theme shortcuts still require consolidation with scoped settings.
