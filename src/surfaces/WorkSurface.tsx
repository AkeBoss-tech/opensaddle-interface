import { Icon } from '../components/common/Icon'
import { Button } from '../ui/Button'
import { Tabs } from '../ui/Tabs'
import { registerSurface } from './registry'

export type WorkFilter = 'attention' | 'running' | 'scheduled' | 'completed' | 'archived'
export type WorkAction = 'pause-workflow' | 'resume-workflow' | 'run-workflow' | 'cancel-execution' | 'retry-execution'

export interface WorkRow {
  id: string
  title: string
  subtitle: string
  projectId: string
  status: string
  owner?: string
  priority?: 'urgent' | 'high' | 'normal' | 'low'
  timeSignal?: string
  progress?: number
  href?: string
  kind: 'thread' | 'task' | 'workflow' | 'approval' | 'run'
  workflowId?: string
  executionId?: string
  actions?: Array<{ id: WorkAction; label: string }>
}

export interface WorkSurfaceInputs {
  activeProjectName: string
  filter: WorkFilter | 'all'
  sections: Array<{ key: WorkFilter; title: string; description: string; rows: WorkRow[] }>
  onCreateTask: () => void
  onFilterChange: (filter: WorkFilter | 'all') => void
  onOpen: (row: WorkRow) => void
}

function Section({ title, description, rows, onOpen }: { title: string; description: string; rows: WorkRow[]; onOpen: (row: WorkRow) => void }) {
  return <section className="tf-work-section">
    <div className="tf-work-section-head"><div><h2>{title}</h2><p>{description}</p></div><span>{rows.length}</span></div>
    <div className="tf-work-list">
      {rows.map((row) => <div key={row.id} className="tf-work-row-wrap">
        <button className="tf-work-row" onClick={() => onOpen(row)} aria-label={`Open details for ${row.title}`}>
          <span className={`tf-work-icon ${row.kind}`}><Icon name={row.kind === 'approval' ? 'shield' : row.kind === 'workflow' ? 'activity' : row.kind === 'task' ? 'clock' : row.kind === 'run' ? 'terminal' : 'message'} className="icon sm" /></span>
          <span className="tf-work-copy"><strong>{row.title}</strong><small>{row.subtitle}</small><span className="tf-work-card-meta">{row.owner && <span>{row.owner}</span>}{row.timeSignal && <span>{row.timeSignal}</span>}</span></span>
          {row.progress !== undefined && <span className="tf-progress"><i style={{ width: `${row.progress}%` }} /></span>}
          <span className={`tf-work-status ${row.status.toLowerCase().replaceAll(' ', '-')}`}>{row.status}</span><Icon name="chevron" className="icon xs tf-row-arrow" />
        </button>
      </div>)}
      {!rows.length && <div className="tf-work-empty"><Icon name="check" /><strong>Nothing here</strong><span>You are caught up.</span></div>}
    </div>
  </section>
}

export function WorkSurface({ activeProjectName, filter, sections, onCreateTask, onFilterChange, onOpen }: WorkSurfaceInputs) {
  const filters = ['all', 'attention', 'running', 'scheduled', 'completed', 'archived'] as const
  const workSections = (activeFilter: typeof filter) => (
    <div className="tf-work-sections">
      {sections
        .filter((section) => activeFilter === 'all' || section.key === activeFilter)
        .map(({ key, title, description, rows }) => <Section key={key} title={title} description={description} rows={rows} onOpen={onOpen} />)}
    </div>
  )
  return <div className="tf-work-page">
    <header className="tf-work-header"><div><span className="tf-eyebrow">Team workspace · {activeProjectName}</span><h1>Work</h1><p>Active work for this team, ordered by what needs you next.</p></div><Button variant="primary" size="sm" leadingIcon={<Icon name="plus" className="icon sm" />} onClick={onCreateTask}>New task</Button></header>
    <Tabs
      className="tf-work-tabs"
      label="Work filters"
      value={filter}
      onValueChange={(value) => onFilterChange(value as typeof filter)}
      items={filters.map((item) => ({
        id: item,
        label: item === 'all' ? 'All work' : item === 'attention' ? 'Needs attention' : item[0]!.toUpperCase() + item.slice(1),
        badge: item === 'all' ? undefined : <span>{sections.find((section) => section.key === item)?.rows.length ?? 0}</span>,
        panel: workSections(item),
      }))}
    />
  </div>
}

registerSurface({
  id: 'work',
  inputs: ['activeProjectName', 'filter', 'sections', 'onCreateTask', 'onFilterChange', 'onOpen'],
  Component: WorkSurface,
  permission: { resourceKind: 'project', action: 'read' },
})
