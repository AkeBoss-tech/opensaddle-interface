import { useEffect, useState } from 'react'
import type { ProjectOnboardingRunner } from '../../services/contracts'
import { Button, Dialog } from '../../ui'

export function ConnectedLocalProjectDialog({ open, onClose, onRegister }: {
  open: boolean
  onClose: () => void
  onRegister: (input: { root: string; runner: ProjectOnboardingRunner }) => Promise<void>
}) {
  const [root, setRoot] = useState('')
  const [runner, setRunner] = useState<ProjectOnboardingRunner>('codex_cli')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!open) { setRoot(''); setError(null) } }, [open])
  const choose = async () => {
    const selected = await window.opensaddle?.pickRepository?.()
    if (selected) setRoot(selected)
  }
  const submit = async () => {
    if (!root.trim()) return
    setBusy(true); setError(null)
    try { await onRegister({ root: root.trim(), runner }); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onClose={onClose} title="Add local project">
    <p>Registration records the selected root. OpenSaddle derives the project identity and discovers source evidence on the server.</p>
    <label>Project folder
      <span className="add-project-folder-picker">
        <input value={root} readOnly={Boolean(window.opensaddle?.pickRepository)} onChange={(event) => setRoot(event.target.value)} placeholder="/path/to/project" />
        {window.opensaddle?.pickRepository && <Button variant="secondary" onClick={() => void choose()}>Choose folder</Button>}
      </span>
    </label>
    <label>Runner<select value={runner} onChange={(event) => setRunner(event.target.value as ProjectOnboardingRunner)}><option value="codex_cli">Codex CLI</option><option value="claude_code">Claude Code</option></select></label>
    {error && <p role="alert" className="error-text">{error}</p>}
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !root.trim()} onClick={() => void submit()}>{busy ? 'Registering…' : 'Register project'}</Button></div>
  </Dialog>
}
