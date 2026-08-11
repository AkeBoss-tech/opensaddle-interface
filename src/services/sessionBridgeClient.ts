import type { SessionEvent } from './contracts'

const DEFAULT_SESSION_BRIDGE = 'http://127.0.0.1:8787'

export class SessionBridgeClient {
  private baseUrl: string

  constructor(baseUrl = DEFAULT_SESSION_BRIDGE) {
    this.baseUrl = baseUrl
  }

  async healthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(800) })
      return res.ok
    } catch {
      return false
    }
  }

  async createSession(input: {
    kind?: 'pty' | 'browser' | 'opensaddle'
    command?: string
    argv?: string[]
    cwd?: string
    url?: string
    task?: string
    repo?: string
    agent_id?: string
  }): Promise<{ sessionId: string; runId: string } | null> {
    if (!(await this.healthy())) return null
    const res = await fetch(`${this.baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!res.ok) return null
    const data = await res.json() as { session_id: string; run_id: string }
    return { sessionId: data.session_id, runId: data.run_id }
  }

  async listSessions(): Promise<Array<{ id: string; runId: string; kind: string; status: string }>> {
    if (!(await this.healthy())) return []
    const res = await fetch(`${this.baseUrl}/sessions`)
    if (!res.ok) return []
    return await res.json() as Array<{ id: string; runId: string; kind: string; status: string }>
  }

  async eventsSince(sessionId: string, after = -1): Promise<SessionEvent[]> {
    if (!(await this.healthy())) return []
    const res = await fetch(`${this.baseUrl}/sessions/${sessionId}/events?after=${after}`)
    if (!res.ok) return []
    return await res.json() as SessionEvent[]
  }

  subscribe(sessionId: string, onEvent: (event: SessionEvent) => void, after = -1): () => void {
    let ws: WebSocket | null = null
    try {
      const url = this.baseUrl.replace('http', 'ws') + `/ws?session_id=${encodeURIComponent(sessionId)}&after=${after}`
      ws = new WebSocket(url)
      ws.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(String(msg.data)) as SessionEvent)
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    return () => ws?.close()
  }
}

/** @deprecated Import SessionBridgeClient from sessionBridgeClient. */
export const KrailClient = SessionBridgeClient
