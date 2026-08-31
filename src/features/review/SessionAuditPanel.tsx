import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { getBundledReviewPlugin } from '../../extensions/bundledReviewPlugins'
import { evaluatePermissions } from '../../services/permissions'
import type { HarnessCapability, RuntimeRunSummary } from '../../services/contracts'
import type { CodingProvider } from '../../types'
import { deriveSessionAudit, type SessionAuditBreakdown, type SessionAuditPoint } from './sessionAuditReadModel'

const AUDIT_TASK = `Perform a read-only full audit of this project. Inspect architecture, code quality, dependencies, tests, security posture, documentation, and agent-session prompting patterns. Do not modify files or external systems. Separate observed evidence from inference, identify gaps, and return prioritized findings with exact evidence.`
const SESSION_AUDIT_PLUGIN = getBundledReviewPlugin('opensaddle.session-audit')!

function compactNumber(value: number | undefined) {
  if (value === undefined) return 'Not measured'
  return Intl.NumberFormat(undefined, { notation: value >= 1_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function duration(value: number | undefined) {
  if (value === undefined) return 'Not measured'
  if (value < 60_000) return `${Math.max(1, Math.round(value / 1_000))}s`
  if (value < 3_600_000) return `${Math.round(value / 60_000)}m`
  return `${(value / 3_600_000).toFixed(1)}h`
}

function relativeTime(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1_440)}d ago`
}

function LineChart(props: { points: SessionAuditPoint[]; field: 'sessions' | 'tokens'; label: string; measured: boolean; unavailable: string }) {
  if (!props.measured) return <div className="sa-chart sa-chart-empty"><p>{props.unavailable}</p></div>
  const values = props.points.map((point) => point[props.field])
  const max = Math.max(1, ...values)
  const coordinates = values.map((value, index) => ({
    x: values.length === 1 ? 50 : index * (100 / (values.length - 1)),
    y: 38 - value / max * 31,
  }))
  const line = coordinates.map((point) => `${point.x},${point.y}`).join(' ')
  const area = `0,42 ${line} 100,42`
  const nonZero = values.some(Boolean)
  return (
    <div className="sa-chart" role="img" aria-label={`${props.label}: ${values.join(', ')}`}>
      <svg viewBox="0 0 100 45" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="42" x2="100" y2="42" className="sa-chart-axis" />
        {nonZero && <polygon points={area} className="sa-chart-area" />}
        {nonZero && <polyline points={line} className="sa-chart-line" />}
      </svg>
      <div className="sa-chart-labels"><span>{props.points[0]?.label}</span><span>{props.points.at(-1)?.label}</span></div>
    </div>
  )
}

function Bars(props: { values: SessionAuditBreakdown[]; empty: string }) {
  const max = Math.max(1, ...props.values.map((item) => item.value))
  if (!props.values.length) return <p className="sa-empty">{props.empty}</p>
  return <div className="sa-bars">{props.values.map((item) => (
    <div className="sa-bar" key={item.label}>
      <div><span>{item.label}</span><strong>{item.value}</strong></div>
      <span className="sa-bar-track"><span style={{ width: `${Math.max(4, item.value / max * 100)}%` }} /></span>
    </div>
  ))}</div>
}

function usableHarness(capability: HarnessCapability) {
  return capability.availability === 'available' && capability.readiness === 'ready'
}

export function SessionAuditPanel(props: { projectId: string; projectIds: ReadonlySet<string> }) {
  const { data, services, harnessCapabilities, refreshHarnessCapabilities, toast } = useStore()
  const navigate = useNavigate()
  const [runs, setRuns] = useState<RuntimeRunSummary[]>([])
  const [runtimeReady, setRuntimeReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [runningAudit, setRunningAudit] = useState(false)
  const readyHarnesses = useMemo(() => harnessCapabilities.filter(usableHarness), [harnessCapabilities])
  const preferredHarness = data.projects.find((project) => project.id === props.projectId)?.local?.defaultHarnessId
  const [harnessId, setHarnessId] = useState(preferredHarness ?? '')

  useEffect(() => {
    if (readyHarnesses.some((harness) => harness.id === harnessId)) return
    setHarnessId(readyHarnesses[0]?.id ?? '')
  }, [harnessId, readyHarnesses])

  const refresh = useCallback(async () => {
    if (!services?.runtime.listRuns) {
      setRuns([])
      setRuntimeReady(false)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setRuns(await services.runtime.listRuns())
      setRuntimeReady(true)
    } catch (error) {
      setRuns([])
      setRuntimeReady(false)
      toast('Session audit', error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [services, toast])

  useEffect(() => { void refresh() }, [refresh])

  const model = useMemo(() => deriveSessionAudit({
    data,
    projectIds: props.projectIds,
    durableRuns: runs,
    runtimeReady,
    now: Date.now(),
  }), [data, props.projectIds, runs, runtimeReady])

  const selectedHarness = readyHarnesses.find((harness) => harness.id === harnessId)
  const selectedModel = selectedHarness?.models.find((model) => model.isDefault && model.configured)
    ?? selectedHarness?.models.find((model) => model.configured)
  const permission = evaluatePermissions(data.permissionGrants, {
    userId: data.currentUserId,
    resourceKind: 'project',
    resourceId: props.projectId,
    action: 'execute',
  })

  const runAudit = async () => {
    if (!services?.runtime || !selectedHarness) return
    if (!permission.allowed) {
      toast('Audit blocked', permission.reason)
      return
    }
    if (permission.approvalRequired) {
      toast('Approval required', 'This project requires a separately issued approval before an agent audit can execute.')
      return
    }
    setRunningAudit(true)
    try {
      const project = data.projects.find((item) => item.id === props.projectId)
      const promptPatternSummary = model.promptPatterns.length
        ? model.promptPatterns.map((pattern) => `${pattern.label}: ${pattern.value}`).join(', ')
        : 'No prompt categories were available.'
      const started = await services.runtime.startRun({
        projectId: props.projectId,
        task: `${AUDIT_TASK}\n\nOpenSaddle aggregate prompt evidence (${model.promptCount} prompts; categories overlap): ${promptPatternSummary}`,
        providerKey: selectedHarness.id as CodingProvider,
        harnessKey: 'coding',
        runtimeKey: 'local',
        modelKey: 'auto',
        modelId: selectedModel?.id,
        reasoningEffort: selectedModel?.defaultReasoningEffort,
        executionMode: 'review',
        repo: project?.local?.rootPath,
      })
      toast('Full audit started', `${selectedHarness.label} is reviewing ${project?.name ?? 'the project'} in read-only mode.`)
      navigate(`/runs?run=${encodeURIComponent(started.runId)}`)
    } catch (error) {
      toast('Audit could not start', error instanceof Error ? error.message : String(error))
    } finally {
      setRunningAudit(false)
    }
  }

  return (
    <section className="sa-panel" aria-labelledby="session-audit-title">
      <header className="sa-header">
        <div className="sa-title">
          <span className="sa-plugin-icon"><Icon name="review" className="icon sm" /></span>
          <div>
            <div className="sa-kicker"><span>Bundled plugin</span><code>{SESSION_AUDIT_PLUGIN.id}</code></div>
            <h2 id="session-audit-title">Agent session review</h2>
            <p>Project activity, prompting patterns, and execution outcomes—derived from inspectable session evidence.</p>
          </div>
        </div>
        <div className="sa-actions">
          <button type="button" onClick={() => navigate('/usage')}><Icon name="chart" className="icon sm" />Token pricing</button>
          <label>
            <span>Audit harness</span>
            <select value={harnessId} onChange={(event) => setHarnessId(event.target.value)} aria-label="Harness for full project audit">
              {!readyHarnesses.length && <option value="">No ready harness</option>}
              {readyHarnesses.map((harness) => <option key={harness.id} value={harness.id}>{harness.label}</option>)}
            </select>
          </label>
          <button type="button" className="sa-audit-button" onClick={() => void runAudit()} disabled={!selectedHarness || runningAudit || !services?.runtime}>
            <Icon name={runningAudit ? 'activity' : 'spark'} className="icon sm" />{runningAudit ? 'Starting…' : 'Run full audit'}
          </button>
        </div>
      </header>

      <div className="sa-provenance">
        <span className={runtimeReady ? 'ready' : 'snapshot'}><i />{loading ? 'Refreshing evidence…' : runtimeReady ? 'Authoritative run registry' : 'Workspace snapshot fallback'}</span>
        <span>Prompt categories are heuristic aggregates; raw prompts stay in their original threads.</span>
        <button type="button" onClick={() => { void refreshHarnessCapabilities(); void refresh() }}><Icon name="refresh" className="icon xs" />Refresh</button>
      </div>

      <div className="sa-metrics">
        <article><span>Sessions</span><strong>{compactNumber(model.sessionCount)}</strong><small>{model.activeCount} active now</small></article>
        <article><span>Measured tokens</span><strong>{compactNumber(model.totalTokens)}</strong><small>{model.tokenCoverage.measured}/{model.tokenCoverage.total} sessions report usage</small></article>
        <article><span>Completed successfully</span><strong>{model.successRate === undefined ? 'Not measured' : `${Math.round(model.successRate * 100)}%`}</strong><small>Terminal runs only</small></article>
        <article><span>Average duration</span><strong>{duration(model.averageDurationMs)}</strong><small>Completed and failed runs</small></article>
      </div>

      <div className="sa-analytics-grid">
        <article className="sa-card sa-wide">
          <div className="sa-card-heading"><div><span>Session volume</span><strong>Runs over the last 14 days</strong></div><b>{model.timeline.reduce((sum, point) => sum + point.sessions, 0)} runs</b></div>
          <LineChart points={model.timeline} field="sessions" label="Session volume over time" measured={runtimeReady} unavailable="The authoritative run registry is unavailable. No zero trend has been inferred." />
        </article>
        <article className="sa-card sa-wide">
          <div className="sa-card-heading"><div><span>Usage</span><strong>Measured tokens over time</strong></div><b>{compactNumber(model.totalTokens)}</b></div>
          <LineChart points={model.timeline} field="tokens" label="Measured tokens over time" measured={model.totalTokens !== undefined} unavailable="Token usage is not reported by the available sessions." />
        </article>
        <article className="sa-card"><div className="sa-card-heading"><div><span>Execution</span><strong>Harness mix</strong></div></div><Bars values={model.harnesses} empty="No harness evidence yet." /></article>
        <article className="sa-card"><div className="sa-card-heading"><div><span>Routing</span><strong>Model mix</strong></div></div><Bars values={model.models} empty="No model evidence yet." /></article>
        <article className="sa-card sa-prompt-card">
          <div className="sa-card-heading"><div><span>Prompting</span><strong>What people ask agents to do</strong></div><b>{model.promptCount} prompts</b></div>
          <Bars values={model.promptPatterns} empty="No project prompts are available to categorize." />
          <p className="sa-footnote">Average prompt: {model.averagePromptWords === undefined ? 'not measured' : `${Math.round(model.averagePromptWords)} words`}. Categories can overlap.</p>
        </article>
      </div>

      <article className="sa-table-card">
        <div className="sa-card-heading"><div><span>Inspectable evidence</span><strong>Recent agent sessions</strong></div><button type="button" onClick={() => navigate('/runs')}>Open run registry <Icon name="forward" className="icon xs" /></button></div>
        {model.rows.length ? <div className="sa-table-wrap"><table>
          <thead><tr><th>Session</th><th>Harness</th><th>Model</th><th>Status</th><th>Duration</th><th>Tokens</th></tr></thead>
          <tbody>{model.rows.map((row) => <tr key={row.id} onClick={() => navigate(`/runs?run=${encodeURIComponent(row.id)}`)}>
            <td><strong>{row.title}</strong><small>{relativeTime(row.startedAt)} · {row.id.slice(0, 10)}</small></td>
            <td>{row.harness}</td><td>{row.model}</td><td><span className={`sa-status ${row.status}`}>{row.status.replace('_', ' ')}</span></td><td>{duration(row.durationMs)}</td><td>{compactNumber(row.tokens)}</td>
          </tr>)}</tbody>
        </table></div> : <p className="sa-empty">No agent sessions are associated with this project yet.</p>}
      </article>
    </section>
  )
}
