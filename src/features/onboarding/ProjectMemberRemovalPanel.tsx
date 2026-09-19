import React, { useEffect, useRef, useState } from 'react'
import type { JourneyAuthority, JourneySnapshot } from './ConnectedJourneySurface'

type Review = { subject: string; role: string; revision: number }
type Receipt = { subject: string; cancellationRequested: number; cancelledBeforeExecution: number; cancelledPaused: number; revokedWorkerCredentials: number }
void React

export function ProjectMemberRemovalPanel({ authority, projectId, snapshot, onRefresh }: {
  authority: JourneyAuthority; projectId: string; snapshot: JourneySnapshot; onRefresh: () => Promise<void>
}) {
  const [review, setReview] = useState<Review>()
  const [receipt, setReceipt] = useState<Receipt>()
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0), locked = useRef(false)
  useEffect(() => { generation.current++; locked.current = false; setReview(undefined); setReceipt(undefined); setError(''); setStale(false); setBusy(false); return () => { generation.current++ } }, [authority, projectId])
  useEffect(() => { setReview(undefined); setReceipt(undefined); setError(''); setStale(false) }, [snapshot.currentSubject])
  useEffect(() => { setReview(undefined) }, [snapshot.rosterRevision])
  if (!snapshot.membershipRemovalAvailable || !authority.removeMember || !Number.isSafeInteger(snapshot.rosterRevision) || !snapshot.rosterRevision || snapshot.rosterRevision < 1 || !snapshot.currentSubject) return null
  const caller = snapshot.members.find(member => member.subject === snapshot.currentSubject && member.status === 'active')
  if (!caller) return null
  const canRemove = (member: JourneySnapshot['members'][number]) => member.status === 'active' &&
    (member.subject === caller.subject || caller.role === 'owner' || caller.role === 'admin' && !['owner', 'admin'].includes(member.role))
  const submit = async () => {
    if (locked.current || stale || !review || snapshot.rosterRevision !== review.revision ||
      !snapshot.members.some(member => member.subject === review.subject && member.role === review.role && canRemove(member))) return
    locked.current = true; setBusy(true)
    const current = generation.current
    try {
      // The authority rereads the exact Core roster and revision before POST.
      const raw = await authority.removeMember!(projectId, review.subject, review.role, review.revision)
      if (current !== generation.current) return
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Removal receipt is unavailable')
      const value = raw as Record<string, unknown>
      if (value.schema_version !== 'opensaddle.project-member-removal.v1' || value.project_id !== projectId ||
        value.subject !== review.subject || value.membership_revision !== review.revision + 1 ||
        value.process_termination_confirmed !== false || !Array.isArray(value.cancellation_requested) ||
        !Array.isArray(value.cancelled_before_execution) || !Array.isArray(value.cancelled_paused) ||
        !Number.isSafeInteger(value.revoked_worker_credentials) || Number(value.revoked_worker_credentials) < 0 ||
        value.worker_credentials_may_cover_other_projects !== true) throw Error('Removal outcome is unconfirmed')
      setReceipt({ subject: review.subject, cancellationRequested: value.cancellation_requested.length,
        cancelledBeforeExecution: value.cancelled_before_execution.length, cancelledPaused:value.cancelled_paused.length,
        revokedWorkerCredentials:Number(value.revoked_worker_credentials) })
      setReview(undefined); setError('')
      await onRefresh()
    } catch {
      if (current === generation.current) { setReview(undefined); setReceipt(undefined); setStale(true); setError('Removal outcome is unconfirmed. Reload the Project roster before deciding again; no automatic retry was sent.') }
    } finally { if (current === generation.current) { locked.current = false; setBusy(false) } }
  }
  const reload = async () => {
    if (locked.current) return
    locked.current = true; setBusy(true)
    const current = generation.current
    try { await onRefresh(); if (current === generation.current) { setStale(false); setError('') } }
    finally { if (current === generation.current) { locked.current = false; setBusy(false) } }
  }
  return <div aria-label="Project membership removal">
    {snapshot.members.filter(canRemove).map(member => <button key={member.subject} disabled={busy || stale || Boolean(review)} onClick={() => { setReceipt(undefined); setError(''); setReview({ subject: member.subject, role: member.role, revision: snapshot.rosterRevision! }) }}>
      {member.subject === caller.subject ? 'Review leaving Project' : `Review removal of ${member.subject}`}
    </button>)}
    {review && <div role="group" aria-label="Review Project access removal">
      <p>Remove <strong>{review.subject}</strong> ({review.role}) from this Project at membership revision {review.revision}?</p>
      <p>Scoped agent sessions and invitations are revoked. Worker credentials this member issued for this Project will be revoked; shared workers may need new credentials in other Projects. Queued and paused work is cancelled; active Runs receive a cancellation request, not a confirmed stop. In-flight effects may already have occurred. Team and other Project memberships remain.</p>
      <button disabled={busy} onClick={() => void submit()}>{review.subject === caller.subject ? 'Confirm leaving Project' : 'Confirm removal'}</button>
      <button disabled={busy} onClick={() => setReview(undefined)}>Keep member</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {stale && <button disabled={busy} onClick={() => void reload()}>Reload Project roster</button>}
    {receipt && <p role="status">{receipt.subject} removed from this Project. {receipt.cancelledBeforeExecution} queued Runs and {receipt.cancelledPaused} paused Runs cancelled; {receipt.cancellationRequested} active Runs have cancellation requested, not confirmed stopped. {receipt.revokedWorkerCredentials} issued worker credentials revoked; shared workers may need new credentials in other Projects. Previously delivered data or completed external effects cannot be withdrawn.</p>}
  </div>
}
