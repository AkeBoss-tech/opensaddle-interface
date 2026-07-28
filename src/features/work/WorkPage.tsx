import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { Button } from '../../ui'
import type {
  RuntimeRunSummary,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowTimelineEvent,
} from '../../services/contracts'
import { selectAttentionItems, type AttentionItem } from '../thread/domain'

type WorkFilter = 'attention' | 'running' | 'scheduled' | 'completed' | 'archived'
type WorkAction = 'pause-workflow' | 'resume-workflow' | 'run-workflow' | 'cancel-execution' | 'retry-execution'

interface WorkRow {
  id: string
  title: string
  subtitle: string
  projectId: string
  status: string
  progress?: number
  href?: string
  kind: 'thread' | 'task' | 'workflow' | 'approval' | 'run'
  workflowId?: string
  executionId?: string
  actions?: Array<{ id: WorkAction; label: string }>
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

function workflowSchedule(trigger: Record<string, unknown>): string {
  if (trigger.type === 'cron') return `Cron · ${String(trigger.expression ?? 'schedule')}`
  if (trigger.type === 'interval') {
    const seconds = Number(trigger.seconds)
    if (Number.isFinite(seconds)) {
      if (seconds % 3_600 === 0) return `Every ${seconds / 3_600}h`
      if (seconds % 60 === 0) return `Every ${seconds / 60}m`
      return `Every ${seconds}s`
    }
  }
  if (trigger.type === 'event') return `Event · ${String(trigger.kind ?? 'custom')}`
  return String(trigger.type ?? 'Manual')
}

function taskProjectId(workflow: WorkflowDefinition, fallback: string): string {
  const value = workflow.task.project_id ?? workflow.task.projectId
  return typeof value === 'string' && value ? value : fallback
}

function Section({
  title,
  description,
  rows,
  onOpen,
  onRestore,
  onAction,
  busyAction,
}: {
  title: string
  description: string
  rows: WorkRow[]
  onOpen: (row: WorkRow) => void
  onRestore?: (row: WorkRow) => void
  onAction?: (row: WorkRow, action: WorkAction) => void
  busyAction?: string | null
}) {
  return (
    <section className="tf-work-section">
      <div className="tf-work-section-head"><div><h2>{title}</h2><p>{description}</p></div><span>{rows.length}</span></div>
      <div className="tf-work-list">
        {rows.map((row) => (
          <div key={row.id} className={`tf-work-row-wrap ${onRestore || row.actions?.length ? 'has-action' : ''}`}>
            <button className="tf-work-row" onClick={() => onOpen(row)}>
              <span className={`tf-work-icon ${row.kind}`}><Icon name={row.kind === 'approval' ? 'shield' : row.kind === 'workflow' ? 'activity' : row.kind === 'task' ? 'clock' : row.kind === 'run' ? 'terminal' : 'message'} className="icon sm" /></span>
              <span className="tf-work-copy"><strong>{row.title}</strong><small>{row.subtitle}</small></span>
              {row.progress !== undefined && <span className="tf-progress"><i style={{ width: `${row.progress}%` }} /></span>}
              <span className={`tf-work-status ${row.status.toLowerCase().replaceAll(' ', '-')}`}>{row.status}</span>
              <Icon name="chevron" className="icon xs tf-row-arrow" />
            </button>
            {(row.actions?.length || onRestore) && (
              <div className="tf-work-row-actions">
                {row.actions?.map((action) => (
                  <button
                    key={action.id}
                    className="tiny-btn"
                    disabled={busyAction !== null}
                    onClick={() => onAction?.(row, action.id)}
                  >
                    {busyAction === `${row.id}:${action.id}` ? 'Working…' : action.label}
                  </button>
                ))}
                {onRestore && <button className="tiny-btn" disabled={busyAction !== null} onClick={() => onRestore(row)}>Restore</button>}
              </div>
            )}
          </div>
        ))}
        {!rows.length && <div className="tf-work-empty"><Icon name="check" /><strong>Nothing here</strong><span>You are caught up.</span></div>}
      </div>
    </section>
  )
}

export function WorkPage() {
  const { data, createChat, setActiveChat, setChatArchived, services, toast } = useStore()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<WorkFilter | 'all'>('all')
  const [durableRuns, setDurableRuns] = useState<RuntimeRunSummary[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [timeline, setTimeline] = useState<WorkflowTimelineEvent[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>()
  const [selectedExecutionId, setSelectedExecutionId] = useState<string>()
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const refreshDurableWork = useCallback(async () => {
    const [runs, definitions, workflowExecutions] = await Promise.all([
      services?.runtime.listRuns?.() ?? Promise.resolve([]),
      services?.workflows?.list() ?? Promise.resolve([]),
      services?.workflows?.executions({ limit: 200 }) ?? Promise.resolve([]),
    ])
    setDurableRuns(runs)
    setWorkflows(definitions)
    setExecutions(workflowExecutions)
  }, [services])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      if (cancelled) return
      await refreshDurableWork()
    }
    void refresh().catch((error: unknown) => {
      if (!cancelled) toast('Could not refresh Work', error instanceof Error ? error.message : String(error))
    })
    const timer = window.setInterval(() => void refresh().catch(() => undefined), 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [refreshDurableWork, toast])

  const rows = useMemo(() => {
    const localMode = services?.mode === 'desktop' || services?.controlPlane.mode === 'local'
    const localProjectIds = new Set(
      data.projects
        .filter((project) => project.workspaceKind === 'local' || Boolean(project.local))
        .map((project) => project.id),
    )
    const items = selectAttentionItems(data, { includeCompleted: true, includeScheduled: true })
      .filter((item) => !localMode
        || (item.source.sourceType === 'thread' && localProjectIds.has(item.projectId)))
    const threadRunIds = new Set(data.messages.flatMap((message) => message.run ? [message.run.id] : []))
    const standaloneRuns: WorkRow[] = durableRuns
      .filter((run) => !threadRunIds.has(run.runId))
      .map((run) => {
        const project = data.projects.find((candidate) => candidate.id === run.projectId)
        const provider = run.route.providerKey && run.route.providerKey !== 'auto'
          ? run.route.providerKey
          : run.route.harnessKey
        const awaitingInteraction = run.status === 'running'
          && (run.lastEventType === 'approval.requested' || run.lastEventType === 'input.requested')
        return {
          id: `run-${run.runId}`,
          title: run.task,
          subtitle: `${project?.name ?? run.projectId} · ${provider} · ${run.executionMode ?? 'project'} access`,
          projectId: run.projectId,
          status: awaitingInteraction || run.status === 'waiting'
            ? 'Needs input'
            : run.status[0]!.toUpperCase() + run.status.slice(1),
          href: `/runs?run=${encodeURIComponent(run.runId)}`,
          kind: 'run' as const,
        }
      })
    const attention: WorkRow[] = (localMode ? [] : data.notifications)
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
      .filter((item) => ['needs_input', 'needs_approval', 'blocked', 'failed', 'paused'].includes(item.status))
      .map(toWorkRow))
    attention.push(...standaloneRuns.filter((run) =>
      run.status === 'Needs input' || run.status === 'Failed' || run.status === 'Paused'))

    const workflowById = new Map(workflows.map((workflow) => [workflow.workflowId, workflow]))
    const workflowRows: WorkRow[] = workflows.map((workflow) => {
      const projectId = taskProjectId(workflow, data.activeProjectId)
      return {
        id: `workflow-${workflow.workflowId}`,
        title: workflow.name,
        subtitle: `${data.projects.find((project) => project.id === projectId)?.name ?? projectId} · ${workflowSchedule(workflow.trigger)} · v${workflow.version}`,
        projectId,
        status: workflow.status === 'paused' ? 'Paused' : 'Scheduled',
        kind: 'workflow',
        workflowId: workflow.workflowId,
        actions: [
          {
            id: workflow.status === 'active' ? 'pause-workflow' : 'resume-workflow',
            label: workflow.status === 'active' ? 'Pause' : 'Resume',
          },
          ...(workflow.status === 'active' ? [{ id: 'run-workflow' as const, label: 'Run now' }] : []),
        ],
      }
    })
    const executionRows: WorkRow[] = [...executions]
      .sort((left, right) => right.queuedAt - left.queuedAt)
      .map((execution) => {
        const workflow = workflowById.get(execution.workflowId)
        const projectId = workflow ? taskProjectId(workflow, data.activeProjectId) : data.activeProjectId
        const status = execution.status === 'succeeded'
          ? 'Completed'
          : execution.status[0]!.toUpperCase() + execution.status.slice(1)
        return {
          id: `workflow-execution-${execution.executionId}`,
          title: workflow?.name ?? execution.workflowId,
          subtitle: `${data.projects.find((project) => project.id === projectId)?.name ?? projectId} · attempt ${execution.attempt} · ${new Date(execution.queuedAt).toLocaleString()}`,
          projectId,
          status,
          kind: 'workflow' as const,
          workflowId: execution.workflowId,
          executionId: execution.executionId,
          actions: execution.status === 'queued' || execution.status === 'running'
            ? [{ id: 'cancel-execution' as const, label: 'Cancel' }]
            : execution.status === 'failed' || execution.status === 'cancelled'
              ? [{ id: 'retry-execution' as const, label: 'Retry' }]
              : undefined,
        }
      })
    attention.push(...workflowRows.filter((row) => row.status === 'Paused'))
    attention.push(...executionRows.filter((row) => row.status === 'Failed'))

    const scheduledIds = new Set(items
      .filter((item) => item.source.sourceType === 'task'
        && (item.source.task.type === 'scheduled' || item.source.task.type === 'monitor'))
      .map((item) => item.id))

    const running = items
      .filter((item) => !scheduledIds.has(item.id) && (item.status === 'running' || item.status === 'ready'))
      .map(toWorkRow)
    running.push(...standaloneRuns.filter((run) => ['Queued', 'Provisioning', 'Running'].includes(run.status)))
    running.push(...executionRows.filter((row) => row.status === 'Queued' || row.status === 'Running'))

    const scheduled = items
      .filter((item) => scheduledIds.has(item.id) && !['needs_input', 'needs_approval', 'blocked', 'failed'].includes(item.status))
      .map((item) => ({ ...toWorkRow(item), status: item.status === 'paused' ? 'Paused' : 'Scheduled' }))
    scheduled.push(...workflowRows)

    const completed = items
      .filter((item) => item.status === 'completed')
      .slice(0, 12)
      .map(toWorkRow)
    completed.push(...standaloneRuns.filter((run) => ['Completed', 'Cancelled'].includes(run.status)).slice(0, 12))
    completed.push(...executionRows.filter((row) => row.status === 'Completed' || row.status === 'Cancelled').slice(0, 20))

    const archived: WorkRow[] = data.chats
      .filter((chat) => chat.archived)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((chat) => {
        const project = data.projects.find((candidate) => candidate.id === chat.projectId)
        return {
          id: chat.id,
          title: chat.title,
          subtitle: `${project?.name ?? chat.projectId} · complete task history preserved`,
          projectId: chat.projectId,
          status: 'Archived',
          href: `/chat/${chat.id}`,
          kind: 'thread' as const,
        }
      })

    return { attention, running, scheduled, completed, archived }
  }, [data, durableRuns, executions, services?.controlPlane.mode, services?.mode, workflows])

  const selectedWorkflow = workflows.find((workflow) => workflow.workflowId === selectedWorkflowId)
  const selectedExecution = executions.find((execution) => execution.executionId === selectedExecutionId)
  const loadTimeline = useCallback(async (executionId: string) => {
    if (!services?.workflows) return
    setTimeline([])
    try {
      setTimeline(await services.workflows.timeline(executionId))
    } catch (error) {
      toast('Could not load execution timeline', error instanceof Error ? error.message : String(error))
    }
  }, [services, toast])
  const open = (row: WorkRow) => {
    if (row.href) {
      navigate(row.href)
      return
    }
    if (!row.workflowId) {
      navigate(`/project/${row.projectId}`)
      return
    }
    setSelectedWorkflowId(row.workflowId)
    setSelectedExecutionId(row.executionId)
    setTimeline([])
    if (row.executionId) void loadTimeline(row.executionId)
  }
  const runWorkAction = async (row: WorkRow, action: WorkAction) => {
    if (!services?.workflows) {
      toast('Workflow service unavailable', 'Connect the local OpenSaddle server first.')
      return
    }
    setBusyAction(`${row.id}:${action}`)
    try {
      if (action === 'pause-workflow' && row.workflowId) await services.workflows.pause(row.workflowId)
      if (action === 'resume-workflow' && row.workflowId) await services.workflows.resume(row.workflowId)
      if (action === 'run-workflow' && row.workflowId) {
        const execution = await services.workflows.trigger(row.workflowId)
        setSelectedWorkflowId(row.workflowId)
        setSelectedExecutionId(execution.executionId)
        void loadTimeline(execution.executionId)
      }
      if (action === 'cancel-execution' && row.executionId) {
        await services.workflows.cancel(row.executionId)
      }
      if (action === 'retry-execution' && row.executionId) {
        const execution = await services.workflows.retry(row.executionId)
        setSelectedWorkflowId(execution.workflowId)
        setSelectedExecutionId(execution.executionId)
        void loadTimeline(execution.executionId)
      }
      await refreshDurableWork()
      toast(
        action === 'pause-workflow'
          ? 'Workflow paused'
          : action === 'resume-workflow'
            ? 'Workflow resumed'
            : action === 'run-workflow'
              ? 'Workflow queued'
              : action === 'cancel-execution'
                ? 'Execution cancelled'
                : 'Execution retried',
        row.title,
      )
    } catch (error) {
      toast('Work action failed', error instanceof Error ? error.message : String(error))
    } finally {
      setBusyAction(null)
    }
  }
  const sections = [
    { key: 'attention' as const, title: 'Needs attention', description: 'Approvals, questions, and blocked work', rows: rows.attention },
    { key: 'running' as const, title: 'Running', description: 'Active threads and background jobs', rows: rows.running },
    { key: 'scheduled' as const, title: 'Scheduled', description: 'Recurring tasks and armed monitors', rows: rows.scheduled },
    { key: 'completed' as const, title: 'Completed', description: 'Recent outcomes ready to revisit', rows: rows.completed },
    { key: 'archived' as const, title: 'Archived', description: 'Hidden tasks with restorable history', rows: rows.archived },
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
        {(['all', 'attention', 'running', 'scheduled', 'completed', 'archived'] as const).map((item) => (
          <button key={item} role="tab" aria-selected={filter === item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>
            {item === 'all' ? 'All work' : item === 'attention' ? 'Needs attention' : item[0]!.toUpperCase() + item.slice(1)}
            {item !== 'all' && <span>{rows[item].length}</span>}
          </button>
        ))}
      </div>

      {selectedWorkflow && (
        <section className="card local-run-detail">
          <div className="card-header">
            <div>
              <span className="eyebrow">{selectedExecution ? 'Workflow execution' : 'Scheduled workflow'}</span>
              <h3>{selectedWorkflow.name}</h3>
              <p>{workflowSchedule(selectedWorkflow.trigger)} · definition v{selectedWorkflow.version} · concurrency {selectedWorkflow.concurrencyLimit}</p>
            </div>
            <div className="row-actions">
              <span className={`status-pill ${selectedExecution?.status === 'succeeded' || (!selectedExecution && selectedWorkflow.status === 'active') ? 'green' : selectedExecution?.status === 'failed' ? 'red' : 'yellow'}`}>
                {selectedExecution?.status ?? selectedWorkflow.status}
              </span>
              <button className="tiny-btn" onClick={() => {
                setSelectedWorkflowId(undefined)
                setSelectedExecutionId(undefined)
                setTimeline([])
              }}>Close</button>
            </div>
          </div>
          <div className="card-body">
            <div className="session-preview-grid">
              <span>Trigger<strong>{workflowSchedule(selectedWorkflow.trigger)}</strong></span>
              <span>Task<strong>{String(selectedWorkflow.task.kind ?? selectedWorkflow.task.prompt ?? 'Agent workflow')}</strong></span>
              <span>Permissions<strong>{Object.keys(selectedWorkflow.permissionPolicy).length ? 'Policy attached' : 'Default policy'}</strong></span>
              <span>Approval<strong>{Object.keys(selectedWorkflow.approvalPolicy).length ? 'Policy attached' : 'No additional gate'}</strong></span>
            </div>
            {selectedExecution && (
              <div className="local-run-activity">
                <h4>Durable timeline</h4>
                {timeline.map((event) => (
                  <div className="local-run-activity-row" key={event.timelineId}>
                    <Icon name="activity" className="icon sm" />
                    <span><strong>{event.eventType.replaceAll('_', ' ')}</strong><small>{new Date(event.recordedAt).toLocaleString()}</small></span>
                  </div>
                ))}
                {!timeline.length && <div className="tf-work-empty"><Icon name="activity" /><strong>No timeline events yet</strong><span>The execution is queued or has not been inspected.</span></div>}
              </div>
            )}
          </div>
        </section>
      )}

      <div className="tf-work-sections">
        {sections.filter((section) => filter === 'all' || section.key === filter).map((section) => (
          <Section
            key={section.key}
            title={section.title}
            description={section.description}
            rows={section.rows}
            onOpen={open}
            onAction={(row, action) => void runWorkAction(row, action)}
            busyAction={busyAction}
            onRestore={section.key === 'archived' ? (row) => {
              setChatArchived(row.id, false)
              toast('Task restored', 'The task is visible in Recent again.')
            } : undefined}
          />
        ))}
      </div>
    </div>
  )
}
