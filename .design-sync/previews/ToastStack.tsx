import { useEffect } from 'react'
import { ToastStack, useStore } from 'opensaddle-interface'

function Seeded() {
  const { toast } = useStore()
  useEffect(() => {
    toast('Profile switched', 'Sam Rivera · Editor — permissions re-evaluated')
    toast('Data reset', 'Demo workspace restored from seed.')
  }, [toast])
  return <ToastStack />
}

export function Default() {
  return (
    <div style={{ position: 'relative', minHeight: 160, background: 'var(--bg)', padding: 16 }}>
      <Seeded />
    </div>
  )
}
