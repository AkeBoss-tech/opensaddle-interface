import { Icon } from 'opensaddle-interface'

const NAMES = ['plus', 'search', 'folder', 'chevron', 'clock', 'settings', 'message', 'bell', 'shield', 'globe', 'file', 'sun']

export function Default() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, padding: 16, background: 'var(--bg)', color: 'var(--text)' }}>
      {NAMES.map((name) => (
        <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 64 }}>
          <Icon name={name} className="icon" />
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{name}</span>
        </div>
      ))}
    </div>
  )
}

export function Sizes() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 16, background: 'var(--bg)', color: 'var(--text)' }}>
      <Icon name="spark" className="icon sm" />
      <Icon name="spark" className="icon" />
      <Icon name="spark" className="icon lg" />
    </div>
  )
}
