import React, { useRef, useState } from 'react'
import type { ProjectModelBudget, ProjectModelBudgetClient } from '../../services/projectModelBudget'
import { Button } from '../../ui/Button'

export function ProjectModelBudgetPanel({ projectId, client }: { projectId: string; client: ProjectModelBudgetClient }) {
  return <BudgetForm key={`${projectId}:${client.identity()}`} projectId={projectId} client={client} />
}

function BudgetForm({ projectId, client }: { projectId: string; client: ProjectModelBudgetClient }) {
  const [snapshot, setSnapshot] = useState<{ client: ProjectModelBudgetClient; value: ProjectModelBudget } | null>(null)
  const data = snapshot?.client === client ? snapshot.value : null
  const [draft, setDraft] = useState('')
  const [review, setReview] = useState<{ amount: number; revision: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const generation = useRef(0)

  async function reload() {
    const current = ++generation.current
    setSnapshot(null); setReview(null); setDraft(''); setError(''); setNotice(''); setBusy(true)
    try { const value = await client.status(projectId); if (current === generation.current) { setSnapshot({ client, value }); return true } }
    catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : 'Project budget unavailable') }
    finally { if (current === generation.current) setBusy(false) }
    return false
  }
  React.useEffect(() => { void reload(); return () => { generation.current++ } }, [client, projectId])

  function prepare() {
    if (!data || !data.can_manage || busy || !/^(0|[1-9][0-9]*)$/.test(draft)) { setError('Enter a whole number of route microunits.'); return }
    const amount = Number(draft)
    if (!Number.isSafeInteger(amount)) { setError('The limit exceeds the safe interface integer range.'); return }
    setReview({ amount, revision: data.revision }); setError(''); setNotice('')
  }
  async function save() {
    if (!data?.can_manage || !review || busy || review.revision !== data.revision) return
    const current = ++generation.current
    setBusy(true); setError(''); setNotice('')
    try {
      await client.configure(projectId, review.amount, review.revision)
      if (current !== generation.current) return
      // Re-read the authoritative reservation sum; PUT may race a hosted Run.
      if (await reload() && current + 1 === generation.current) setNotice('Budget saved. Current hosted reservations were refreshed.')
    } catch (reason) {
      if (current === generation.current) {
        setSnapshot(null); setReview(null); setDraft('')
        setError(reason instanceof Error ? reason.message : 'Budget change uncertain. Reload before trying again.')
        setBusy(false)
      }
    }
  }
  return <section className="settings-card project-model-budget" aria-label="Project hosted model budget">
    <h2>Hosted model route budget</h2>
    <p>This is one Project lifetime ceiling shared by hosted model routes across Runs. It counts reserved route microunits, including failed or uncertain provider calls. Native Codex and Claude spend is outside this limit. Microunits are configured route units, not a USD amount.</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <Button disabled={busy} onClick={() => void reload()}>{busy ? 'Loading budget…' : 'Reload budget'}</Button>
    {data && <>
      <dl><dt>Limit</dt><dd>{data.state === 'configured' ? `${data.max_reserved_cost_microunits} route microunits` : 'No Project limit configured'}</dd>
        <dt>Reserved</dt><dd>{data.reserved_cost_microunits} route microunits</dd>
        <dt>Revision</dt><dd>{data.revision}</dd></dl>
      {data.state === 'configured' && data.reserved_cost_microunits > data.max_reserved_cost_microunits! && <p>Current reservations exceed this limit. New hosted routes are blocked until the limit is raised; prior reservations remain recorded.</p>}
      {data.recent_changes.length > 0 && <details><summary>Recent budget changes</summary><ol>{data.recent_changes.map(change => <li key={change.revision}>Revision {change.revision}: {change.previous_max_reserved_cost_microunits ?? 'unconfigured'} → {change.max_reserved_cost_microunits} route microunits · {change.configured_by} · {change.recorded_at}</li>)}</ol></details>}
      {data.can_manage ? <>
        <label>New lifetime limit in route microunits<input aria-label="New lifetime limit in route microunits" inputMode="numeric" value={draft} disabled={busy} onChange={event => { setDraft(event.target.value); setReview(null); setError('') }} /></label>
        <Button disabled={busy || !draft} onClick={prepare}>Review budget change</Button>
        {review && <div role="group" aria-label="Review budget change"><p>Set this Project’s hosted route lifetime limit to <strong>{review.amount} route microunits</strong>, replacing revision {review.revision}. Prior failed and uncertain reservations stay charged.</p>
          <Button disabled={busy} onClick={() => void save()}>Save reviewed budget</Button>
          <Button disabled={busy} onClick={() => setReview(null)}>Keep current budget</Button></div>}
      </> : <p>Only a current Project owner or admin can change this budget.</p>}
    </>}
  </section>
}
