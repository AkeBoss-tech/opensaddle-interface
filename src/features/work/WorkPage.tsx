import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../components/common/Icon'
import { useStore } from '../../data/store'
import { Button, Dialog, Drawer } from '../../ui'
import { SurfaceHost } from '../../ui/SurfaceHost'
import '../../surfaces/WorkSurface'
import '../../styles/surface-host.css'
import { type WorkAction, type WorkFilter, type WorkRow } from '../../surfaces/WorkSurface'
import type {
  RuntimeRunSummary,
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowTimelineEvent,
  OnboardingRunSummary,
} from '../../services/contracts'
import { selectAttentionItems, type AttentionItem } from '../thread/domain'


function relativeTime(timestamp?: number) {
  if (!timestamp) return undefined
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000))
  if (minutes < 1) return 'Updated now'
  if (minutes < 60) return `Updated ${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `Updated ${hours}h ago`
  return `Updated ${Math.round(hours / 24)}d ago`
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
    subtitle: item.detail,
    projectId: item.projectId,
    status: statusLabel(item.status),
    owner: item.projectName,
    priority: item.priority,
    timeSignal: relativeTime(item.updatedAt),
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

function descendantProjectIds(projects: Array<{ id: string; parentId: string | null }>, rootId: string) {
  const ids = new Set([rootId])
  let changed = true
  while (changed) {
    changed = false
    for (const project of projects) {
      if (project.parentId && ids.has(project.parentId) && !ids.has(project.id)) {
        ids.add(project.id)
        changed = true
      }
    }
  }
  return ids
}


export function WorkPage() {
  const { data, createChat, setActiveChat, setChatArchived, services, toast } = useStore()
  const navigate = useNavigate()
  const connectedLocal = Boolean(services?.controlPlane.connected && services.controlPlane.mode === 'local')
  const [filter, setFilter] = useState<WorkFilter | 'all'>('all')
  const [durableRuns, setDurableRuns] = useState<RuntimeRunSummary[]>([])
  const [onboardingRuns, setOnboardingRuns] = useState<OnboardingRunSummary[]>([])
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([])
  const [executions, setExecutions] = useState<WorkflowExecution[]>([])
  const [timeline, setTimeline] = useState<WorkflowTimelineEvent[]>([])
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>()
  const [selectedExecutionId, setSelectedExecutionId] = useState<string>()
  const [selectedRow, setSelectedRow] = useState<WorkRow>()
  const [busyAction, setBusyAction] = useState<string | null>(null)

  const refreshDurableWork = useCallback(async () => {
    if (services?.controlPlane.connected && services.controlPlane.mode === 'local') {
      const runs = await services.localProjects?.listOnboardingRuns?.(200) ?? []
      setOnboardingRuns(runs)
      setDurableRuns([]); setWorkflows([]); setExecutions([])
      return
    }
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
    let refreshing = false
    const refresh = async () => {
      if (cancelled || refreshing) return
      refreshing = true
      try {
        await refreshDurableWork()
      } finally {
        refreshing = false
      }
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
    if (services?.controlPlane.connected && services.controlPlane.mode === 'local') {
      const localRows = onboardingRuns.map<WorkRow>((run) => {
        const project = data.projects.find((candidate) => candidate.id === run.projectId)
        const status = run.status === 'approval_required' ? 'Needs approval'
          : run.status === 'verification_failed' ? 'Failed'
            : run.status[0]!.toUpperCase() + run.status.slice(1).replaceAll('_', ' ')
        return {
          id: `onboarding-${run.runId}`,
          title: run.recommendationId ?? 'Governed onboarding run',
          subtitle: `${run.changedFileCount} changed file${run.changedFileCount === 1 ? '' : 's'} · ${run.materializationValidation?.artifactKind?.replaceAll('_', ' ') ?? run.recommendationKind ?? 'project change'}`,
          projectId: run.projectId,
          owner: project?.name ?? run.projectId,
          status,
          timeSignal: relativeTime(run.updatedAt),
          href: `/project/${encodeURIComponent(run.projectId)}/onboarding?run=${encodeURIComponent(run.runId)}`,
          kind: run.status === 'approval_required' ? 'approval' : 'run',
        }
      })
      return {
        attention: localRows.filter((row) => ['Needs approval', 'Failed', 'Interrupted'].includes(row.status)),
        running: localRows.filter((row) => row.status === 'Running'),
        scheduled: [],
        completed: localRows.filter((row) => ['Committed', 'Applied', 'Rejected'].includes(row.status)),
        archived: [],
      }
    }
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
          subtitle: `${provider} agent using ${run.executionMode ?? 'project'} access`,
          projectId: run.projectId,
          owner: project?.name ?? run.projectId,
          timeSignal: relativeTime(run.updatedAt),
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
        owner: 'OpenSaddle',
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
        subtitle: `${workflowSchedule(workflow.trigger)} workflow`,
        projectId,
        owner: data.projects.find((project) => project.id === projectId)?.name ?? projectId,
        timeSignal: `Definition v${workflow.version}`,
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
          subtitle: `Workflow execution · attempt ${execution.attempt}`,
          projectId,
          owner: data.projects.find((project) => project.id === projectId)?.name ?? projectId,
          timeSignal: relativeTime(execution.queuedAt),
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
          subtitle: 'Complete task history preserved',
          projectId: chat.projectId,
          owner: project?.name ?? chat.projectId,
          timeSignal: relativeTime(chat.updatedAt),
          status: 'Archived',
          href: `/chat/${chat.id}`,
          kind: 'thread' as const,
        }
      })

    const scopedProjectIds = descendantProjectIds(data.projects, data.activeProjectId)
    const inSelectedTeam = (row: WorkRow) => scopedProjectIds.has(row.projectId)
    return {
      attention: attention.filter(inSelectedTeam),
      running: running.filter(inSelectedTeam),
      scheduled: scheduled.filter(inSelectedTeam),
      completed: completed.filter(inSelectedTeam),
      archived: archived.filter(inSelectedTeam),
    }
  }, [data, durableRuns, executions, onboardingRuns, services?.controlPlane.connected, services?.controlPlane.mode, services?.mode, workflows])

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
    setSelectedRow(row)
    setSelectedWorkflowId(row.workflowId)
    setSelectedExecutionId(row.executionId)
    setTimeline([])
    if (row.executionId) void loadTimeline(row.executionId)
  }
  const closeDetails = () => {
    setSelectedRow(undefined)
    setSelectedWorkflowId(undefined)
    setSelectedExecutionId(undefined)
    setTimeline([])
  }
  const openSelectedWork = () => {
    if (!selectedRow) return
    const destination = selectedRow.href ?? `/project/${selectedRow.projectId}`
    closeDetails()
    navigate(destination)
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
  const selectedProject = selectedRow
    ? data.projects.find((project) => project.id === selectedRow.projectId)
    : undefined
  const detailBody = selectedRow ? (
    <div className="tf-work-detail">
      <div className="tf-work-detail-summary">
        <span className={`tf-work-icon ${selectedRow.kind}`}>
          <Icon name={selectedRow.kind === 'approval' ? 'shield' : selectedRow.kind === 'workflow' ? 'activity' : selectedRow.kind === 'run' ? 'terminal' : 'message'} className="icon sm" />
        </span>
        <div>
          <span className={`tf-work-status ${selectedRow.status.toLowerCase().replaceAll(' ', '-')}`}>{selectedRow.status}</span>
          <p>{selectedRow.subtitle}</p>
        </div>
      </div>
      <dl className="tf-work-detail-grid">
        <div><dt>Team area</dt><dd>{selectedProject?.name ?? selectedRow.projectId}</dd></div>
        <div><dt>Owner or agent</dt><dd>{selectedRow.owner ?? 'OpenSaddle agent'}</dd></div>
        <div><dt>Priority</dt><dd>{selectedRow.priority ? selectedRow.priority[0]!.toUpperCase() + selectedRow.priority.slice(1) : 'Normal'}</dd></div>
        <div><dt>Last signal</dt><dd>{selectedRow.timeSignal ?? 'Current status'}</dd></div>
      </dl>

      {selectedWorkflow && (
        <section className="tf-work-detail-section">
          <div className="tf-work-detail-section-head">
            <div>
              <span className="tf-eyebrow">{selectedExecution ? 'Workflow execution' : 'Scheduled workflow'}</span>
              <h3>Workflow details</h3>
            </div>
            <span className={`status-pill ${selectedExecution?.status === 'succeeded' || (!selectedExecution && selectedWorkflow.status === 'active') ? 'green' : selectedExecution?.status === 'failed' ? 'red' : 'yellow'}`}>
              {selectedExecution?.status ?? selectedWorkflow.status}
            </span>
          </div>
          <div className="tf-work-detail-grid">
            <div><dt>Trigger</dt><dd>{workflowSchedule(selectedWorkflow.trigger)}</dd></div>
            <div><dt>Definition</dt><dd>Version {selectedWorkflow.version}</dd></div>
            <div><dt>Concurrency</dt><dd>{selectedWorkflow.concurrencyLimit}</dd></div>
            <div><dt>Approval</dt><dd>{Object.keys(selectedWorkflow.approvalPolicy).length ? 'Policy attached' : 'No additional gate'}</dd></div>
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
        </section>
      )}

      {selectedRow.actions?.length ? (
        <section className="tf-work-detail-section">
          <span className="tf-eyebrow">Available actions</span>
          <div className="tf-work-detail-actions">
            {selectedRow.actions.map((action) => (
              <Button
                key={action.id}
                variant="secondary"
                size="sm"
                disabled={busyAction !== null}
                onClick={() => void runWorkAction(selectedRow, action.id)}
              >
                {busyAction === `${selectedRow.id}:${action.id}` ? 'Working…' : action.label}
              </Button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  ) : null
  const detailFooter = selectedRow ? (
    <div className="tf-work-detail-footer">
      {selectedRow.status === 'Archived' && (
        <Button variant="secondary" size="sm" onClick={() => {
          setChatArchived(selectedRow.id, false)
          toast('Task restored', 'The task is visible in Recent again.')
          closeDetails()
        }}>Restore task</Button>
      )}
      <Button variant="ghost" size="sm" onClick={closeDetails}>Close</Button>
      <Button variant="primary" size="sm" onClick={openSelectedWork}>
        {selectedRow.kind === 'approval' ? 'Review request' : 'Open work'}
      </Button>
    </div>
  ) : null

  if (connectedLocal) {
    const localSections = [
      { title: 'Needs attention', description: 'Exact-diff approvals, verification failures, and interrupted runs', rows: rows.attention },
      { title: 'Running', description: 'Active detached-worktree executions', rows: rows.running },
      { title: 'Completed', description: 'Committed, applied, and rejected governed outcomes', rows: rows.completed },
    ]
    return <div className="content-page connected-local-page">
      <header className="page-header"><div><span className="eyebrow">Authoritative run registry</span><h1>Work</h1><p>Sanitized, newest-first governed onboarding summaries from the local OpenSaddle server.</p></div><Button onClick={() => window.dispatchEvent(new Event('opensaddle:add-project'))}>Add local project</Button></header>
      {localSections.map((section) => <section className="settings-card" key={section.title}><div className="section-heading"><div><h2>{section.title}</h2><p>{section.description}</p></div><span>{section.rows.length}</span></div>{section.rows.length ? <div className="list-stack">{section.rows.map((row) => <button className="list-row" type="button" key={row.id} onClick={() => navigate(row.href ?? `/project/${row.projectId}`)}><span><strong>{row.title}</strong><small>{row.subtitle}</small></span><span><strong>{row.status}</strong><small>{row.owner} · {row.timeSignal}</small></span></button>)}</div> : <div className="empty-state">Nothing here.</div>}</section>)}
    </div>
  }

  return (
    <>
      <SurfaceHost
        surfaceId="work"
        projectId={data.activeProjectId}
        permissions={services?.permissions}
        inputs={{
          activeProjectName: data.projects.find((project) => project.id === data.activeProjectId)?.name ?? 'OpenSaddle',
          filter,
          sections,
          onCreateTask: () => {
            if (services?.controlPlane.connected && services.controlPlane.mode === 'local') {
              window.dispatchEvent(new Event('opensaddle:add-project'))
              return
            }
            const chat = createChat(data.activeProjectId, 'New task')
            setActiveChat(chat.id)
            navigate(`/chat/${chat.id}`)
          },
          onFilterChange: setFilter,
          onOpen: open,
        }}
      />
      {selectedRow?.kind === 'approval' ? (
        <Dialog
          open
          onClose={closeDetails}
          title={selectedRow.title}
          description="Approval or review request"
          size="lg"
          className="tf-work-approval-sheet"
          footer={detailFooter}
        >
          {detailBody}
        </Dialog>
      ) : (
        <Drawer
          open={Boolean(selectedRow)}
          onClose={closeDetails}
          title={selectedRow?.title ?? 'Work details'}
          description={selectedRow ? `${selectedRow.status} · ${selectedProject?.name ?? selectedRow.projectId}` : undefined}
          className="tf-work-drawer"
          footer={detailFooter}
        >
          {detailBody}
        </Drawer>
      )}
    </>
  )
}
