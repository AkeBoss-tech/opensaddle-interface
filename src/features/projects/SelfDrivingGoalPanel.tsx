import { useEffect, useMemo, useState } from 'react'
import type { AutonomyPolicySummary, ProjectGoal, ProjectGoalClient } from '../../services/contracts'
import { Icon } from '../../components/common/Icon'

const labels: Record<ProjectGoal['status'], string> = {
  ready: 'Ready', planning: 'Planning', working: 'Working', needs_approval: 'Needs approval',
  paused: 'Paused', blocked: 'Blocked', completed: 'Completed', failed: 'Failed',
  cancelled: 'Stopped', exhausted: 'Limit reached',
}

export function SelfDrivingGoalPanel(props: {
  projectId: string
  client?: ProjectGoalClient
  policy?: AutonomyPolicySummary
  onOpenChannel: (threadId: string) => void
  onError: (message: string) => void
}) {
  const { projectId, client, policy, onOpenChannel, onError } = props
  const [goal, setGoal] = useState<ProjectGoal | null>(null)
  const [objective, setObjective] = useState('')
  const [criteria, setCriteria] = useState('')
  const [busy, setBusy] = useState(false)
  const available = Boolean(client && policy?.enabled)
  const harness = policy?.allowedHarnesses[0]

  useEffect(() => {
    let active = true
    if (!client) return () => { active = false }
    client.get(projectId).then((value) => {
      if (!active || !value) return
      setGoal(value)
      setObjective(value.objective)
      setCriteria(value.acceptanceCriteria.join('\n'))
    }).catch((error) => active && onError(error instanceof Error ? error.message : String(error)))
    return () => { active = false }
  }, [client, onError, projectId])

  const criteriaValues = useMemo(
    () => criteria.split('\n').map((value) => value.trim()).filter(Boolean), [criteria],
  )

  const act = async (operation: () => Promise<ProjectGoal>) => {
    setBusy(true)
    try { setGoal(await operation()) } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally { setBusy(false) }
  }

  const start = () => act(async () => {
    if (!client || !harness) throw new Error('No self-driving harness is allowed by server policy.')
    const ready = goal?.status === 'ready'
      ? goal
      : await client.set(projectId, { objective, acceptanceCriteria: criteriaValues })
    return client.start(projectId, {
      harness,
      idempotencyKey: `project-goal-${ready.goalId}-v${ready.version}`,
    })
  })

  const locked = Boolean(goal && !['ready', 'completed', 'failed', 'cancelled', 'exhausted'].includes(goal.status))
  const canStart = available && !busy && Boolean(objective.trim() && criteriaValues.length && (!goal || goal.availableActions.start))

  return (
    <section className="tw-self-driving" aria-labelledby="self-driving-title">
      <div className="tw-self-driving-heading">
        <span className="tw-self-driving-icon"><Icon name="spark" className="icon sm" /></span>
        <div>
          <span className="tw-kicker">Project autonomy</span>
          <h2 id="self-driving-title">Self-driving mode</h2>
          <p>Give this project an explicit outcome. OpenSaddle starts a governed supervisor and keeps evidence, Channels, limits, and approvals visible.</p>
        </div>
        <span className={`tw-goal-status ${goal?.status ?? 'unconfigured'}`}>
          {goal ? labels[goal.status] : available ? 'Not configured' : 'Unavailable'}
        </span>
      </div>

      {!available || !policy ? (
        <div className="tw-self-driving-unavailable">
          Enable <code>collaboration.autonomy</code> on a connected OpenSaddle server to use this control.
        </div>
      ) : (
        <div className="tw-self-driving-body">
          <div className="tw-goal-fields">
            <label>
              <span>What outcome should this project drive toward?</span>
              <textarea value={objective} disabled={locked} rows={3} onChange={(event) => setObjective(event.target.value)} placeholder="Deliver a verified release that…" />
            </label>
            <label>
              <span>How will we know it is done? <small>One criterion per line</small></span>
              <textarea value={criteria} disabled={locked} rows={3} onChange={(event) => setCriteria(event.target.value)} placeholder={'The visual demo works\nAll relevant tests pass\nEvidence is linked'} />
            </label>
          </div>
          <aside className="tw-goal-policy">
            <strong>Server policy</strong>
            <span>{policy.defaultExecutionMode === 'plan' ? 'Plan-first' : 'Project write mode'}</span>
            <span>{policy.allowWrite ? 'Writes allowed with approval' : 'Read-only'}</span>
            <span>{policy.allowNetwork ? 'Network allowed with approval' : 'No network'}</span>
            <span>{policy.maxMinutesPerSession} min · {policy.maxRunsPerSession} runs · {policy.maxActiveChildrenPerSession} active children</span>
            <span>{harness ?? 'No harness configured'}</span>
          </aside>
        </div>
      )}

      {available && policy && (
        <div className="tw-goal-actions">
          {(!goal || goal.availableActions.start) && <button className="primary" disabled={!canStart} onClick={start}><Icon name="arrow" className="icon sm" /> {busy ? 'Starting…' : 'Start working'}</button>}
          {goal?.availableActions.pause && <button disabled={busy} onClick={() => act(() => client!.pause(projectId, goal.revision))}>Pause</button>}
          {goal?.availableActions.resume && <button className="primary" disabled={busy} onClick={() => act(() => client!.resume(projectId, goal.revision))}>Resume</button>}
          {goal?.availableActions.stop && <button className="danger" disabled={busy} onClick={() => act(() => client!.stop(projectId, goal.revision))}>Stop</button>}
          {goal?.rootThreadId && <button onClick={() => onOpenChannel(goal.rootThreadId!)}><Icon name="trace" className="icon sm" /> Open supervisor Channel</button>}
          {goal?.supervisorRunId && <small>Run {goal.supervisorRunId}</small>}
        </div>
      )}
    </section>
  )
}
