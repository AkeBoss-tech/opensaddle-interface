import { useMemo, useState } from 'react'
import type { WorkspaceProposal, WorkspaceProposalItem } from '../../types'
import { StateBadge } from '../../ui'
import '../../styles/scaffold.css'

type ProposalGroup = 'channels' | 'members' | 'agents' | 'permissions'

const GROUPS: Array<{ key: ProposalGroup; label: string; empty: string }> = [
  { key: 'channels', label: 'Channels', empty: 'No folders or branches were found to propose as channels.' },
  { key: 'members', label: 'Members', empty: 'No members were proposed because git history was unreadable or contained no author identities.' },
  { key: 'agents', label: 'Agents', empty: 'No supported agent configuration was detected in this folder.' },
  { key: 'permissions', label: 'Permissions', empty: 'No capabilities were detected that need a project permission.' },
]

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function ScaffoldProposal({ proposal, onCreate, creating = false }: {
  proposal: WorkspaceProposal
  onCreate: (selectedIds: Set<string>) => void
  creating?: boolean
}) {
  const initialSelection = useMemo(() => new Set([
    ...proposal.channels, ...proposal.members, ...proposal.agents, ...proposal.permissions,
  ].filter((item) => item.recommended).map((item) => item.id)), [proposal])
  const [selectedIds, setSelectedIds] = useState(initialSelection)
  const selectedCounts = useMemo(() => Object.fromEntries(GROUPS.map(({ key }) => [
    key, proposal[key].filter((item) => selectedIds.has(item.id)).length,
  ])) as Record<ProposalGroup, number>, [proposal, selectedIds])
  const total = GROUPS.reduce((sum, { key }) => sum + selectedCounts[key], 0)
  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return <section className="scaffold-proposal" aria-labelledby="scaffold-proposal-title">
    <header className="scaffold-proposal__header">
      <span className="scaffold-proposal__eyebrow">Workspace proposal</span>
      <h2 id="scaffold-proposal-title">Review {proposal.label}</h2>
      <p>Choose what OpenSaddle should create for this local folder. Nothing is created until you continue.</p>
      <code>{proposal.folderPath}</code>
    </header>

    {proposal.notes.length > 0 && <aside className="scaffold-proposal__notes" aria-label="Scan notes">
      {proposal.notes.map((note) => <p key={note}>{note}</p>)}
    </aside>}

    <div className="scaffold-proposal__groups">
      {GROUPS.map(({ key, label, empty }) => {
        const items = proposal[key]
        return <section className="scaffold-group" key={key} aria-labelledby={`scaffold-${key}`}>
          <header className="scaffold-group__header">
            <div><h3 id={`scaffold-${key}`}>{label}</h3>
              {key === 'members' && <p className="scaffold-group__disclosure">{proposal.memberAnalysis.reason}</p>}
            </div>
            {items.length > 0 && <span>{countLabel(selectedCounts[key], label.toLowerCase())}</span>}
          </header>
          {items.length === 0 ? <p className="scaffold-group__empty">{empty}</p> : <div className="scaffold-group__rows">
            {items.map((item) => <ProposalRow key={item.id} item={item} checked={selectedIds.has(item.id)} onToggle={toggle} />)}
          </div>}
        </section>
      })}
    </div>

    <footer className="scaffold-proposal__footer">
      <p>{total
        ? [
          selectedCounts.channels && countLabel(selectedCounts.channels, 'channel'),
          selectedCounts.members && countLabel(selectedCounts.members, 'member'),
          selectedCounts.agents && countLabel(selectedCounts.agents, 'agent'),
          selectedCounts.permissions && countLabel(selectedCounts.permissions, 'permission'),
        ].filter(Boolean).join(', ')
        : 'Select at least one item to create.'}</p>
      <button className="primary-btn" disabled={!total || creating} onClick={() => onCreate(new Set(selectedIds))}>{creating ? 'Creating…' : 'Create workspace'}</button>
    </footer>
  </section>
}

function ProposalRow({ item, checked, onToggle }: { item: WorkspaceProposalItem; checked: boolean; onToggle: (id: string) => void }) {
  const needsApproval = (item as WorkspaceProposalItem & { needsApproval?: boolean }).needsApproval === true
  return <label className="scaffold-row">
    <input type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
    <span className="scaffold-row__copy"><strong>{item.label}</strong><small>{item.provenance}</small></span>
    {needsApproval && <StateBadge state="claimed" />}
  </label>
}
