import type { AppData } from '../types'
import type { WorkspaceClient } from './contracts'

export class RemoteWorkspaceClient implements WorkspaceClient {
  private readonly baseUrl: string
  private readonly getUserId: () => string
  private readonly token?: string
  private saveChain: Promise<void> = Promise.resolve()

  constructor(baseUrl: string, getUserId: () => string, token?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.getUserId = getUserId
    this.token = token
  }

  private headers(json = false): Record<string, string> {
    return {
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      'X-OpenSaddle-User': this.getUserId(),
    }
  }

  private async error(response: Response): Promise<Error> {
    const body = await response.json().catch(() => null) as {
      error?: string
      message?: string
    } | null
    return new Error(body?.message ?? body?.error ?? `OpenSaddle HTTP ${response.status}`)
  }

  async load(): Promise<AppData | null> {
    const response = await fetch(`${this.baseUrl}/api/workspace`, {
      headers: this.headers(),
    })
    if (response.status === 404) return null
    if (!response.ok) throw await this.error(response)
    const body = await response.json() as { workspace: AppData }
    return body.workspace
  }

  async save(workspace: AppData): Promise<{ updatedAt: number; documents: number }> {
    const snapshot = structuredClone(workspace)
    let result: { updatedAt: number; documents: number } | undefined
    const operation = this.saveChain.then(async () => {
      const response = await fetch(`${this.baseUrl}/api/workspace`, {
        method: 'PUT',
        headers: this.headers(true),
        body: JSON.stringify({ workspace: snapshot }),
      })
      if (!response.ok) throw await this.error(response)
      const body = await response.json() as { updatedAt: number; documents: number }
      result = { updatedAt: body.updatedAt, documents: body.documents }
    })
    this.saveChain = operation.catch(() => undefined)
    await operation
    if (!result) throw new Error('Workspace save completed without metadata')
    return result
  }
}
