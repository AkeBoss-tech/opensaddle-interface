import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/common/Icon'
import { useStore } from '../data/store'
import { evaluatePermissions } from '../services/permissions'
import type { CapabilityAction, PrincipalKind, ResourceKind } from '../types'

const ACTIONS: CapabilityAction[] = ['read', 'write', 'execute', 'administer']

export function PermissionsPage() {
  const { projectId } = useParams()
  const nav = useNavigate()
  const { data, upsertPermissionGrant, revokePermissionGrant, attachSource, toast, services } = useStore()
  const project = data.projects.find((p) => p.id === (projectId ?? data.activeProjectId)) ?? data.projects[0]!
  const [principalKind, setPrincipalKind] = useState<PrincipalKind>('user')
  const [principalId, setPrincipalId] = useState(data.currentUserId)
  const [resourceKind, setResourceKind] = useState<ResourceKind>('project')
  const [resourceId, setResourceId] = useState(project.id)
  const [action, setAction] = useState<CapabilityAction>('read')
  const [effect, setEffect] = useState<'allow' | 'deny'>('allow')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [pathPrefix, setPathPrefix] = useState('')
  const [checkAgent, setCheckAgent] = useState(data.agents[0]?.id ?? '')

  const grants = useMemo(
    () => data.permissionGrants.filter((g) =>
      g.resourceId === project.id
      || g.resourceKind === 'organization'
      || data.folders.some((f) => f.projectId === project.id && f.id === g.resourceId)
      || data.sources.some((s) => s.projectId === project.id && s.id === g.resourceId)
      || g.resourceKind === 'tool'
      || data.workflows.some((w) => w.projectId === project.id && w.id === g.resourceId),
    ),
    [data, project.id],
  )

  const sources = data.sources.filter((s) => s.projectId === project.id)
  const folders = data.folders.filter((f) => f.projectId === project.id)

  const effective = evaluatePermissions(data.permissionGrants, {
    userId: data.currentUserId,
    agentId: checkAgent || undefined,
    resourceKind: 'project',
    resourceId: project.id,
    action: 'execute',
  })

  const principals = principalKind === 'user'
    ? data.members.map((m) => ({ id: m.id, label: m.name }))
    : data.agents.map((a) => ({ id: a.id, label: a.name }))

  return (
    <div className="content-page">
      <div className="page-header">
        <div className="page-header-copy">
          <div className="eyebrow">Governance</div>
          <h1>Permissions</h1>
          <p>User and agent grants for projects, folders, repositories, tools, and workflows. Deny wins; execution requires intersection.</p>
        </div>
        <div className="page-header-actions">
          <select value={project.id} onChange={(e) => {
            setResourceId(e.target.value)
            nav(`/permissions/${e.target.value}`)
          }} aria-label="Project">
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="wiki-workflow-banner">
        <div className="wiki-workflow-icon"><Icon name="shield" /></div>
        <div>
          <strong>{project.name} · effective execute</strong>
          <p>{effective.reason}{effective.approvalRequired ? ' · writes need approval' : ''}</p>
        </div>
        <select value={checkAgent} onChange={(e) => setCheckAgent(e.target.value)} aria-label="Agent for check">
          <option value="">User only</option>
          {data.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <span className={`status-pill ${effective.allowed ? 'green' : 'red'}`}>{effective.allowed ? 'Allowed' : 'Denied'}</span>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-header"><div><h3>Grant matrix</h3></div></div>
          <div className="card-body">
            <table className="task-table">
              <thead>
                <tr><th>Principal</th><th>Resource</th><th>Action</th><th>Effect</th><th></th></tr>
              </thead>
              <tbody>
                {grants.map((g) => {
                  const principal = g.principalKind === 'user'
                    ? data.members.find((m) => m.id === g.principalId)?.name
                    : data.agents.find((a) => a.id === g.principalId)?.name
                  return (
                    <tr key={g.id}>
                      <td>{g.principalKind}:{principal ?? g.principalId}</td>
                      <td>
                        {g.resourceKind}/{g.resourceId}{g.pathPrefix ? ` · ${g.pathPrefix}` : ''}
                        {g.scope ? ` · ${g.scope}${g.scopeId ? `:${g.scopeId}` : ''}` : ''}
                      </td>
                      <td>{g.action}{g.approvalRequired ? ' · approve' : ''}</td>
                      <td><span className={`status-pill ${g.consumedAt ? '' : g.effect === 'allow' ? 'green' : 'red'}`}>{g.consumedAt ? `${g.effect} · consumed` : g.effect}</span></td>
                      <td><button className="tiny-btn" onClick={() => {
                        void revokePermissionGrant(g.id)
                          .then(() => toast('Revoked', g.id))
                          .catch((error: unknown) => toast('Revoke failed', error instanceof Error ? error.message : String(error)))
                      }}>Revoke</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div><h3>Create grant</h3></div></div>
          <div className="card-body">
            <div className="form-row"><label>Principal kind</label>
              <select value={principalKind} onChange={(e) => {
                const kind = e.target.value as PrincipalKind
                setPrincipalKind(kind)
                setPrincipalId(kind === 'user' ? data.currentUserId : (data.agents[0]?.id ?? ''))
              }}>
                <option value="user">User</option>
                <option value="agent">Agent</option>
              </select>
            </div>
            <div className="form-row"><label>Principal</label>
              <select value={principalId} onChange={(e) => setPrincipalId(e.target.value)}>
                {principals.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="form-row"><label>Resource kind</label>
              <select value={resourceKind} onChange={(e) => {
                const kind = e.target.value as ResourceKind
                setResourceKind(kind)
                if (kind === 'project') setResourceId(project.id)
                if (kind === 'folder') setResourceId(folders[0]?.id ?? '')
                if (kind === 'repository') setResourceId(sources.find((s) => s.kind === 'github')?.id ?? '')
                if (kind === 'tool') setResourceId('github')
                if (kind === 'workflow') setResourceId(data.workflows.find((w) => w.projectId === project.id)?.id ?? '')
              }}>
                <option value="project">Project</option>
                <option value="folder">Folder</option>
                <option value="repository">Repository</option>
                <option value="tool">Tool</option>
                <option value="workflow">Workflow</option>
              </select>
            </div>
            <div className="form-row"><label>Resource</label>
              <select value={resourceId} onChange={(e) => setResourceId(e.target.value)}>
                {resourceKind === 'project' && data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                {resourceKind === 'folder' && folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
                {resourceKind === 'repository' && sources.filter((s) => s.kind === 'github').map((s) => <option key={s.id} value={s.id}>{s.externalId}</option>)}
                {resourceKind === 'tool' && ['github', 'jira', 'slack', 'salesforce'].map((t) => <option key={t} value={t}>{t}</option>)}
                {resourceKind === 'workflow' && data.workflows.filter((w) => w.projectId === project.id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="form-row"><label>Action</label>
              <select value={action} onChange={(e) => setAction(e.target.value)}>{ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
            </div>
            <div className="form-row"><label>Effect</label>
              <select value={effect} onChange={(e) => setEffect(e.target.value as 'allow' | 'deny')}>
                <option value="allow">allow</option>
                <option value="deny">deny</option>
              </select>
            </div>
            <div className="form-row"><label>Path prefix (optional)</label><input value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} placeholder="ops/secrets" /></div>
            <div className="setting-row"><div className="setting-copy"><strong>Approval required</strong></div>
              <button className={`switch ${approvalRequired ? 'on' : ''}`} onClick={() => setApprovalRequired((v) => !v)} />
            </div>
            <button className="primary-btn" onClick={() => {
              void upsertPermissionGrant({
                principalKind, principalId, resourceKind, resourceId, action, effect,
                approvalRequired, pathPrefix: pathPrefix || undefined, createdBy: data.currentUserId, inheritance: 'direct',
              })
                .then(() => toast('Grant saved', `${principalKind}:${principalId} → ${effect} ${action}`))
                .catch((error: unknown) => toast('Grant failed', error instanceof Error ? error.message : String(error)))
            }}>Save grant</button>
          </div>
        </div>

        <div className="card">
          <div className="card-header"><div><h3>Folders</h3></div></div>
          <div className="card-body row-list">
            {folders.map((f) => (
              <div className="row-item" key={f.id}>
                <div className="row-icon"><Icon name="folder" className="icon sm" /></div>
                <div className="row-copy"><div className="row-title">{f.name}</div><div className="row-sub">{f.path} · {f.description}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div><h3>Sources</h3><p>GitHub and other connectors</p></div>
            <button className="tiny-btn right" onClick={async () => {
              if (!services?.tools) return
              try {
                await services.tools.connect('github')
                const manifests = await services.tools.list()
                const github = manifests.find((tool) => tool.id === 'github')
                const listAction = github?.actions.find((action) => action.id.endsWith('repos.list'))?.id ?? 'repos.list'
                const repos = await services.tools.call({
                  toolId: 'github', action: listAction, args: {}, projectId: project.id, userId: data.currentUserId, agentId: checkAgent || undefined,
                })
                if (repos.ok && Array.isArray(repos.data)) {
                  const first = (repos.data as Array<{ full_name: string }>)[0]
                  if (first) {
                    attachSource({
                      projectId: project.id, kind: 'github', name: first.full_name.split('/')[1] ?? first.full_name,
                      externalId: first.full_name, url: `https://github.com/${first.full_name}`, status: 'connected', branch: 'main',
                    })
                    toast('Repository attached', first.full_name)
                  }
                } else {
                  toast('GitHub unavailable', repos.error ?? 'No repositories were returned.')
                }
              } catch (error) {
                toast('GitHub setup required', error instanceof Error ? error.message : String(error))
              }
            }}>Connect GitHub</button>
          </div>
          <div className="card-body row-list">
            {sources.map((s) => (
              <div className="row-item" key={s.id}>
                <div className="row-icon">
                  {s.kind === 'github' ? <img className="plugin-logo" src={`${import.meta.env.BASE_URL}assets/github.svg`} alt="" /> : <Icon name="db" className="icon sm" />}
                </div>
                <div className="row-copy">
                  <div className="row-title">{s.name}</div>
                  <div className="row-sub">{s.externalId}{s.branch ? ` · ${s.branch}` : ''}</div>
                </div>
                <span className="status-pill green">{s.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
