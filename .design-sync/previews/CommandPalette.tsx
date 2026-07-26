import { CommandPalette, type PaletteItem } from 'opensaddle-interface'

const ITEMS: PaletteItem[] = [
  { id: 'chat', group: 'Go to', label: 'New chat', icon: 'plus', run: () => {} },
  { id: 'runs', group: 'Go to', label: 'Runs & automations', icon: 'clock', run: () => {} },
  { id: 'env', group: 'Go to', label: 'Environments', icon: 'vm', run: () => {} },
  { id: 'plugins', group: 'Go to', label: 'Plugin store', icon: 'plugin', run: () => {} },
  { id: 'usage', group: 'Go to', label: 'Usage & budgets', icon: 'chart', run: () => {} },
  { id: 'settings', group: 'Go to', label: 'Settings', icon: 'settings', run: () => {} },
  { id: 'proj', group: 'Actions', label: 'Create project', icon: 'folder', run: () => {} },
  { id: 'theme', group: 'Actions', label: 'Toggle theme', icon: 'sun', run: () => {} },
  { id: 'reset', group: 'Actions', label: 'Reset demo data', icon: 'refresh', run: () => {} },
]

export function Open() {
  return (
    <div style={{ background: 'var(--bg)' }}>
      <CommandPalette open onClose={() => {}} items={ITEMS} />
    </div>
  )
}
