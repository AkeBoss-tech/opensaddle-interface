import React, { useMemo, useState } from 'react'
import type { WorkspaceAgentProposal, WorkspaceChannelProposal, WorkspaceConnectorProposal, WorkspaceMemberProposal, WorkspacePermissionProposal, WorkspaceProposal, WorkspaceProposalItem } from '../../types'
import { StateBadge } from '../../ui/StateBadge'
import type { ProjectMemoryInitPlan, ProjectMemoryOperationStage } from '../../services/contracts'
import { MEMORY_PROPOSAL_ID } from '../memory/projectMemory'

type ProposalGroup = 'channels' | 'members' | 'agents' | 'connectors' | 'permissions'
type CustomProposalGroup = Exclude<ProposalGroup, 'connectors'>

const GROUPS: Array<{ key: ProposalGroup; label: string; empty: string }> = [
  { key: 'channels', label: 'Channels', empty: 'No folders or branches were found to propose as channels.' },
  { key: 'members', label: 'Members', empty: 'No members were proposed because git history was unreadable or contained no author identities.' },
  { key: 'agents', label: 'Agents', empty: 'No supported agent configuration was detected in this folder.' },
  { key: 'connectors', label: 'Connectors', empty: 'No connectors were detected from repository evidence.' },
  { key: 'permissions', label: 'Permissions', empty: 'No capabilities were detected that need a project permission.' },
]

type CustomItem = WorkspaceChannelProposal | WorkspaceMemberProposal | WorkspaceAgentProposal | WorkspacePermissionProposal

function customId(group: CustomProposalGroup) {
  return `custom-${group}-${Math.random().toString(36).slice(2, 9)}`
}

function newCustomItem(group: CustomProposalGroup): CustomItem {
  const id = customId(group)
  const shared = { id, label: '', provenance: 'Added by you', recommended: true, custom: true as const }
  switch (group) {
    case 'channels': return { ...shared, kind: 'custom' }
    case 'members': return { ...shared, name: '', email: '', commitCount: 0, deselectable: true }
    case 'agents': return { ...shared, harness: 'opensaddle', triggerPath: '' }
    case 'permissions': return { ...shared, scope: '', needsApproval: true }
  }
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

export function ScaffoldProposal({ proposal, onCreate, onBack, creating = false, memory }: {
  proposal: WorkspaceProposal
  onCreate: (selectedIds: Set<string>) => void
  onBack?: () => void
  creating?: boolean
  memory?: {
    loading: boolean
    plan?: ProjectMemoryInitPlan | null
    error?: string | null
    stage?: ProjectMemoryOperationStage | null
    onRetry?: () => void
  }
}) {
  const offersMemory = memory !== undefined
  const initialSelection = useMemo(() => new Set([
    ...proposal.channels, ...proposal.members, ...proposal.agents, ...proposal.permissions,
  ].filter((item) => item.recommended).map((item) => item.id).concat(
    proposal.connectors.filter((connector) => connector.status === 'detected' && connector.recommended).flatMap((connector) => connector.scopes.map((scope) => scope.id)),
    ...(offersMemory ? [MEMORY_PROPOSAL_ID] : []),
  )), [offersMemory, proposal])
  const [selectedIds, setSelectedIds] = useState(initialSelection)
  const [customItems, setCustomItems] = useState<Record<CustomProposalGroup, CustomItem[]>>({ channels: [], members: [], agents: [], permissions: [] })
  const reviewProposal = useMemo(() => ({
    ...proposal,
    channels: [...proposal.channels, ...(customItems.channels as WorkspaceChannelProposal[])],
    members: [...proposal.members, ...(customItems.members as WorkspaceMemberProposal[])],
    agents: [...proposal.agents, ...(customItems.agents as WorkspaceAgentProposal[])],
    connectors: proposal.connectors,
    permissions: [...proposal.permissions, ...(customItems.permissions as WorkspacePermissionProposal[])],
  }), [customItems, proposal])
  const selectedCounts = useMemo(() => Object.fromEntries(GROUPS.map(({ key }) => [key,
    key === 'connectors'
      ? reviewProposal.connectors.filter((connector) => connector.scopes.some((scope) => selectedIds.has(scope.id))).length
      : reviewProposal[key].filter((item) => selectedIds.has(item.id)).length,
  ])) as Record<ProposalGroup, number>, [reviewProposal, selectedIds])
  const memorySelected = Boolean(memory && selectedIds.has(MEMORY_PROPOSAL_ID))
  const total = GROUPS.reduce((sum, { key }) => sum + selectedCounts[key], 0) + (memorySelected ? 1 : 0)
  const hasInvalidSelectedCustom = GROUPS.some(({ key }) => reviewProposal[key].some((item) =>
    selectedIds.has(item.id) && item.custom && !isCompleteCustomItem(item)))
  const memoryBlocked = memorySelected && (memory?.loading || Boolean(memory?.error) || !memory?.plan || (!memory.plan.canApply && memory.plan.state !== 'already_configured'))
  const toggle = (id: string) => setSelectedIds((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const addCustom = (group: CustomProposalGroup) => {
    const item = newCustomItem(group)
    setCustomItems((current) => ({ ...current, [group]: [...current[group], item] }))
    setSelectedIds((current) => new Set([...current, item.id]))
  }
  const updateCustom = (group: CustomProposalGroup, id: string, patch: Partial<CustomItem>) => setCustomItems((current) => ({
    ...current,
    [group]: current[group].map((item) => item.id === id ? { ...item, ...patch } as CustomItem : item),
  }))

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
        const items = reviewProposal[key]
        return <section className="scaffold-group" key={key} aria-labelledby={`scaffold-${key}`}>
          <header className="scaffold-group__header">
            <div><h3 id={`scaffold-${key}`}>{label}</h3>
              {key === 'members' && <p className="scaffold-group__disclosure">{proposal.memberAnalysis.reason}</p>}
            </div>
            <div className="scaffold-group__actions">
              {items.length > 0 && <span>{countLabel(selectedCounts[key], label.toLowerCase())}</span>}
              {key !== 'connectors' && <button type="button" className="scaffold-group__add" onClick={() => addCustom(key)}>Add {label.slice(0, -1)}</button>}
            </div>
          </header>
          {items.length === 0 ? <p className="scaffold-group__empty">{empty}</p> : <div className="scaffold-group__rows">
            {key === 'connectors'
              ? (items as WorkspaceConnectorProposal[]).map((connector) => <ConnectorRow key={connector.id} connector={connector} selectedIds={selectedIds} onToggle={toggle} />)
              : (items as CustomItem[]).map((item) => <ProposalRow key={item.id} item={item} checked={selectedIds.has(item.id)} onToggle={toggle}>
              {item.custom && <CustomItemFields item={item} group={key as CustomProposalGroup} onChange={(patch) => updateCustom(key as CustomProposalGroup, item.id, patch)} />}
            </ProposalRow>)}
          </div>}
        </section>
      })}
      {memory && <section className="scaffold-group" aria-labelledby="scaffold-memory">
        <header className="scaffold-group__header"><div><h3 id="scaffold-memory">Project Memory</h3><p className="scaffold-group__disclosure">Managed by the OpenSaddle backend; the browser stores only this status projection.</p></div></header>
        <div className="scaffold-group__rows"><div className="scaffold-row">
          <input aria-label="Select Project Memory" type="checkbox" checked={memorySelected} disabled={memory.loading || memory.plan?.state === 'already_configured'} onChange={() => toggle(MEMORY_PROPOSAL_ID)} />
          <span className="scaffold-row__copy"><strong>{memory.plan?.state === 'already_configured' ? 'Existing Project Memory' : 'Enable Project Memory'}</strong>
            <small>{memory.loading ? 'Inspecting authoritative memory state…' : memory.error ? memory.error : memory.plan?.summary ?? 'Project Memory planning is unavailable.'}</small>
            {memory.plan?.effects.length ? <ul>{memory.plan.effects.map((effect) => <li key={effect.id}><code>{effect.kind}</code> {effect.target} — {effect.description}</li>)}</ul> : null}
            {memory.plan?.warnings.map((warning) => <small key={warning}>Warning: {warning}</small>)}
            {memory.stage && <small role={memory.stage === 'failed' ? 'alert' : 'status'}>Setup: registering → initializing memory → indexing → ready · current: {memory.stage.replaceAll('_', ' ')}</small>}
          </span>
          {memory.error && memory.onRetry && <button className="tiny-btn" type="button" onClick={memory.onRetry}>Retry preview</button>}
          <StateBadge state={memory.error ? 'blocked' : memory.plan?.state === 'already_configured' ? 'done' : 'actionable'} />
        </div></div>
      </section>}
    </div>

    <footer className="scaffold-proposal__footer">
      <p>{total
        ? [
          selectedCounts.channels && countLabel(selectedCounts.channels, 'channel'),
          selectedCounts.members && countLabel(selectedCounts.members, 'member'),
          selectedCounts.agents && countLabel(selectedCounts.agents, 'agent'),
          selectedCounts.connectors && countLabel(selectedCounts.connectors, 'connector'),
          selectedCounts.permissions && countLabel(selectedCounts.permissions, 'permission'),
          memorySelected && 'Project Memory',
        ].filter(Boolean).join(', ')
        : 'Select at least one item to create.'}</p>
      <span className="scaffold-proposal__footer-actions">
        {onBack && <button className="secondary-btn" disabled={creating} onClick={onBack}>Back</button>}
        <button className="primary-btn" disabled={!total || hasInvalidSelectedCustom || memoryBlocked || creating} onClick={() => onCreate(new Set(selectedIds))}>{creating ? 'Creating…' : 'Create workspace'}</button>
      </span>
    </footer>
  </section>
}

function isCompleteCustomItem(item: WorkspaceProposalItem) {
  if (!item.label.trim()) return false
  if ('email' in item) {
    const member = item as WorkspaceMemberProposal
    if (!member.name.trim() || !member.email.trim()) return false
  }
  return !('scope' in item) || Boolean((item as WorkspacePermissionProposal).scope.trim())
}

function ProposalRow({ item, checked, onToggle, children }: { item: WorkspaceProposalItem; checked: boolean; onToggle: (id: string) => void; children?: React.ReactNode }) {
  const needsApproval = (item as WorkspaceProposalItem & { needsApproval?: boolean }).needsApproval === true
  return <div className={`scaffold-row${item.custom ? ' scaffold-row--custom' : ''}`}>
    <input aria-label={`Select ${item.label || 'new item'}`} type="checkbox" checked={checked} onChange={() => onToggle(item.id)} />
    <span className="scaffold-row__copy"><strong>{item.label || 'New item'}</strong><small>{item.provenance}</small>{children}</span>
    {needsApproval && <StateBadge state="claimed" />}
  </div>
}

function ConnectorRow({ connector, selectedIds, onToggle }: { connector: WorkspaceConnectorProposal; selectedIds: Set<string>; onToggle: (id: string) => void }) {
  const unconfigured = connector.status === 'unconfigured'
  return <div className={`scaffold-connector scaffold-connector--${connector.status}`}>
    <span className="scaffold-connector__copy"><strong>{connector.label}</strong><small>{connector.provenance}</small><StateBadge state={unconfigured ? 'blocked' : 'actionable'} /></span>
    {connector.scopes.length > 0 && <div className="scaffold-connector__scopes">
      {connector.scopes.map((scope) => <label className="scaffold-connector__scope" key={scope.id}>
        <input aria-label={`Select ${connector.label}: ${scope.name}`} type="checkbox" checked={selectedIds.has(scope.id)} onChange={() => onToggle(scope.id)} disabled={unconfigured} />
        <span><strong>{scope.name}</strong><small>{scope.description}</small></span>
        {scope.needsApproval && <StateBadge state="claimed" />}
      </label>)}
    </div>}
  </div>
}

function CustomItemFields({ item, group, onChange }: { item: CustomItem; group: CustomProposalGroup; onChange: (patch: Partial<CustomItem>) => void }) {
  return <span className="scaffold-custom-fields">
    <input aria-label={`${group} name`} placeholder={group === 'permissions' ? 'Permission label' : `${group.slice(0, -1)} name`} value={item.label} onChange={(event) => {
      const label = event.target.value
      onChange(group === 'members' ? { label, name: label } as Partial<CustomItem> : { label })
    }} />
    {group === 'members' && <input aria-label="Member email" type="email" placeholder="email@example.com" value={(item as WorkspaceMemberProposal).email} onChange={(event) => onChange({ email: event.target.value })} />}
    {group === 'permissions' && <input aria-label="Permission scope" placeholder="e.g. publish-content" value={(item as WorkspacePermissionProposal).scope} onChange={(event) => onChange({ scope: event.target.value })} />}
  </span>
}
