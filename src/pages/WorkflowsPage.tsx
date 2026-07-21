import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'

export function WorkflowsPage() {
  const { projectId } = useParams()
  const { data, createWorkflow, updateWorkflowStatus, runWorkflow, toast } = useStore()
  const [name, setName] = useState('New workflow')
  const [runningId, setRunningId] = useState<string | null>(null)

  const workflows = useMemo(
    () => data.workflows.filter((w) => !projectId || w.projectId === projectId),
    [data.workflows, projectId],
  )

  const runs = useMemo(
    () => data.workflowRuns.filter((r) => !projectId || r.projectId === projectId),
    [data.workflowRuns, projectId],
  )

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Automation plane</div>
          <h1>Workflows</h1>
          <p>Scheduled and event-driven agent pipelines — separate from chats, with their own run history and approvals.</p>
        </div>
        <div className="page-header-actions">
          <input value={name} onChange={(e) => setName(e.target.value)} />
          <button className="primary-btn" onClick={() => {
            const project = projectId ?? data.activeProjectId
            createWorkflow({
              projectId: project,
              name,
              description: 'Manual workflow created from the workflows area.',
              trigger: 'manual',
              agentIds: data.agents.filter((a) => a.projectId === project).slice(0, 1).map((a) => a.id),
              steps: [
                { id: 's1', label: 'Gather context', kind: 'context' },
                { id: 's2', label: 'Run agent', kind: 'agent' },
              ],
              status: 'draft',
              approvalRequired: false,
            })
            toast('Workflow created', name)
            setName('New workflow')
          }}>Create workflow</button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><div><h3>Definitions</h3></div><Link className="tiny-btn right" to="/agents">Agents</Link></div>
          <div className="card-body row-list">
            {workflows.map((wf) => {
              const agents = data.agents.filter((a) => wf.agentIds.includes(a.id))
              const project = data.projects.find((p) => p.id === wf.projectId)
              return (
                <div className="row-item" key={wf.id} style={{ alignItems: 'flex-start' }}>
                  <div className="row-icon"><Icon name="clock" className="icon sm" /></div>
                  <div className="row-copy">
                    <div className="row-title">{wf.name}</div>
                    <div className="row-sub">{project?.name} · {wf.trigger}{wf.schedule ? ` · ${wf.schedule}` : ''}</div>
                    <p style={{ margin: '8px 0', fontSize: 11, color: 'var(--muted)' }}>{wf.description}</p>
                    <div className="mini-tags">
                      {agents.map((a) => <span className="mini-tag" key={a.id}>{a.name}</span>)}
                      {wf.approvalRequired && <span className="mini-tag">Approval</span>}
                    </div>
                    <div className="wiki-section">
                      <h4>Steps</h4>
                      {wf.steps.map((s) => <div className="wiki-bullet" key={s.id}><Icon name="check" className="icon sm" /><span>{s.label} · {s.kind}</span></div>)}
                    </div>
                  </div>
                  <div className="row-actions" style={{ flexDirection: 'column' }}>
                    <span className={`status-pill ${wf.status === 'active' ? 'green' : wf.status === 'paused' ? 'yellow' : ''}`}>{wf.status}</span>
                    <button className="tiny-btn" onClick={() => updateWorkflowStatus(wf.id, wf.status === 'active' ? 'paused' : 'active')}>
                      {wf.status === 'active' ? 'Pause' : 'Activate'}
                    </button>
                    <button className="tiny-btn" disabled={runningId === wf.id} onClick={() => {
                      setRunningId(wf.id)
                      void runWorkflow(wf.id).finally(() => setRunningId(null))
                    }}>{runningId === wf.id ? 'Running…' : 'Run now'}</button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div><h3>Recent runs</h3></div></div>
          <div className="card-body row-list">
            {runs.map((run) => {
              const wf = data.workflows.find((w) => w.id === run.workflowId)
              return (
                <div className="row-item" key={run.id}>
                  <div className="row-icon"><Icon name="activity" className="icon sm" /></div>
                  <div className="row-copy">
                    <div className="row-title">{wf?.name ?? run.workflowId}</div>
                    <div className="row-sub">{run.summary}</div>
                  </div>
                  <span className={`status-pill ${run.status === 'completed' ? 'green' : run.status === 'waiting' ? 'yellow' : ''}`}>{run.status}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
