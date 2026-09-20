# OpenSaddle workbench style guide

The layout follows the focus and density of Codex, with OpenSaddle's own plum, coral and sunset identity. Production tokens and component rules live in `src/styles/workbench-theme.css`; this guide describes their intended use. Do not introduce page-specific substitute palettes.

## Color

| Role | Light | Dark | Use |
| --- | --- | --- | --- |
| Canvas | `#fcfaff` | `#19171e` | Main work surface |
| Sidebar | `#f3eef9` | `#211c2a` | Stable navigation |
| Card | `#ffffff` | `#211e27` | Grouped content and inputs |
| Primary text | `#2d2338` | `#f5f0fa` | Headings and body |
| Secondary text | `#756481` | `#b5a9c1` | Supporting context |
| Plum / primary | `#7044b5` | `#c6a3ff` | Main action, selected navigation, focus |
| Coral | `#b33c6a` | `#fb94b5` | Small brand highlights and hero tint |
| Soft selection | `#f0e6fb` | `#352542` | Active row background |
| Border | `#e7deef` | `#3b3346` | Quiet grouping; use stronger border on inputs when needed |

Use semantic green for successful execution, amber for attention, red for failure, and purple for approvals. Keep text labels with color. Execution completion and verification are separate states. A colorful status must not imply verified evidence or permission approval.

## Type and spacing

- System/Inter sans for interface text; SF Mono/Consolas for code and identifiers.
- Page invitation: 30px, weight 550, tight tracking; mobile 26px.
- Objective: 21px, weight 550; panel headings 15px; body 13–14px; navigation 12px; metadata 10–11px.
- Base spacing: 4px; use 8, 12, 16, 20, 24, 32 and 40px.
- Sidebar: 244px. Content width: up to 1040px. Composer: up to 880px.
- Corners: 7–8px rows/buttons, 12px panels, 14–16px composers, 20px welcome surface.

## Components

**Navigation:** one named sidebar, clear project labels, a plum active rail and tinted selection. Search stays visible. Put less frequent fleet/team controls in an expandable group; do not duplicate the project list as an icon rail.

**Task entry:** one prominent input-like link opens the real task form. It is a navigation link, not a fake editable composer. The actual task form carries source, agent and permission controls.

**Rows:** title first, state second, details last. Hover changes the surface slightly. Keep long IDs in inspection views. Avoid turning every row into a large card.

**Buttons:** one clear primary action per section. Secondary actions use quiet borders. Disabled controls explain what is missing nearby. Destructive and approval actions keep explicit labels and established authority checks.

**Search:** reuse the existing command palette with keyboard filtering, arrows, Enter and Escape. Do not create another index of private data.

**Feedback:** keep loading, empty, disconnected, denied and failed states distinct. Never replace real execution status with decorative animations.

## Accessibility and motion

Retain high-contrast colors and visible focus rings. Selected state uses shape/rail plus color. Keep native links, buttons and disclosure controls. Use color/background transitions of 120ms; disable them under reduced motion. Do not add continuously animated backgrounds, parallax, spring-driven navigation or moving text to the workspace.

## Verification boundary

This is a first workbench pass. Existing older screens still need migration to these component rules. Light native visuals and search navigation are checked separately from dark/high-contrast/mobile behavior and full task execution; do not imply all are qualified from one screenshot.
