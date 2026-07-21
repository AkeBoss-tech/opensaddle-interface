/**
 * KRAIL session service — resumable interactive execution bridge.
 *
 * Owns PTY/session lifecycle, event sequencing, approvals, OpenSaddle run
 * bridging, and browser observation stubs.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'

export type KrailEventType =
  | 'session.created'
  | 'session.attached'
  | 'agent.started'
  | 'agent.output.delta'
  | 'agent.input.requested'
  | 'user.input.submitted'
  | 'tool.requested'
  | 'approval.requested'
  | 'approval.resolved'
  | 'file.changed'
  | 'diff.updated'
  | 'verification.started'
  | 'verification.completed'
  | 'agent.paused'
  | 'agent.resumed'
  | 'agent.completed'
  | 'agent.failed'
  | 'browser.started'
  | 'browser.screenshot'
  | 'session.closed'

export interface KrailEvent {
  event_id: string
  session_id: string
  run_id: string
  sequence: number
  timestamp: string
  type: KrailEventType
  payload: Record<string, unknown>
}

interface Session {
  id: string
  runId: string
  kind: 'pty' | 'browser' | 'opensaddle'
  status: 'running' | 'paused' | 'completed' | 'failed'
  events: KrailEvent[]
  observers: Set<WebSocket>
  child?: ChildProcessWithoutNullStreams
  command?: string
  cwd?: string
  opensaddleUrl?: string
}

const sessions = new Map<string, Session>()
const DEFAULT_OPENSADDLE = process.env.OPENSADDLE_URL ?? 'http://127.0.0.1:8765'

function pushEvent(session: Session, type: KrailEventType, payload: Record<string, unknown> = {}) {
  const event: KrailEvent = {
    event_id: `evt_${randomUUID().slice(0, 10)}`,
    session_id: session.id,
    run_id: session.runId,
    sequence: session.events.length,
    timestamp: new Date().toISOString(),
    type,
    payload,
  }
  session.events.push(event)
  const raw = JSON.stringify(event)
  for (const ws of session.observers) {
    if (ws.readyState === ws.OPEN) ws.send(raw)
  }
  return event
}

function createSession(kind: Session['kind'], command?: string, cwd?: string): Session {
  const session: Session = {
    id: `ses_${randomUUID().slice(0, 10)}`,
    runId: `run_${randomUUID().slice(0, 10)}`,
    kind,
    status: 'running',
    events: [],
    observers: new Set(),
    command,
    cwd,
  }
  sessions.set(session.id, session)
  pushEvent(session, 'session.created', { kind, command, cwd })
  return session
}

function startPtySession(command: string, cwd?: string, argv: string[] = []) {
  const session = createSession('pty', command, cwd)
  pushEvent(session, 'agent.started', { command, argv })
  try {
    const child = spawn(command, argv, {
      cwd: cwd || process.cwd(),
      env: process.env,
      shell: false,
    })
    session.child = child
    child.stdout.on('data', (buf: Buffer) => {
      pushEvent(session, 'agent.output.delta', { stream: 'stdout', text: buf.toString('utf8') })
    })
    child.stderr.on('data', (buf: Buffer) => {
      pushEvent(session, 'agent.output.delta', { stream: 'stderr', text: buf.toString('utf8') })
    })
    child.on('close', (code) => {
      session.status = code === 0 ? 'completed' : 'failed'
      pushEvent(session, code === 0 ? 'agent.completed' : 'agent.failed', { code })
      pushEvent(session, 'session.closed', {})
    })
  } catch (err) {
    session.status = 'failed'
    pushEvent(session, 'agent.failed', { error: String(err) })
    pushEvent(session, 'session.closed', {})
  }
  return session
}

function startBrowserSession(url = 'about:blank') {
  const session = createSession('browser')
  pushEvent(session, 'browser.started', {
    url,
    note: 'Isolated Chromium profile reserved for Electron WebContentsView / Playwright.',
  })
  setTimeout(() => {
    pushEvent(session, 'browser.screenshot', { url, stub: true, width: 1280, height: 800 })
    pushEvent(session, 'agent.completed', { status: 'completed' })
    session.status = 'completed'
    pushEvent(session, 'session.closed', {})
  }, 600)
  return session
}

async function bridgeOpenSaddle(input: {
  task: string
  repo?: string
  agentId?: string
  opensaddleUrl?: string
}) {
  const base = input.opensaddleUrl || DEFAULT_OPENSADDLE
  const session = createSession('opensaddle')
  session.opensaddleUrl = base
  pushEvent(session, 'agent.started', { task: input.task, repo: input.repo, bridge: base })

  try {
    const res = await fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: 'krail',
        task: input.task,
        repo: input.repo,
        agent_id: input.agentId ?? 'safe_local',
      }),
    })
    if (!res.ok) throw new Error(`opensaddle HTTP ${res.status}`)
    const data = await res.json() as { run_id: string; session_id: string; mode?: string }
    session.runId = data.run_id
    pushEvent(session, 'agent.output.delta', { status: `bridged ${data.mode ?? 'run'}`, opensaddle_run: data.run_id })

    // Poll events via SSE-ish JSON list by reading run status + replaying through EventSource polyfill
    const es = await fetch(`${base}/api/runs/${data.run_id}/events`)
    if (!es.ok || !es.body) throw new Error('events stream unavailable')
    const reader = es.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        try {
          const evt = JSON.parse(line.slice(6)) as { type: string; payload: Record<string, unknown> }
          const type = (evt.type as KrailEventType) || 'agent.output.delta'
          pushEvent(session, type, { ...evt.payload, bridged: true })
          if (type === 'agent.completed' || type === 'agent.failed' || type === 'session.closed') {
            if (type !== 'session.closed') session.status = type === 'agent.completed' ? 'completed' : 'failed'
          }
        } catch {
          // ignore parse errors
        }
      }
    }
    if (session.status === 'running') {
      session.status = 'completed'
      pushEvent(session, 'agent.completed', { status: 'completed' })
      pushEvent(session, 'session.closed', {})
    }
  } catch (err) {
    session.status = 'failed'
    pushEvent(session, 'agent.failed', { error: String(err) })
    pushEvent(session, 'session.closed', {})
  }
  return session
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  const raw = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(raw)
}

export function startKrailServer(port = 8787) {
  const server = createServer(async (req, res) => {
    if (!req.url || !req.method) return sendJson(res, 400, { error: 'bad request' })
    if (req.method === 'OPTIONS') return sendJson(res, 204, {})

    if (req.method === 'GET' && req.url === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'krail',
        sessions: sessions.size,
        opensaddle: DEFAULT_OPENSADDLE,
      })
    }

    if (req.method === 'GET' && req.url === '/sessions') {
      return sendJson(res, 200, [...sessions.values()].map((s) => ({
        id: s.id, runId: s.runId, kind: s.kind, status: s.status, events: s.events.length,
      })))
    }

    if (req.method === 'POST' && req.url === '/sessions') {
      const body = await readJson(req)
      const kind = (body.kind as Session['kind']) || 'pty'
      if (kind === 'browser') {
        const session = startBrowserSession(String(body.url ?? 'about:blank'))
        return sendJson(res, 200, { session_id: session.id, run_id: session.runId })
      }
      if (kind === 'opensaddle') {
        const session = await bridgeOpenSaddle({
          task: String(body.task ?? 'local coding task'),
          repo: body.repo ? String(body.repo) : undefined,
          agentId: body.agent_id ? String(body.agent_id) : undefined,
          opensaddleUrl: body.opensaddle_url ? String(body.opensaddle_url) : undefined,
        })
        return sendJson(res, 200, { session_id: session.id, run_id: session.runId })
      }
      const command = String(body.command ?? 'echo')
      const argv = Array.isArray(body.argv) ? body.argv.map(String) : ['krail-ready']
      const cwd = body.cwd ? String(body.cwd) : undefined
      const session = startPtySession(command, cwd, argv)
      return sendJson(res, 200, { session_id: session.id, run_id: session.runId })
    }

    const inputMatch = req.url.match(/^\/sessions\/([^/]+)\/input$/)
    if (req.method === 'POST' && inputMatch) {
      const session = sessions.get(inputMatch[1]!)
      if (!session) return sendJson(res, 404, { error: 'session not found' })
      const body = await readJson(req)
      const text = String(body.text ?? '')
      pushEvent(session, 'user.input.submitted', { text })
      session.child?.stdin.write(text)
      return sendJson(res, 200, { ok: true })
    }

    const cancelMatch = req.url.match(/^\/sessions\/([^/]+)\/cancel$/)
    if (req.method === 'POST' && cancelMatch) {
      const session = sessions.get(cancelMatch[1]!)
      if (!session) return sendJson(res, 404, { error: 'session not found' })
      session.child?.kill('SIGTERM')
      session.status = 'failed'
      pushEvent(session, 'agent.failed', { reason: 'cancelled' })
      pushEvent(session, 'session.closed', {})
      return sendJson(res, 200, { ok: true })
    }

    const eventsMatch = req.url.match(/^\/sessions\/([^/]+)\/events$/)
    if (req.method === 'GET' && eventsMatch) {
      const session = sessions.get(eventsMatch[1]!)
      if (!session) return sendJson(res, 404, { error: 'session not found' })
      const url = new URL(req.url, 'http://localhost')
      const after = Number(url.searchParams.get('after') ?? '-1')
      return sendJson(res, 200, session.events.filter((e) => e.sequence > after))
    }

    return sendJson(res, 404, { error: 'not found' })
  })

  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('session_id')
    const after = Number(url.searchParams.get('after') ?? '-1')
    if (!sessionId || !sessions.has(sessionId)) {
      ws.close(1008, 'unknown session')
      return
    }
    const session = sessions.get(sessionId)!
    session.observers.add(ws)
    pushEvent(session, 'session.attached', { observers: session.observers.size, after })
    for (const event of session.events) {
      if (event.sequence > after) ws.send(JSON.stringify(event))
    }
    ws.on('close', () => session.observers.delete(ws))
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as { type?: string; text?: string; rows?: number; cols?: number }
        if (msg.type === 'input' && msg.text) {
          pushEvent(session, 'user.input.submitted', { text: msg.text })
          session.child?.stdin.write(msg.text)
        }
        if (msg.type === 'resize') {
          pushEvent(session, 'agent.output.delta', { resize: { rows: msg.rows, cols: msg.cols } })
        }
      } catch {
        // ignore malformed
      }
    })
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`krail listening on http://127.0.0.1:${port}`)
  })

  return server
}

if (process.argv[1] && /krail.*server\.(ts|js)$/.test(process.argv[1].replace(/\\/g, '/'))) {
  startKrailServer(Number(process.env.KRAIL_PORT ?? 8787))
}
