import { useEffect, useState } from 'react'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import type { FileEntry } from '../services/contracts'
import { can } from '../services/capabilities'
import { evaluatePermissions } from '../services/permissions'

export function FilesPage() {
  const { services, toast, runtimeModeLabel, data } = useStore()
  const [path, setPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [newName, setNewName] = useState('notes.md')
  const [quota, setQuota] = useState<{ used: number; available: number } | null>(null)
  const [sandboxCode, setSandboxCode] = useState(`const text = fs.readFile('README.md');\nconsole.log('chars', text.length);\nfs.writeFile('sandbox/out.txt', 'ok');\nreturn text.slice(0, 80);`)
  const [sandboxOut, setSandboxOut] = useState('')
  const enabled = can('files.opfs')

  const refresh = async () => {
    if (!services?.files) return
    setEntries(await services.files.list(path))
    if (services.files.quota) setQuota(await services.files.quota())
  }

  useEffect(() => { void refresh() }, [services, path])

  const openEntry = async (entry: FileEntry) => {
    if (entry.kind === 'directory') {
      setPath(entry.path)
      setSelected(null)
      setContent('')
      return
    }
    if (!services?.files) return
    setSelected(entry.path)
    setContent(await services.files.read(entry.path))
  }

  const checkWrite = () => {
    const check = evaluatePermissions(data.permissionGrants, {
      userId: data.currentUserId,
      resourceKind: 'project',
      resourceId: data.activeProjectId,
      action: 'write',
    })
    if (!check.allowed) toast('Blocked', check.reason)
    return check.allowed
  }

  const save = async () => {
    if (!services?.files || !selected || !checkWrite()) return
    await services.files.write(selected, content)
    toast('Saved', selected)
    await refresh()
  }

  const createFile = async () => {
    if (!services?.files || !checkWrite()) return
    const cleanName = newName.trim().replaceAll('\\', '/')
    if (!cleanName || cleanName.split('/').some((segment) => segment === '..' || segment === '.')) {
      toast('Invalid filename', 'Use a filename inside the current folder.')
      return
    }
    const full = path ? `${path}/${cleanName}` : cleanName
    await services.files.write(full, '')
    toast('Created', full)
    setSelected(full)
    setContent('')
    await refresh()
  }

  const runSandbox = async () => {
    if (!services?.sandbox || !services.files) return
    const check = evaluatePermissions(data.permissionGrants, {
      userId: data.currentUserId,
      resourceKind: 'project',
      resourceId: data.activeProjectId,
      action: 'execute',
    })
    if (!check.allowed) {
      toast('Blocked', check.reason)
      return
    }
    const files: Record<string, string> = {}
    try { files['README.md'] = await services.files.read('README.md') } catch { /* optional */ }
    if (selected) files[selected.split('/').pop()!] = content
    const result = await services.sandbox.run({ language: 'javascript', code: sandboxCode, files, timeoutMs: 2500 })
    setSandboxOut(`${result.ok ? 'OK' : 'ERROR'} · ${result.durationMs}ms\n${result.stdout}\n${result.stderr}`)
    if (result.artifacts) {
      for (const art of result.artifacts) {
        if (art.path.startsWith('sandbox/') || art.path.includes('out')) {
          await services.files.write(art.path.startsWith('sandbox/') ? art.path : `sandbox/${art.path}`, art.content)
        }
      }
      await refresh()
    }
  }

  if (!enabled) {
    return <div className="content-page empty-state"><h3>Files unavailable</h3><p>This runtime mode does not expose browser file storage.</p></div>
  }

  const crumbs = ['workspace', ...path.split('/').filter(Boolean)]

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">{runtimeModeLabel}</div>
          <h1>Files</h1>
          <p>Browser-local workspace backed by OPFS. Import, edit, and feed files into the WASM sandbox.</p>
        </div>
        <div className="page-header-actions">
          <input type="file" multiple onChange={async (e) => {
            if (!services?.files?.importFiles || !e.target.files?.length || !checkWrite()) return
            const paths = await services.files.importFiles(e.target.files)
            toast('Imported', `${paths.length} file(s)`)
            setPath('imports')
          }} />
          <button className="secondary-btn" onClick={() => void refresh()}><Icon name="refresh" className="icon sm" />Refresh</button>
        </div>
      </div>

      {quota && (
        <div className="wiki-workflow-banner" style={{ marginBottom: 14 }}>
          <div className="wiki-workflow-icon"><Icon name="db" /></div>
          <div><strong>Storage</strong><p>{(quota.used / 1024).toFixed(1)} KB used of {(quota.available / (1024 * 1024)).toFixed(1)} MB available</p></div>
        </div>
      )}

      <div className="files-layout">
        <aside className="card">
          <div className="card-header">
            <div>
              <h3>Tree</h3>
              <p className="row-sub">{crumbs.join(' / ')}</p>
            </div>
            {path && <button className="tiny-btn" onClick={() => setPath(path.includes('/') ? path.split('/').slice(0, -1).join('/') : '')}>Up</button>}
          </div>
          <div className="card-body row-list">
            {entries.map((entry) => (
              <button key={entry.path} className={`row-item files-row ${selected === entry.path ? 'active' : ''}`} onClick={() => void openEntry(entry)}>
                <div className="row-icon"><Icon name={entry.kind === 'directory' ? 'folder' : 'file'} className="icon sm" /></div>
                <div className="row-copy"><div className="row-title">{entry.name}</div><div className="row-sub">{entry.kind === 'directory' ? 'Folder' : `${entry.size} B`}</div></div>
              </button>
            ))}
            {!entries.length && <div className="empty-state" style={{ padding: 20 }}>Empty folder</div>}
          </div>
          <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
            <div className="form-row"><label>New file</label><input value={newName} onChange={(e) => setNewName(e.target.value)} /></div>
            <button className="primary-btn" onClick={() => void createFile()}>Create</button>
          </div>
        </aside>

        <section className="card">
          <div className="card-header">
            <div><h3>{selected ?? 'Editor'}</h3></div>
            <button className="tiny-btn" disabled={!selected} onClick={() => void save()}>Save</button>
          </div>
          <div className="card-body">
            <textarea className="files-editor" value={content} onChange={(e) => setContent(e.target.value)} placeholder="Select a file to edit" disabled={!selected} />
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div><h3>Sandbox</h3><p>Worker JS with virtual FS · timeout 2.5s</p></div>
            <button className="tiny-btn" disabled={!can('sandbox.wasm')} onClick={() => void runSandbox()}>Run</button>
          </div>
          <div className="card-body">
            <textarea className="files-editor sandbox" value={sandboxCode} onChange={(e) => setSandboxCode(e.target.value)} />
            <pre className="api-console" style={{ marginTop: 10 }}>{sandboxOut || 'Output appears here.'}</pre>
          </div>
        </section>
      </div>
    </div>
  )
}
