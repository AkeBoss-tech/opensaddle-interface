import { Icon } from '../components/common/Icon'
import type {
  DeveloperPerspectiveModel,
  DeveloperPerspectiveView,
  DeveloperTraceRow,
} from '../perspectives/developer/readModel'
import { Tabs } from '../ui/Tabs'
import { registerSurface } from './registry'

export interface DeveloperPerspectiveSurfaceInputs {
  model: DeveloperPerspectiveModel
  view: DeveloperPerspectiveView
  onViewChange: (view: DeveloperPerspectiveView) => void
  onOpen: (href: string) => void
}

function formatUpdatedAt(timestamp: number) {
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function TraceRow({ row, onOpen }: { row: DeveloperTraceRow; onOpen: (href: string) => void }) {
  return (
    <button type="button" className="os-dev-trace-row" onClick={() => onOpen(row.href)}>
      <span className={`os-dev-trace-icon ${row.tone}`}><Icon name="trace" className="icon sm" /></span>
      <span className="os-dev-trace-copy">
        <strong>{row.title}</strong>
        <small>{row.projectName} · {row.provider} · {row.source === 'durable-runtime' ? 'durable runtime' : 'recorded message'}</small>
        <span className="os-dev-trace-evidence">
          <span>{row.evidenceCount} evidence</span>
          <span>{row.checkCount} check groups</span>
          <span>{row.changedFileCount} changed files</span>
          {row.signal && <span className="warning">No recent runtime signal</span>}
        </span>
      </span>
      <span className="os-dev-trace-meta">
        <span className={`os-dev-status ${row.tone}`}>{row.status}</span>
        <small>{formatUpdatedAt(row.updatedAt)}</small>
      </span>
      <Icon name="chevron" className="icon xs" />
    </button>
  )
}

export function DeveloperPerspectiveSurface({ model, view, onViewChange, onOpen }: DeveloperPerspectiveSurfaceInputs) {
  const tracePanel = (
    <div className="os-dev-traces">
      <div className="os-dev-section-heading">
        <div><h3>Runtime trace</h3><p>Durable runs take precedence; message-only evidence is explicitly labeled.</p></div>
        {model.unlinkedRunCount > 0 && <span>{model.unlinkedRunCount} unlinked run{model.unlinkedRunCount === 1 ? '' : 's'}</span>}
      </div>
      <div className="os-dev-trace-list">
        {model.traces.map((row) => <TraceRow key={row.id} row={row} onOpen={onOpen} />)}
        {!model.traces.length && <div className="os-dev-empty"><Icon name="trace" /><strong>No trace evidence yet</strong><span>Start a project task to create a durable run.</span></div>}
      </div>
    </div>
  )
  const boardPanel = (
    <div className="os-dev-board">
      {model.columns.map((column) => (
        <section className="os-dev-column" key={column.id} aria-labelledby={`column-${column.id}`}>
          <header>
            <div><h3 id={`column-${column.id}`}>{column.title}</h3><p>{column.description}</p></div>
            <span>{column.cards.length}</span>
          </header>
          <div className="os-dev-cards">
            {column.cards.map((card) => (
              <button type="button" className="os-dev-card" key={card.id} onClick={() => onOpen(card.href)}>
                <span className="os-dev-card-source">{card.source === 'durable-runtime' ? 'Runtime-derived' : 'Thread-derived'}</span>
                <strong>{card.title}</strong>
                <span>{card.projectName}</span>
                <footer><span>{card.status}</span><small>{formatUpdatedAt(card.updatedAt)}</small></footer>
              </button>
            ))}
            {!column.cards.length && <div className="os-dev-column-empty">Nothing in this state</div>}
          </div>
        </section>
      ))}
    </div>
  )

  return (
    <section className="os-dev-perspective" aria-labelledby="developer-perspective-title">
      <header className="os-dev-header">
        <div>
          <span className="os-perspective-kicker">Developer perspective · read-only projection</span>
          <h2 id="developer-perspective-title">{model.projectName} engineering workspace</h2>
          <p>Execution evidence and project flow are recomputed from Threads and durable Runs. This view owns no task status.</p>
        </div>
        <div className="os-dev-summary" aria-label="Developer perspective summary">
          <span><strong>{model.traces.length}</strong> traces</span>
          <span><strong>{model.columns.reduce((total, column) => total + column.cards.length, 0)}</strong> threads</span>
        </div>
      </header>

      {model.runtimeState !== 'ready' && (
        <div className={`os-dev-runtime ${model.runtimeState}`} role="status">
          <Icon name={model.runtimeState === 'loading' ? 'refresh' : 'info'} className="icon sm" />
          <span>
            <strong>{model.runtimeState === 'loading' ? 'Loading durable runtime evidence' : 'Durable runtime unavailable'}</strong>
            <small>{model.runtimeState === 'loading' ? 'Recorded thread evidence remains visible while the snapshot loads.' : model.runtimeError ?? 'Only recorded thread history is available.'}</small>
          </span>
        </div>
      )}

      <Tabs
        className="os-dev-tabs"
        label="Developer perspective views"
        value={view}
        onValueChange={(value) => onViewChange(value as DeveloperPerspectiveView)}
        items={[
          { id: 'trace-evidence', label: <><Icon name="trace" className="icon sm" />Trace & evidence</>, panel: tracePanel },
          { id: 'kanban', label: <><Icon name="layout" className="icon sm" />Derived board</>, panel: boardPanel },
        ]}
      />
    </section>
  )
}

registerSurface({
  id: 'developer-perspective',
  inputs: ['model', 'view', 'onViewChange', 'onOpen'],
  Component: DeveloperPerspectiveSurface,
  permission: { resourceKind: 'project', action: 'read' },
})
