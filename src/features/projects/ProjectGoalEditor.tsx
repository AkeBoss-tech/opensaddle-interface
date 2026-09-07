import React, { useEffect, useState, type FormEvent } from 'react'
import type { ProjectGoal, ProjectGoalClient } from '../../services/contracts'
import { GoalRevisionConflictError } from '../../services/remoteProjectGoals'

void React

export function ProjectGoalEditor({ projectId, client }: { projectId: string; client?: ProjectGoalClient }) {
  const [goal, setGoal] = useState<ProjectGoal | null>(null)
  const [objective, setObjective] = useState('')
  const [criteria, setCriteria] = useState('')
  const [loading, setLoading] = useState(Boolean(client))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    if (!client) return
    setLoading(true); setError(null)
    try {
      const current = await client.get(projectId)
      setGoal(current)
      setObjective(current?.objective ?? '')
      setCriteria(current?.acceptanceCriteria.join('\n') ?? '')
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [client, projectId]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!client || !objective.trim()) return
    setSaving(true); setError(null)
    const input = { objective: objective.trim(), acceptanceCriteria: criteria.split('\n').map((value) => value.trim()).filter(Boolean) }
    try {
      const saved = goal && client.revise
        ? await client.revise(projectId, { expectedRevision: goal.revision, ...input })
        : await client.set(projectId, input)
      setGoal(saved); setObjective(saved.objective); setCriteria(saved.acceptanceCriteria.join('\n'))
    } catch (reason) {
      setError(reason instanceof GoalRevisionConflictError ? reason.message : reason instanceof Error ? reason.message : String(reason))
    } finally { setSaving(false) }
  }

  return <section className="settings-card" aria-labelledby="project-goal-title">
    <h2 id="project-goal-title">Objective</h2>
    {!client ? <p className="cc-section-empty">This server does not offer authorized objective editing.</p> : loading ? <p aria-live="polite">Loading objective…</p> : <form onSubmit={save}>
      <label>What outcome matters now?<textarea value={objective} onChange={(event) => setObjective(event.target.value)} required /></label>
      <label>What will show it is done?<textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} placeholder="One result per line" /></label>
      {goal && <p className="cc-identity"><code>{goal.goalId}</code> · revision <code>{goal.revision}</code></p>}
      <p className="cc-section-empty">Saving this objective records direction. It does not start work.</p>
      {error && <div role="alert"><p className="error-text">{error}</p>{error.includes('draft has been kept') && <button type="button" className="btn btn-secondary" onClick={() => void load()}>Reload latest</button>}</div>}
      <button type="submit" className="btn btn-primary" disabled={saving || !objective.trim()}>{saving ? 'Saving…' : goal ? 'Save revision' : 'Create objective'}</button>
    </form>}
  </section>
}
