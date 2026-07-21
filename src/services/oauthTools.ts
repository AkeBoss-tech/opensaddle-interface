import type { PermissionGrant, ToolCallRequest, ToolCallResult, ToolClient, ToolManifest } from './contracts'
import { evaluatePermissions } from './permissions'

const TOOLS_KEY = 'opensaddle-oauth-tools-v1'

const DEFAULT_TOOLS: ToolManifest[] = [
  {
    id: 'github',
    name: 'GitHub',
    provider: 'GitHub',
    description: 'Repositories, issues, pull requests via OAuth PKCE (brokered).',
    scopes: ['repo', 'read:org'],
    actions: [
      { id: 'repos.list', label: 'List repositories', write: false },
      { id: 'issues.list', label: 'List issues', write: false },
      { id: 'issues.create', label: 'Create issue', write: true },
      { id: 'prs.list', label: 'List pull requests', write: false },
    ],
    connected: false,
  },
  {
    id: 'jira',
    name: 'Jira',
    provider: 'Atlassian',
    description: 'Read issues and create drafts with audit trails.',
    scopes: ['read:jira-work', 'write:jira-work'],
    actions: [
      { id: 'issues.search', label: 'Search issues', write: false },
      { id: 'issues.create', label: 'Create issue draft', write: true },
    ],
    connected: false,
  },
  {
    id: 'slack',
    name: 'Slack',
    provider: 'Slack',
    description: 'Search channels; posting requires approval.',
    scopes: ['channels:history', 'chat:write'],
    actions: [
      { id: 'search', label: 'Search messages', write: false },
      { id: 'post', label: 'Post message', write: true },
    ],
    connected: false,
  },
]

type Stored = { tools: ToolManifest[]; pendingApprovals: Record<string, ToolCallRequest> }

function load(): Stored {
  try {
    const raw = localStorage.getItem(TOOLS_KEY)
    if (raw) return JSON.parse(raw) as Stored
  } catch { /* ignore */ }
  return { tools: structuredClone(DEFAULT_TOOLS), pendingApprovals: {} }
}

function save(data: Stored) {
  localStorage.setItem(TOOLS_KEY, JSON.stringify(data))
}

/**
 * Mock OAuth tool broker for browser demo.
 * Real deployments exchange PKCE codes server-side; refresh tokens never enter the browser.
 */
export class MockOAuthToolClient implements ToolClient {
  private getGrants: () => PermissionGrant[]
  private currentUserId: string

  constructor(getGrants: () => PermissionGrant[], currentUserId: string) {
    this.getGrants = getGrants
    this.currentUserId = currentUserId
  }

  async list(): Promise<ToolManifest[]> {
    return load().tools
  }

  async connect(toolId: string): Promise<{ authUrl: string } | { connected: true }> {
    // Simulate PKCE redirect; in demo we immediately complete.
    const data = load()
    const tool = data.tools.find((t) => t.id === toolId)
    if (!tool) throw new Error('Unknown tool')
    tool.connected = true
    tool.accountLabel = toolId === 'github' ? 'AkeBoss-tech' : `${tool.provider} demo`
    save(data)
    return { connected: true }
  }

  async disconnect(toolId: string): Promise<void> {
    const data = load()
    const tool = data.tools.find((t) => t.id === toolId)
    if (tool) {
      tool.connected = false
      tool.accountLabel = undefined
      save(data)
    }
  }

  async call(req: ToolCallRequest): Promise<ToolCallResult> {
    const data = load()
    const tool = data.tools.find((t) => t.id === req.toolId)
    if (!tool) return { ok: false, error: 'Unknown tool' }
    if (!tool.connected) return { ok: false, error: 'Tool not connected. Complete OAuth first.' }

    const action = tool.actions.find((a) => a.id === req.action)
    if (!action) return { ok: false, error: 'Unknown action' }

    const check = evaluatePermissions(this.getGrants(), {
      userId: req.userId || this.currentUserId,
      agentId: req.agentId,
      resourceKind: 'tool',
      resourceId: req.toolId,
      action: action.write ? 'write' : 'read',
    })

    if (!check.allowed) return { ok: false, error: check.reason }

    if (action.write && check.approvalRequired) {
      const approvalId = `appr-${Math.random().toString(36).slice(2, 8)}`
      data.pendingApprovals[approvalId] = req
      save(data)
      return { ok: false, requiresApproval: true, approvalId, error: 'Write requires approval' }
    }

    return this.execute(tool, req)
  }

  async resolveApproval(approvalId: string, allow: boolean): Promise<void> {
    const data = load()
    const req = data.pendingApprovals[approvalId]
    delete data.pendingApprovals[approvalId]
    save(data)
    if (!allow || !req) return
    // Caller should re-invoke call after lowering approval flag if needed.
  }

  private execute(tool: ToolManifest, req: ToolCallRequest): ToolCallResult {
    if (tool.id === 'github' && req.action === 'repos.list') {
      return {
        ok: true,
        data: [
          { full_name: 'AkeBoss-tech/opensaddle', private: true, default_branch: 'main' },
          { full_name: 'AkeBoss-tech/opensaddle-interface', private: false, default_branch: 'main' },
          { full_name: 'AkeBoss-tech/scarlet-sync', private: true, default_branch: 'main' },
        ],
      }
    }
    if (tool.id === 'github' && req.action === 'issues.list') {
      return {
        ok: true,
        data: [
          { number: 42, title: 'Secure VM background feature', state: 'open' },
          { number: 38, title: 'Permission gateway inheritance', state: 'open' },
        ],
      }
    }
    if (tool.id === 'jira' && req.action === 'issues.search') {
      return {
        ok: true,
        data: [
          { key: 'ENG-1204', summary: 'Runtime approval path', status: 'In Progress' },
          { key: 'ENG-1198', summary: 'API ownership decision', status: 'Blocked' },
        ],
      }
    }
    if (tool.id === 'slack' && req.action === 'search') {
      return { ok: true, data: [{ channel: '#engineering', text: 'VM provision PR ready for review', ts: Date.now() }] }
    }
    return { ok: true, data: { simulated: true, tool: tool.id, action: req.action, args: req.args } }
  }
}
