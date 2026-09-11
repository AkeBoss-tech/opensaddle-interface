import React from 'react'
import { Link } from 'react-router-dom'
import type { CommandCenterSnapshot } from '../../services/contracts'

void React

function projectHref(projectId: string) { return `/project/${encodeURIComponent(projectId)}/overview` }
function dateTime(value?: string) {
  if (!value) return 'Update time unavailable'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Update time unavailable' : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function priorityMessage(status: CommandCenterSnapshot['priorityStatus']) {
  if (status.reason === 'no_active_goal') return 'No active objective is recorded.'
  if (status.reason === 'multiple_active_goals') return 'Multiple active objectives exist. Home will not choose one without an explicit selection.'
  if (status.reason === 'goal_store_unavailable') return 'The control plane has no authoritative objective source.'
  if (status.reason === 'goal_authority_not_configured') return 'Objective tracking is not configured for this server.'
  return status.reason ?? (status.state === 'empty' ? 'No active objective is recorded.' : status.state === 'ambiguous' ? 'Multiple active objectives exist. Home will not choose one without an explicit selection.' : 'The control plane has no authoritative objective source.')
}

export function CurrentObjectivePanel({ snapshot, projectName }: { snapshot: CommandCenterSnapshot; projectName: (projectId: string) => string }) {
  const priority = snapshot.priority
  const status = snapshot.priorityStatus
  return <section className="cc-priority" aria-labelledby="cc-priority-title">
    <div className="cc-section-heading"><div><span className="eyebrow">Now</span><h2 id="cc-priority-title">Current objective</h2></div>{priority && <span className={`cc-status cc-status--${priority.status}`}>{priority.status.replaceAll('_', ' ')}</span>}</div>
    {priority && status.state === 'available' ? <>
      <Link className="cc-objective" to={projectHref(priority.projectId)}>{priority.objective}</Link>
      <p className="cc-identity">{projectName(priority.projectId)} · <code>{priority.goalId ?? priority.projectId}</code>{priority.goalRevision !== undefined && <> · revision <code>{priority.goalRevision}</code></>} · updated <time dateTime={priority.updatedAt}>{dateTime(priority.updatedAt)}</time></p>
      <h3>Acceptance criteria</h3>
      {priority.acceptanceCriteria.length ? <ol className="cc-outcome-list">{priority.acceptanceCriteria.slice(0, 3).map((criterion) => <li key={criterion}>{criterion}</li>)}</ol> : <p className="cc-section-empty">No acceptance criteria are recorded for this objective.</p>}
    </> : <><p className="cc-section-empty" role="status">{priorityMessage(status)}</p>{status.state === 'empty' && snapshot.projects.length === 1 && <Link to={projectHref(snapshot.projects[0].projectId)}>Create objective</Link>}</>}
  </section>
}
