## OpenSaddle UI — build conventions

**Wrap every composition in the real app providers.** These components read
from OpenSaddle's own React context and router — without both, hooks throw
and nothing renders:

```jsx
import { StoreProvider, MemoryRouter, Sidebar, Topbar } from '<pkg>'

<StoreProvider>
  <MemoryRouter>
    <div style={{ display: 'flex' }}>
      <Sidebar onCreateProject={() => {}} />
      {/* ...rest of the layout */}
    </div>
  </MemoryRouter>
</StoreProvider>
```

`StoreProvider` seeds itself with realistic demo data (projects, chats,
members, notifications) automatically — don't pass mock data in, just wrap.
Components that read `useNavigate`/`useLocation` (`Sidebar`, `Topbar`,
`CommandPalette`) need `MemoryRouter` (or another router) as an ancestor.

**Styling idiom: semantic class names + CSS custom-property tokens, not
utility classes.** There's no Tailwind-style atom vocabulary here — each
component owns a small set of purpose-named classes (`.sidebar`, `.topbar`,
`.nav-item`, `.tree-row`, `.palette-item`, `.toast`, `.icon-btn`), and color/
spacing/motion come from CSS variables defined at `:root`. Reuse the existing
class names for a given component rather than inventing new ones. Key tokens:

| Token | Use |
|---|---|
| `--bg`, `--bg-elevated`, `--card`, `--surface` | Surface layers, darkest to lightest |
| `--text`, `--muted`, `--dim` | Text emphasis levels |
| `--accent`, `--accent-2` | Primary / secondary accent (links, active states) |
| `--border`, `--border-strong` | Hairline vs. emphasized borders |
| `--radius`, `--radius-sm` | Corner radii |
| `--motion-fast/normal/slow`, `--ease-enter/exit/spring` | Transition timing |

Icons are a single component, not a set of files: `<Icon name="settings" className="icon sm" />`.
Size via `.icon.sm` (15px) / `.icon` (18px, default) / `.icon.lg` (22px) /
`.icon.xl` (30px), never inline width/height.

**Where the truth lives.** Read `styles.css` (and its `@import` closure,
including `_ds_bundle.css`) for the full token list and every component's real
CSS before styling anything new. Each component's `.prompt.md` documents its
exact props.

**Idiomatic example** — a labeled icon button, the pattern used throughout
the nav and topbar:

```jsx
<button className="icon-btn" title="Notifications">
  <Icon name="bell" />
</button>
```
