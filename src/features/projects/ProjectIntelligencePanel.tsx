import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../components/common/Icon'
import type { ProjectIntelligenceClient, ProjectIntelligenceView } from '../../services/contracts'

type Lens = 'structure' | 'changes' | 'evidence'

function shortBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectIntelligencePanel(props: {
  projectId: string
  client?: ProjectIntelligenceClient
  onError: (message: string) => void
}) {
  const { client, onError, projectId } = props
  const [value, setValue] = useState<ProjectIntelligenceView | null>(null)
  const [loading, setLoading] = useState(Boolean(client))
  const [capturing, setCapturing] = useState(false)
  const [lens, setLens] = useState<Lens>('structure')

  useEffect(() => {
    let active = true
    if (!client) return () => { active = false }
    setLoading(true)
    client.latest(projectId).then((next) => {
      if (active) setValue(next)
    }).catch((error) => {
      if (active) onError(error instanceof Error ? error.message : String(error))
    }).finally(() => active && setLoading(false))
    return () => { active = false }
  }, [client, onError, projectId])

  const capture = async () => {
    if (!client || capturing) return
    setCapturing(true)
    try { setValue(await client.create(projectId)) } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally { setCapturing(false) }
  }

  const maxLanguageFiles = useMemo(() => Math.max(
    1, ...(value?.snapshot.summary.languages.map((item) => item.fileCount) ?? []),
  ), [value])

  if (!client) return null
  return (
    <section className="tw-intelligence" aria-labelledby="project-intelligence-title">
      <div className="tw-intelligence-heading">
        <span className="tw-self-driving-icon"><Icon name="trace" className="icon sm" /></span>
        <div>
          <span className="tw-kicker">Evidence-backed orientation</span>
          <h2 id="project-intelligence-title">Project intelligence</h2>
          <p>One immutable Git snapshot, viewed through different lenses. Structure is observed; business meaning remains explicitly uncertain.</p>
        </div>
        <button type="button" onClick={capture} disabled={capturing}>
          <Icon name="refresh" className="icon xs" /> {capturing ? 'Capturing…' : value ? 'Capture HEAD' : 'Create snapshot'}
        </button>
      </div>
      {loading ? <p className="tw-extension-empty">Loading the latest authoritative snapshot…</p> : !value ? (
        <div className="tw-intelligence-empty">
          <strong>No Project Intelligence Snapshot yet</strong>
          <span>Create one from the current committed Git revision. Working-tree content will be excluded.</span>
        </div>
      ) : (
        <>
          <div className="tw-intelligence-revision">
            <div><small>Snapshot</small><strong>v{value.snapshot.version} · {value.snapshot.revision.oid.slice(0, 10)}</strong></div>
            <div><small>Files</small><strong>{value.snapshot.summary.fileCount.toLocaleString()}</strong></div>
            <div><small>Committed size</small><strong>{shortBytes(value.snapshot.summary.totalBytes)}</strong></div>
            <div><small>Source</small><strong className={value.sourceFreshness.status}>{value.sourceFreshness.status}</strong></div>
            <div><small>Working tree</small><strong>{value.sourceFreshness.workingTreeDirty ? `${value.sourceFreshness.workingTreeChangeCount} excluded` : 'clean'}</strong></div>
          </div>
          <div className="tw-lens-switcher" role="tablist" aria-label="Project intelligence lens">
            {(['structure', 'changes', 'evidence'] as Lens[]).map((item) => (
              <button key={item} type="button" role="tab" aria-selected={lens === item} onClick={() => setLens(item)}>{item}</button>
            ))}
          </div>
          <div className="tw-intelligence-limits">
            <Icon name="info" className="icon xs" />
            <span><strong>{value.snapshot.uncertainties.length} known limits</strong> · semantic and business context are not implied by this structural snapshot.</span>
          </div>
          {lens === 'structure' && (
            <div className="tw-intelligence-grid">
              <article>
                <strong>Languages</strong>
                {value.snapshot.summary.languages.slice(0, 7).map((item) => (
                  <div className="tw-language-row" key={item.language}>
                    <span>{item.language}</span><i><b style={{ width: `${Math.max(4, item.fileCount / maxLanguageFiles * 100)}%` }} /></i><small>{item.fileCount}</small>
                  </div>
                ))}
              </article>
              <article>
                <strong>Top-level path groups</strong>
                {value.snapshot.summary.pathGroups.slice(0, 7).map((item) => (
                  <div className="tw-path-row" key={item.name}><span>{item.name}</span><small>{item.fileCount} files · {shortBytes(item.sizeBytes)}</small></div>
                ))}
              </article>
            </div>
          )}
          {lens === 'changes' && (
            <div className="tw-intelligence-list">
              {value.snapshot.recentChanges.slice(0, 8).map((item) => (
                <div key={item.oid}><code>{item.oid.slice(0, 8)}</code><span><strong>{item.subject}</strong><small>{item.authorName} · {new Date(item.authoredAt).toLocaleDateString()}</small></span></div>
              ))}
            </div>
          )}
          {lens === 'evidence' && (
            <div className="tw-intelligence-grid">
              <article>
                <strong>Evidence locators</strong>
                {value.snapshot.evidence.slice(0, 8).map((item) => (
                  <div className="tw-path-row" key={item.evidenceId}><span>{item.locator}</span><small>{item.kind}</small></div>
                ))}
              </article>
              <article className="tw-uncertainty-list">
                <strong>Known limits</strong>
                {value.snapshot.uncertainties.map((item) => (
                  <div key={item.code}><Icon name="info" className="icon xs" /><span><b>{item.code.replaceAll('_', ' ')}</b><small>{item.detail}</small></span></div>
                ))}
              </article>
            </div>
          )}
        </>
      )}
    </section>
  )
}
