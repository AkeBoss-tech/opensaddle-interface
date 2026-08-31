import { useEffect, useMemo, useState } from 'react'
import type { DiscoveredLocalProject, DiscoveredUiPlugin, Project, WorkspaceProposal, WorkspaceScaffoldSelection } from '../../types'
import { Dialog, Button, StepProgress } from '../../ui'
import { Icon } from '../../components/common/Icon'
import { ScaffoldProposal } from './ScaffoldProposal'
import { scanWorkspaceFolder } from '../../services/workspaceScaffold'
import { creationAction, isProjectDetailsValid, type AddProjectKind } from './addProjectFlow'
import type { KrailOnboardingRunner } from './krailOnboardingWorkflow'
import { projectProjectionCatalog, sortDiscoveredProjects } from '../../extensions/viewPlugins'
import '../../styles/scaffold.css'

type Step = 'discovered' | 'kind' | 'details' | 'review'

const COLORS = [
  { value: 'var(--os-color-accent)', label: 'Accent blue' }, { value: 'var(--os-color-info)', label: 'Info blue' },
  { value: 'var(--os-color-success)', label: 'Green' }, { value: 'var(--os-color-warning)', label: 'Gold' },
  { value: 'var(--os-color-danger)', label: 'Red' }, { value: 'var(--os-color-approval)', label: 'Purple' },
  { value: 'var(--os-color-text-muted)', label: 'Gray' }, { value: 'var(--os-color-border-strong)', label: 'Slate' },
]

function folderName(path: string) { return path.trim().replace(/[\\/]+$/, '').split(/[\\/]/).filter(Boolean).at(-1) ?? '' }
function compactTokens(value: number | null) { return value === null ? 'No usage data' : `${new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)} tokens` }
function money(value: number) { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: value < 0.01 ? 4 : value < 10 ? 2 : 0 }).format(value) }
function estimatedCost(project: DiscoveredLocalProject) {
  if (project.estimatedCostUsd === null) return 'Token cost unavailable'
  const upper = project.estimatedCostUpperBoundUsd
  const range = upper !== null && Math.abs(upper - project.estimatedCostUsd) > 0.000000001
    ? `${money(project.estimatedCostUsd)}–${money(upper)}`
    : money(project.estimatedCostUsd)
  const coverage = project.costUnpricedTokens > 0 ? ` · ${Math.round(project.costPricedTokens / Math.max(project.costPricedTokens + project.costUnpricedTokens, 1) * 100)}% priced` : ''
  return `~${range} token cost${coverage}`
}
function recentActivity(value: number) { return value > 0 ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: new Date(value).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : 'Activity unknown' }

export function AddProjectDialog({ open, projects, discoveredProjects, uiPlugins, defaultParentId, governedOnboardingAvailable, onClose, onCreateCloud, onCreateLocal }: {
  open: boolean; projects: Project[]; defaultParentId: string | null; governedOnboardingAvailable: boolean; onClose: () => void
  discoveredProjects: DiscoveredLocalProject[]
  uiPlugins: DiscoveredUiPlugin[]
  onCreateCloud: (input: { name: string; parentId: string | null; color: string }) => Promise<void> | void
  onCreateLocal: (input: { name: string; color: string; selection: WorkspaceScaffoldSelection; krailRunner: KrailOnboardingRunner | null }) => Promise<void> | void
}) {
  const [step, setStep] = useState<Step>('kind')
  const [kind, setKind] = useState<AddProjectKind | null>(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [folderPath, setFolderPath] = useState('')
  const [parentId, setParentId] = useState<string | null>(defaultParentId)
  const [color, setColor] = useState(COLORS[0].value)
  const [proposal, setProposal] = useState<WorkspaceProposal | null>(null)
  const [scanning, setScanning] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [krailRunner, setKrailRunner] = useState<KrailOnboardingRunner | null>(governedOnboardingAvailable ? 'codex_cli' : null)
  const [discoveryQuery, setDiscoveryQuery] = useState('')
  const [discoverySource, setDiscoverySource] = useState<'all' | 'codex' | 'cursor' | 'claude'>('all')
  const [discoverySort, setDiscoverySort] = useState('opensaddle.recent')
  const [discoveryView, setDiscoveryView] = useState('opensaddle.comfortable')
  const projectionCatalog = useMemo(() => projectProjectionCatalog(uiPlugins), [uiPlugins])
  const selectedView = projectionCatalog.views.find((view) => view.id === discoveryView) ?? projectionCatalog.views[0]!

  useEffect(() => {
    if (!open) return
    setStep(discoveredProjects.length ? 'discovered' : 'kind'); setKind(null); setName(''); setNameEdited(false); setFolderPath(''); setParentId(defaultParentId); setColor(COLORS[0].value); setProposal(null); setError(null); setDiscoveryQuery(''); setDiscoverySource('all'); setDiscoverySort('opensaddle.recent'); setDiscoveryView('opensaddle.comfortable'); setKrailRunner(governedOnboardingAvailable ? 'codex_cli' : null)
  }, [defaultParentId, discoveredProjects.length, governedOnboardingAvailable, open])

  const filteredDiscoveredProjects = useMemo(() => {
    const query = discoveryQuery.trim().toLocaleLowerCase()
    const filtered = discoveredProjects.filter((project) =>
      (discoverySource === 'all' || project.sources.includes(discoverySource))
      && (!query || project.name.toLocaleLowerCase().includes(query) || project.rootPath.toLocaleLowerCase().includes(query)))
    const descriptor = projectionCatalog.sorts.find((sort) => sort.id === discoverySort) ?? projectionCatalog.sorts[0]!
    return sortDiscoveredProjects(filtered, descriptor)
  }, [discoveredProjects, discoveryQuery, discoverySort, discoverySource, projectionCatalog.sorts])

  const chooseDiscoveredProject = (project: DiscoveredLocalProject) => {
    setKind('local')
    setName(project.name)
    setNameEdited(false)
    setFolderPath(project.rootPath)
    setStep('details')
  }

  const chooseFolder = async () => {
    const path = await window.opensaddle?.pickRepository?.()
    if (!path) return
    setFolderPath(path)
    if (!nameEdited) setName(folderName(path))
  }
  const continueDetails = async () => {
    if (!kind || !isProjectDetailsValid(kind, name, folderPath)) return
    if (creationAction(kind, folderPath) === 'create') {
      setStep('review')
      return
    }
    setScanning(true); setError(null)
    try { setProposal(await scanWorkspaceFolder(folderPath.trim())); setStep('review') } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setScanning(false) }
  }
  const createLocal = async (selection: WorkspaceScaffoldSelection) => {
    if (!proposal) return
    setCreating(true); setError(null)
    try {
      await onCreateLocal({
        name: name.trim(),
        color,
        selection: { ...selection, proposal: { ...selection.proposal, label: name.trim() } },
        krailRunner,
      })
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCreating(false)
    }
  }
  const createCloud = async () => {
    setCreating(true)
    try { await onCreateCloud({ name: name.trim(), parentId, color }); onClose() } finally { setCreating(false) }
  }

  const currentStep = step === 'kind' ? 0 : step === 'details' ? 1 : 2
  const title = step === 'kind'
    ? 'Add a project'
    : step === 'review'
      ? kind === 'local' ? 'Review local workspace' : 'Review cloud project'
      : `${kind === 'local' ? 'Local' : 'Cloud'} project details`

  return <Dialog open={open} onClose={onClose} title={step === 'discovered' ? 'Onboard your projects' : title} description={step === 'discovered' ? 'OpenSaddle found local projects from your installed coding tools. Review one before adding it.' : step === 'kind' ? 'Choose where this project lives.' : undefined} size={step === 'review' || step === 'discovered' ? 'lg' : 'sm'} className="add-project-dialog">
    <StepProgress
      className="add-project-progress"
      current={currentStep}
      steps={[
        { label: 'Location', detail: 'Local or cloud' },
        { label: 'Details', detail: 'Name and scope' },
        { label: 'Review', detail: 'Confirm changes' },
      ]}
    />
    {step === 'discovered' && <div className="discovered-projects">
      <div className="discovered-projects__filters">
        <label>Find a project<input type="search" value={discoveryQuery} onChange={(event) => setDiscoveryQuery(event.target.value)} placeholder="Search names and paths" /></label>
        <label>Source<select value={discoverySource} onChange={(event) => setDiscoverySource(event.target.value as typeof discoverySource)}><option value="all">All tools</option><option value="codex">Codex</option><option value="cursor">Cursor</option><option value="claude">Claude</option></select></label>
        <label>Sort<select value={discoverySort} onChange={(event) => setDiscoverySort(event.target.value)}>{projectionCatalog.sorts.map((sort) => <option key={sort.id} value={sort.id}>{sort.title}</option>)}</select></label>
        <label>View<select value={discoveryView} onChange={(event) => setDiscoveryView(event.target.value)}>{projectionCatalog.views.map((view) => <option key={view.id} value={view.id}>{view.title}</option>)}</select></label>
      </div>
      <p className="discovered-projects__count">{filteredDiscoveredProjects.length} of {discoveredProjects.length} projects</p>
      {(discoverySort === 'opensaddle.tokens' || discoverySort === 'opensaddle.estimated-cost') && <p className="project-token-coverage">Codex and Claude Code usage cover indexed local sessions. Cursor contributes project-attributed session metadata and any explicit reported cost, but its local store generally does not disclose cumulative billed tokens. Token cost uses each recorded model's input, cached-input, cache-write, and output rates. OpenRouter rates refresh when Desktop starts. This is an API-equivalent estimate, not your subscription bill. Ranges indicate context-tier uncertainty; coverage marks missing token or price evidence. Cost sorting uses the lower bound.</p>}
      {uiPlugins.length > 0 && <p className="project-token-coverage">{uiPlugins.length} local declarative UI {uiPlugins.length === 1 ? 'plugin is' : 'plugins are'} contributing to this catalog.</p>}
      <ul className="discovered-projects__list" aria-label="Discovered coding projects">
        {filteredDiscoveredProjects.map((project) => <li key={project.id}><button type="button" className={`discovered-project${selectedView.density === 'compact' ? ' is-compact' : ''}`} onClick={() => chooseDiscoveredProject(project)}>
          <span className="discovered-project__copy"><strong>{project.name}</strong>{selectedView.showPath && <code>{project.rootPath}</code>}{selectedView.showUsage && <small>{recentActivity(project.lastSeenAt)} · {compactTokens(project.tokenUsage)} · {estimatedCost(project)}</small>}</span>
          {selectedView.showSources && <span className="discovered-project__sources">{project.sources.map((source) => <span key={source}>{source}</span>)}</span>}
          <span className="discovered-project__action">Review</span>
        </button></li>)}
        {!filteredDiscoveredProjects.length && <li><p className="scaffold-group__empty">No discovered projects match this filter.</p></li>}
      </ul>
      <div className="add-project-actions">
        <Button variant="secondary" onClick={() => { setKind('local'); setStep('details') }}>Choose another folder</Button>
        <Button variant="ghost" onClick={onClose}>Not now</Button>
      </div>
    </div>}
    {step === 'kind' && <div className="add-project-kinds">
      <button type="button" className="add-project-kind" onClick={() => { setKind('local'); setStep('details') }}><span className="add-project-kind__icon"><Icon name="folder" /></span><strong>Local project</strong><span>A folder on this machine. Agents run against real files.</span><small><Icon name="shield" className="icon xs" /> Folder stays locally attached; agent and provider data handling still applies</small></button>
      <button type="button" className="add-project-kind" onClick={() => { setKind('cloud'); setStep('details') }}><span className="add-project-kind__icon"><Icon name="cloud" /></span><strong>Cloud project</strong><span>A workspace with no folder for marketing, research, or planning.</span><small><Icon name="users" className="icon xs" /> Ready for shared work</small></button>
    </div>}
    {step === 'details' && kind && <div className="add-project-details">
      <label>Name<input autoFocus value={name} onChange={(event) => { setNameEdited(true); setName(event.target.value) }} placeholder={kind === 'local' ? 'Project name' : 'New project'} /></label>
      {kind === 'local' && <label>Folder{window.opensaddle?.pickRepository ? <span className="add-project-folder-picker"><input value={folderPath} readOnly placeholder="Choose a folder" /><Button variant="secondary" onClick={() => void chooseFolder()}>Choose folder</Button></span> : <input value={folderPath} onChange={(event) => { const path = event.target.value; setFolderPath(path); if (!nameEdited) setName(folderName(path)) }} placeholder="/path/to/project" />}</label>}
      {kind === 'cloud' && <label>Parent project <span className="add-project-optional">optional</span><select value={parentId ?? ''} onChange={(event) => setParentId(event.target.value || null)}><option value="">No parent</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>}
      <fieldset className="add-project-colors"><legend>Colour</legend><div>{COLORS.map((swatch) => <button key={swatch.value} type="button" className={`add-project-swatch${color === swatch.value ? ' is-selected' : ''}`} style={{ background: swatch.value }} onClick={() => setColor(swatch.value)} aria-label={`Select ${swatch.label}`} aria-pressed={color === swatch.value} />)}</div></fieldset>
      {error && <p className="add-project-error" role="alert">Could not scan folder: {error}</p>}
      <div className="add-project-actions"><Button variant="ghost" onClick={() => setStep('kind')}>Back</Button><Button variant="primary" disabled={!isProjectDetailsValid(kind, name, folderPath)} loading={scanning || creating} onClick={() => void continueDetails()}>Continue to review</Button></div>
    </div>}
    {step === 'review' && kind === 'local' && proposal && <>
      <section className="scaffold-group" aria-labelledby="krail-onboarding-heading">
        <header className="scaffold-group__header"><div><h3 id="krail-onboarding-heading">KRAIL onboarding</h3><p className="scaffold-group__disclosure">Optional and proposal-first. OpenSaddle reviews and promotes only the detached-worktree diff; this is not OS, process, network, or credential isolation.</p></div></header>
        <label><input type="checkbox" checked={krailRunner !== null} disabled={!governedOnboardingAvailable} onChange={(event) => setKrailRunner(event.target.checked ? 'codex_cli' : null)} /> Prepare project profile and automation recommendations</label>
        {!governedOnboardingAvailable && <p className="scaffold-group__disclosure">This OpenSaddle server does not advertise governed project onboarding. The folder can still be attached without starting a simulated workflow.</p>}
        {krailRunner && <label>Runner<select value={krailRunner} onChange={(event) => setKrailRunner(event.target.value as KrailOnboardingRunner)}><option value="codex_cli">Codex CLI</option><option value="claude_code">Claude Code</option></select></label>}
        {krailRunner && <p className="scaffold-group__disclosure">The folder is attached first. KRAIL discovery is deterministic and starts no agent; you will review readiness before the selected runner begins detached-worktree analysis with the local user's host authority.</p>}
      </section>
      {error && <p className="add-project-error" role="alert">Could not create governed workspace: {error}</p>}
      <ScaffoldProposal proposal={{ ...proposal, label: name.trim() }} creating={creating} onBack={() => setStep('details')} onCreate={(selection) => void createLocal(selection)} />
    </>}
    {step === 'review' && kind === 'cloud' && <section className="add-project-review" aria-label="Cloud project summary">
      <div className="add-project-review__icon" style={{ color }}><Icon name="cloud" /></div>
      <div><span className="add-project-review__eyebrow">Cloud workspace</span><h3>{name.trim()}</h3><p>{parentId ? `Nested under ${projects.find((project) => project.id === parentId)?.name ?? 'the selected project'}.` : 'Created as a top-level project.'}</p></div>
      <dl><div><dt>Storage</dt><dd>OpenSaddle cloud workspace</dd></div><div><dt>Project memory</dt><dd>Available after creation</dd></div><div><dt>Local files</dt><dd>Not attached</dd></div></dl>
      <div className="add-project-actions"><Button variant="ghost" onClick={() => setStep('details')}>Back</Button><Button variant="primary" loading={creating} onClick={() => void createCloud()}>Create project</Button></div>
    </section>}
  </Dialog>
}
