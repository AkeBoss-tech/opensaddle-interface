import { useState } from 'react'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'

type Authority = 'source_managed' | 'opensaddle_managed' | 'hybrid'

const MODES: Array<{ id: Authority; title: string; description: string }> = [
  { id: 'source_managed', title: 'Keep Codex / Claude permissions', description: 'Resume through the original harness. OpenSaddle records the link but cannot enforce actions that run outside it.' },
  { id: 'opensaddle_managed', title: 'Adopt into OpenSaddle', description: 'Continue from a checkpoint using OpenSaddle workers, grants, approvals, and audit policy.' },
  { id: 'hybrid', title: 'Use both', description: 'Keep source context and workspace continuity while OpenSaddle governs new privileged actions.' },
]

export function SessionBridgePage() {
  const { data, toast } = useStore()
  const [harness, setHarness] = useState('codex')
  const [sessionId, setSessionId] = useState('')
  const [location, setLocation] = useState('')
  const [mode, setMode] = useState<Authority>('hybrid')
  const [linked, setLinked] = useState(false)
  const canLink = Boolean(sessionId.trim() && location.trim())

  const link = () => {
    if (!canLink) return
    // The desktop/API bridge persists this binding; this interface intentionally
    // does not read a transcript until the user explicitly starts a continuation.
    setLinked(true)
    toast('Session linked', `${harness === 'codex' ? 'Codex' : 'Claude Code'} · ${MODES.find((item) => item.id === mode)?.title}`)
  }

  return <div className="content-page">
    <div className="page-header">
      <div className="page-header-copy"><div className="eyebrow">Project {data.projects.find((p) => p.id === data.activeProjectId)?.name ?? 'workspace'}</div><h1>Continue an existing session</h1><p>Link a local Codex or Claude Code session, choose who governs future actions, and keep a durable handoff checkpoint.</p></div>
    </div>
    <div className="grid-2">
      <div className="card"><div className="card-header"><div><h3>Source session</h3><p>Nothing is copied until you choose to continue it.</p></div></div><div className="card-body">
        <div className="form-row"><label>Harness</label><select value={harness} onChange={(e) => setHarness(e.target.value)}><option value="codex">Codex</option><option value="claude_code">Claude Code</option><option value="other">Another compatible harness</option></select></div>
        <div className="form-row"><label>Session / thread ID</label><input value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="Paste the source session ID" /></div>
        <div className="form-row"><label>Local transcript or workspace</label><input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="/path/to/session.jsonl or repository" /></div>
        <div className="scope-box"><strong>Privacy boundary</strong><p>OpenSaddle stores the source reference and checkpoint digest. Raw transcript import requires a separate, explicit action.</p></div>
      </div></div>
      <div className="card"><div className="card-header"><div><h3>Authority for future work</h3><p>Historical permissions stay historical; this setting governs the next action.</p></div></div><div className="card-body">
        {MODES.map((item) => <button type="button" key={item.id} className={`permission-row ${mode === item.id ? 'selected' : ''}`} onClick={() => setMode(item.id)} style={{ width: '100%', textAlign: 'left', marginBottom: 8 }}><Icon name={mode === item.id ? 'check' : 'shield'} className="icon sm" /><span><strong>{item.title}</strong><small>{item.description}</small></span></button>)}
        <button className="primary-btn" disabled={!canLink} onClick={link}><Icon name="play" className="icon sm" />Link and prepare continuation</button>
        {linked && <div className="scope-box" style={{ marginTop: 14 }}><strong>Ready to continue</strong><p>Open the Desktop harness to resume source-managed work, or start a governed OpenSaddle continuation from the saved checkpoint.</p></div>}
      </div></div>
    </div>
  </div>
}
