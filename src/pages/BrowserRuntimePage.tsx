import { useState } from 'react'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'

export function BrowserRuntimePage() {
  const { data, services, toast } = useStore()
  const [code, setCode] = useState("console.log('browser runtime ready'); return 2 + 2;")
  const [output, setOutput] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (tool: 'javascript.execute' | 'filesystem.read' | 'filesystem.write' | 'http.fetch') => {
    if (!services?.browserRuntime) return
    setBusy(true)
    try {
      const result = await services.browserRuntime.call({
        tool,
        projectId: data.activeProjectId,
        userId: data.currentUserId,
        args: tool === 'javascript.execute' ? { code } : tool === 'filesystem.read' ? { path: 'README.md' } : tool === 'filesystem.write' ? { path: 'runtime/hello.txt', content: 'Written by the browser agent runtime.\n' } : { url: 'https://example.com' },
      })
      setOutput(JSON.stringify(result, null, 2))
      if (!result.ok) toast('Runtime blocked', result.error ?? 'Tool failed')
    } catch (error) {
      toast('Runtime error', error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Browser operating system</div>
          <h1>Browser agent runtime</h1>
          <p>Capability-controlled tools backed by Workers, OPFS, and the browser network boundary.</p>
        </div>
        <div className="page-header-actions"><span className="status-pill green">Local-first</span></div>
      </div>
      <div className="grid-2">
        <div className="card">
          <div className="card-header"><div><h3>Tool invocations</h3><p>Every call is scoped and emitted as an event.</p></div></div>
          <div className="card-body">
            <div className="form-row"><label>JavaScript Worker code</label><textarea className="files-editor sandbox" value={code} onChange={(event) => setCode(event.target.value)} /></div>
            <div className="row-actions" style={{ flexWrap: 'wrap' }}>
              <button className="primary-btn" disabled={busy} onClick={() => void run('javascript.execute')}><Icon name="play" className="icon sm" />Run Worker</button>
              <button className="secondary-btn" disabled={busy} onClick={() => void run('filesystem.read')}>Read project file</button>
              <button className="secondary-btn" disabled={busy} onClick={() => void run('filesystem.write')}>Write artifact</button>
              <button className="secondary-btn" disabled={busy} onClick={() => void run('http.fetch')}>Fetch HTTPS</button>
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><div><h3>Invocation trace</h3><p>Structured result and audit events.</p></div></div>
          <div className="card-body"><pre className="api-console" style={{ minHeight: 260, whiteSpace: 'pre-wrap' }}>{output || 'Run a tool to inspect its result.'}</pre></div>
        </div>
      </div>
    </div>
  )
}
