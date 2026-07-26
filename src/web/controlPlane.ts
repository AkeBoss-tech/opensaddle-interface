import type { AppData, PermissionGrant, RuntimeKind } from '../types'

export interface ControlPlaneHealth { ok: boolean; service: string; mode: 'local' | 'company'; runtime_provider: string; configured_models: string[]; model_provider: string; storage?: { engine?: string; workspace_documents?: number } }
export interface ControlPlaneRuntime { id: string; kind: string; status: 'provisioning' | 'running' | 'stopped' | 'failed'; projectId: string; ownerId: string; createdAt: number; expiresAt: number }
export interface ServerWorkspace { workspace: AppData; updatedAt?: number; documents?: number; storage?: string }
export interface WebAccount { id: string; name?: string; mode: string; roles?: string[] }
export interface WebConnection { baseUrl: string; sessionToken?: string }
export interface WebRun { run_id: string; session_id: string; project_id: string; agent_id?: string; status: string; route: { runtimeKey: RuntimeKind; harnessKey: string; providerKey: string; modelKey: string }; created_at: number; updated_at: number; error?: string; dispatch_target?: 'cloud' | 'local_worker'; worker_id?: string }
export interface WebApproval { id: string; projectId: string; agentId?: string; action: string; status: 'pending' | 'approved' | 'denied' | 'consumed' }
export interface WorkspaceSnapshot { health: ControlPlaneHealth; workspace: ServerWorkspace; runtimes: ControlPlaneRuntime[]; account: WebAccount; runs: WebRun[]; permissions: PermissionGrant[]; approvals: WebApproval[] }

function headers(connection: WebConnection): HeadersInit { return connection.sessionToken ? { 'X-OpenSaddle-Session': connection.sessionToken } : {} }
async function responseError(response: Response): Promise<Error> { const body = await response.json().catch(() => null) as { error?: string; message?: string } | null; return new Error(body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`) }
async function request<T>(connection: WebConnection, path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const response = await fetch(`${connection.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers: { ...(authenticated ? headers(connection) : {}), ...(init.headers ?? {}) }, signal: AbortSignal.timeout(8_000) })
  if (!response.ok) throw await responseError(response)
  return response.json() as Promise<T>
}

export async function signIn(baseUrl: string, input: { userId: string; displayName: string }): Promise<{ connection: WebConnection; account: WebAccount }> {
  const data = await request<{ token: string; account: WebAccount }>({ baseUrl }, '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: input.userId, display_name: input.displayName }) }, false)
  return { connection: { baseUrl: baseUrl.replace(/\/$/, ''), sessionToken: data.token }, account: data.account }
}
export async function signOut(connection: WebConnection): Promise<void> { await request(connection, '/api/session', { method: 'DELETE' }) }

/** All browser pages read the same authoritative snapshot as the Electron renderer. */
export async function loadWorkspaceSnapshot(connection: WebConnection): Promise<WorkspaceSnapshot> {
  const health = await request<ControlPlaneHealth>(connection, '/api/health', {}, false)
  const [account, workspace, runtimes, runs, permissions, approvals] = await Promise.all([
    request<{ account: WebAccount }>(connection, '/api/session'), request<ServerWorkspace>(connection, '/api/workspace'), request<ControlPlaneRuntime[]>(connection, '/api/runtimes'), request<WebRun[]>(connection, '/api/runs'), request<PermissionGrant[]>(connection, '/api/permissions'), request<WebApproval[]>(connection, '/api/approvals'),
  ])
  return { health, workspace, runtimes, account: account.account, runs, permissions, approvals }
}
export async function registerBrowserWorker(connection: WebConnection): Promise<{ id: string; status: string }> {
  const key = 'opensaddle-web-worker-id'
  const id = sessionStorage.getItem(key) ?? `web_${crypto.randomUUID()}`
  sessionStorage.setItem(key, id)
  return request(connection, '/api/runtime/workers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, kind: 'browser-sandbox', capabilities: ['browser-safe-agent-dispatch', 'javascript', 'in-memory-files'] }) })
}
export async function dispatches(connection: WebConnection, workerId: string): Promise<Array<{ run_id: string; project_id: string; agent_id?: string; task: string }>> { return request(connection, `/api/runtime/workers/${encodeURIComponent(workerId)}/dispatches`) }
export async function completeDispatch(connection: WebConnection, workerId: string, runId: string, summary: string, success = true): Promise<void> { await request(connection, `/api/runtime/workers/${encodeURIComponent(workerId)}/dispatches/${encodeURIComponent(runId)}/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary, success }) }) }
export async function startRun(connection: WebConnection, input: { projectId: string; agentId?: string; task: string; dispatchTarget: 'cloud' | 'local_worker'; approvalId?: string }): Promise<{ run_id: string; dispatch_target?: string; worker_id?: string }> { return request(connection, '/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: input.projectId, agent_id: input.agentId, task: input.task, dispatch_target: input.dispatchTarget, approval_id: input.approvalId, runtime_key: input.dispatchTarget === 'cloud' ? 'sandbox' : undefined }) }) }
export async function approveRun(connection: WebConnection, input: { projectId: string; agentId?: string; action: string }): Promise<string> { const pending = await request<WebApproval>(connection, '/api/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: input.projectId, agent_id: input.agentId, action: input.action }) }); const resolved = await request<WebApproval>(connection, `/api/approvals/${encodeURIComponent(pending.id)}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allow: true }) }); return resolved.id }
