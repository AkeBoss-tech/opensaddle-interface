import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { Button } from '../../ui'
import { selectAttentionItems, type AttentionItem } from '../thread/domain'

type WorkFilter = 'attention' | 'running' | 'scheduled' | 'completed'

interface WorkRow {
  id: string
  title: string
  subtitle: string
  projectId: string
  status: string
  progress?: number
  href?: string
  kind: 'thread' | 'task' | 'workflow' | 'approval'
}

function statusLabel(status: AttentionItem['status']) {
  return {
    needs_input: 'Needs input',
    needs_approval: 'Needs approval',
    blocked: 'Blocked',
    failed: 'Failed',
    running: 'Running',
    ready: 'Ready',
    paused: 'Paused',
    completed: 'Completed',
  }[status]
}

function toWorkRow(item: AttentionItem): WorkRow {
  return {
    id: item.id,
    title: item.title,
    subtitle: `${item.projectName} · ${item.detail}`,
    projectId: item.projectId,
    status: statusLabel(item.status),
    progress: item.progress,
    href: item.href,
    kind: item.kind === 'workflow_run' ? 'workflow' : item.kind === 'agent_session' ? 'thread' : item.kind,
  }
}

function Section({
  title,
  description,
  rows,
  onOpen,
}: {
  title: string
  description: string
  rows: WorkRow[]
  onOpen: (row: WorkRow) => void
}) {
  return (
    <section className="tf-work-section">
      <div className="tf-work-section-head"><div><h2>{title}</h2><p>{description}</p></div><span>{rows.length}</span></div>
      <div className="tf-work-list">
        {rows.map((row) => (
          <button key={row.id} className="tf-work-row" onClick={() => onOpen(row)}>
            <span className={`tf-work-icon ${row.kind}`}><Icon name={row.kind === 'approval' ? 'shield' : row.kind === 'workflow' ? 'activity' : row.kind === 'task' ? 'clock' : 'message'} className="icon sm" /></span>
            <span className="tf-work-copy"><strong>{row.title}</strong><small>{row.subtitle}</small></span>
            {row.progress !== undefined && <span className="tf-progress"><i style={{ width: `${row.progress}%` }} /></span>}
            <span className={`tf-work-status ${row.status.toLowerCase().replaceAll(' ', '-')}`}>{row.status}</span>
            <Icon name="chevron" className="icon xs tf-row-arrow" />
          </button>
        ))}
        {!rows.length && <div className="tf-work-empty"><Icon name="check" /><strong>Nothing here</strong><span>You are caught up.</span></div>}
      </div>
    </section>
  )
}

export function WorkPage() {
  const { data, createChat, setActiveChat } = useStore()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<WorkFilter | 'all'>('all')

  const rows = useMemo(() => {
    const items = selectAttentionItems(data, { includeCompleted: true, includeScheduled: true })
    const attention: WorkRow[] = data.notifications
      .filter((notification) => !notification.read)
      .map((notification) => ({
        id: `notification-${notification.id}`,
        title: notification.title,
        subtitle: notification.body,
        projectId: data.activeProjectId,
        status: 'Needs input',
        href: notification.href,
        kind: 'approval',
      }))

    attention.push(...items
      .filter((item) => ['needs_input', 'needs_approval', 'blocked', 'failed'].includes(item.status))
      .map(toWorkRow))

    const scheduledIds = new Set(items
      .filter((item) => item.source.sourceType === 'task'
        && (item.source.task.type === 'scheduled' || item.source.task.type === 'monitor'))
      .map((item) => item.id))

    const running = items
      .filter((item) => !scheduledIds.has(item.id) && (item.status === 'running' || item.status === 'ready'))
      .map(toWorkRow)

    const scheduled = items
      .filter((item) => scheduledIds.has(item.id) && !['needs_input', 'needs_approval', 'blocked', 'failed'].includes(item.status))
      .map((item) => ({ ...toWorkRow(item), status: item.status === 'paused' ? 'Paused' : 'Scheduled' }))

    const completed = items
      .filter((item) => item.status === 'completed')
      .slice(0, 12)
      .map(toWorkRow)

    return { attention, running, scheduled, completed }
  }, [data])

  const open = (row: WorkRow) => navigate(row.href ?? `/project/${row.projectId}`)
  const sections = [
    { key: 'attention' as const, title: 'Needs attention', description: 'Approvals, questions, and blocked work', rows: rows.attention },
    { key: 'running' as const, title: 'Running', description: 'Active threads and background jobs', rows: rows.running },
    { key: 'scheduled' as const, title: 'Scheduled', description: 'Recurring tasks and armed monitors', rows: rows.scheduled },
    { key: 'completed' as const, title: 'Completed', description: 'Recent outcomes ready to revisit', rows: rows.completed },
  ]

  return (
    <div className="tf-work-page">
      <header className="tf-work-header">
        <div><span className="tf-eyebrow">Workspace</span><h1>Work</h1><p>Everything moving across your projects, ordered by what needs you next.</p></div>
        <Button variant="primary" size="sm" leadingIcon={<Icon name="plus" className="icon sm" />} onClick={() => {
          const chat = createChat(data.activeProjectId, 'New task')
          setActiveChat(chat.id)
          navigate(`/chat/${chat.id}`)
        }}>New task</Button>
      </header>

      <div className="tf-work-filters" role="tablist" aria-label="Work filters">
        {(['all', 'attention', 'running', 'scheduled', 'completed'] as const).map((item) => (
          <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
            {item === 'all' ? 'All work' : item === 'attention' ? 'Needs attention' : item[0]!.toUpperCase() + item.slice(1)}
            {item !== 'all' && <span>{rows[item].length}</span>}
          </button>
        ))}
      </div>

      <div className="tf-work-sections">
        {sections.filter((section) => filter === 'all' || section.key === filter).map((section) => (
          <Section key={section.key} title={section.title} description={section.description} rows={section.rows} onOpen={open} />
        ))}
      </div>
    </div>
  )
}
