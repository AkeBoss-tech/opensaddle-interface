/**
 * KRAIL session service — resumable interactive execution bridge.
 *
 * Owns PTY/session lifecycle, event sequencing, approvals, and (stubbed)
 * browser runtime hooks. OpenSaddle selects routes; KRAIL streams live sessions.
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
}

const sessions = new Map<string, Session>()

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
    note: 'Playwright profile isolation hooks in; desktop Electron hosts the preview surface.',
  })
  // Simulated observation loop for protocol completeness without requiring Playwright in CI.
  setTimeout(() => {
    pushEvent(session, 'browser.screenshot', { url, stub: true })
    pushEvent(session, 'agent.completed', { status: 'completed' })
    session.status = 'completed'
    pushEvent(session, 'session.closed', {})
  }, 800)
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
      return sendJson(res, 200, { ok: true, service: 'krail', sessions: sessions.size })
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
        const session = createSession('opensaddle')
        pushEvent(session, 'agent.started', { note: 'Attach OpenSaddle run via /attach' })
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
      return sendJson(res, 200, session.events)
    }

    return sendJson(res, 404, { error: 'not found' })
  })

  const wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const sessionId = url.searchParams.get('session_id')
    if (!sessionId || !sessions.has(sessionId)) {
      ws.close(1008, 'unknown session')
      return
    }
    const session = sessions.get(sessionId)!
    session.observers.add(ws)
    pushEvent(session, 'session.attached', { observers: session.observers.size })
    for (const event of session.events) ws.send(JSON.stringify(event))
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
