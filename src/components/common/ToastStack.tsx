import { useStore } from '../../data/store'

export function ToastStack() {
  const { toasts, dismissToast } = useStore()
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <div key={t.id} className="toast" onClick={() => dismissToast(t.id)}>
          <div style={{ width: 23, height: 23, borderRadius: 7, border: '1px solid var(--border-strong)', display: 'grid', placeItems: 'center', color: '#9bdab0', flex: '0 0 auto' }}>✓</div>
          <div><strong>{t.title}</strong><span>{t.message}</span></div>
        </div>
      ))}
    </div>
  )
}
