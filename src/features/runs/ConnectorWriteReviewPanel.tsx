import React, { useCallback, useEffect, useRef, useState } from 'react'
void React
import type { ConnectorWriteProposal, ConnectorWriteReviewClient, ConnectorWriteSnapshot } from '../../services/connectorWriteReview'

function stateCopy(proposal: ConnectorWriteProposal): string {
  switch (proposal.state) {
    case 'proposed': return Date.parse(proposal.expiresAt) <= Date.now() ? 'Expired. Core will reject approval.' : 'Awaiting a human decision. No write has been authorized.'
    case 'approved': return 'Approved for this exact request. The agent must separately dispatch it.'
    case 'dispatching': return 'Dispatch reserved. The external effect may already have occurred.'
    case 'effect_unknown': return 'External outcome unknown. Do not assume the effect failed or retry it.'
    case 'completed': return 'Core recorded a completed connector dispatch. Inspect the receipt and external system to verify the effect.'
  }
}

export function ConnectorWriteReviewPanel({ client, projectId, runId }: { client: ConnectorWriteReviewClient; projectId: string; runId: string }) {
  const [snapshot, setSnapshot] = useState<ConnectorWriteSnapshot>()
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [approving, setApproving] = useState<string>()
  const generation = useRef(0)
  const controller = useRef<AbortController | undefined>(undefined)
  const previouslyReviewed = useRef<ConnectorWriteProposal[]>([])
  const invalidate = useCallback(() => { generation.current++ }, [])
  const refresh = useCallback(async () => {
    controller.current?.abort()
    const active = new AbortController(), serial = ++generation.current
    controller.current = active
    setLoading(true); setError(undefined); setSnapshot(undefined)
    try {
      const value = await client.discover(projectId, runId, active.signal, previouslyReviewed.current)
      if (!active.signal.aborted && serial === generation.current) { previouslyReviewed.current = value.proposals; setSnapshot(value) }
    } catch (reason) {
      if (!active.signal.aborted && serial === generation.current) { previouslyReviewed.current = []; setError(reason instanceof Error ? reason.message : String(reason)) }
    } finally { if (serial === generation.current) setLoading(false) }
  }, [client, projectId, runId])
  useEffect(() => {
    previouslyReviewed.current = []
    void refresh()
    const initial = controller.current
    return () => { invalidate(); initial?.abort() }
  }, [refresh, invalidate])
  const approve = async (proposal: ConnectorWriteProposal) => {
    if (approving) return
    setApproving(proposal.proposalId); setError(undefined)
    try {
      const current = await client.approve(proposal)
      previouslyReviewed.current = previouslyReviewed.current.map(item => item.proposalId === current.proposalId ? current : item)
      setSnapshot(previous => previous && { ...previous, proposals: previous.proposals.map(item => item.proposalId === current.proposalId ? current : item) })
    } catch (reason) {
      // A lost POST acknowledgement is ambiguous. Fetch again; never post a second time automatically.
      setError(`Approval outcome not confirmed: ${reason instanceof Error ? reason.message : String(reason)}. Refresh before deciding what to do next.`)
      previouslyReviewed.current = []; setSnapshot(undefined)
    } finally { setApproving(undefined) }
  }
  return <section className="cc-panel" aria-label="Connector write review">
    <h2>Connector write requests</h2>
    <p>Review the exact requested action and arguments before approving. Approval authorizes this one request; the agent controls dispatch. An external effect cannot be undone here.</p>
    <button className="secondary-btn" disabled={loading || Boolean(approving)} onClick={() => void refresh()}>Check write requests</button>
    {loading && <p role="status">Checking current Core write requests and review authority…</p>}
    {error && <p role="alert">Write review unavailable: {error}</p>}
    {snapshot && <>
      <p role="status">{snapshot.complete ? 'Current reviewable requests and any previously opened request rechecked with Core.' : 'Core returned the newest 50 reviewable requests; older requests are omitted.'}</p>
      {snapshot.proposals.length === 0 && <p>No current connector write requests are reviewable by this account.</p>}
      {snapshot.proposals.map(proposal => <article key={proposal.proposalId} className="cc-panel">
        <h3>{proposal.connector} / {proposal.action}</h3>
        <p>Requested by agent <code>{proposal.agentId}</code> on behalf of <code>{proposal.onBehalfOf}</code>.</p>
        <p>State: <strong>{proposal.state}</strong> · {stateCopy(proposal)}</p>
        <p>Approval expires: {proposal.expiresAt}</p>
        <p>Exact request SHA-256: <code>{proposal.requestDigest}</code></p>
        <details open={proposal.state === 'proposed'}><summary>Exact arguments</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '20rem', overflow: 'auto' }}>{JSON.stringify(proposal.arguments, null, 2)}</pre></details>
        {proposal.approvedBy && <p>Approved by {proposal.approvedBy}</p>}
        {proposal.state === 'proposed' && Date.parse(proposal.expiresAt) > Date.now() && <button disabled={Boolean(approving)} onClick={() => void approve(proposal)}>{approving === proposal.proposalId ? 'Checking exact request…' : 'Approve exact write'}</button>}
      </article>)}
    </>}
  </section>
}
