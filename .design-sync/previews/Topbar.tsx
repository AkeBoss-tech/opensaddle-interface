import { Topbar } from 'opensaddle-interface'

const crumbs = (
  <>
    <span>OpenSaddle</span>
    <span>/</span>
    <strong>Runs & automations</strong>
  </>
)

export function Default() {
  return (
    <div style={{ background: 'var(--bg)' }}>
      <Topbar
        crumbs={crumbs}
        sidebarCollapsed={false}
        onToggleSidebar={() => {}}
        onBack={() => {}}
        onForward={() => {}}
        onPalette={() => {}}
        onBrowser={() => {}}
      />
    </div>
  )
}
