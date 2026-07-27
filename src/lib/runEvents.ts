import type { AgentActivityEntry, AgentRunBlock, DiffFile, DiffHunk } from '../types'
import type { SessionEvent } from '../services/contracts'

interface RawDiffFile {
  path: string
  add?: number
  del?: number
  patch?: string
}

interface RawCheck {
  name: string
  ok: boolean
  duration?: string
}

/** Parse a unified diff patch into display hunks for the diff viewer. */
function parsePatch(path: string, patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = []
  let current: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
      oldLine = m ? Number(m[1]) : 0
      newLine = m ? Number(m[2]) : 0
      current = { id: `${path}-h${hunks.length}`, range: line, lines: [] }
      hunks.push(current)
      continue
    }
    if (!current) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') || line.startsWith('index ')) continue
    if (line.startsWith('+')) {
      current.lines.push({ t: 'add', n: String(newLine++), c: line.slice(1) })
    } else if (line.startsWith('-')) {
      current.lines.push({ t: 'del', n: String(oldLine++), c: line.slice(1) })
    } else {
      current.lines.push({ t: 'ctx', n: String(newLine), c: line.startsWith(' ') ? line.slice(1) : line })
      oldLine++
      newLine++
    }
  }
  return hunks
}

function toDiffFiles(files: RawDiffFile[]): DiffFile[] {
  return files.map((f) => {
    const hunks = f.patch ? parsePatch(f.path, f.patch) : []
    const add = f.add || hunks.reduce((n, h) => n + h.lines.filter((l) => l.t === 'add').length, 0)
    const del = f.del || hunks.reduce((n, h) => n + h.lines.filter((l) => l.t === 'del').length, 0)
    return { path: f.path, add, del, hunks }
  })
}

/**
 * Folds live session events from a real runtime into the AgentRunBlock the
 * chat UI renders, so real runs get the same card as simulated ones.
 */
export function applyRunEvent(run: AgentRunBlock, event: SessionEvent): AgentRunBlock {
  const next: AgentRunBlock = {
    ...run,
    lastSequence: Math.max(run.lastSequence ?? -1, event.sequence),
    plan: [...run.plan],
    tools: [...run.tools],
    artifacts: [...run.artifacts],
    activity: [...(run.activity ?? [])],
    sources: [...(run.sources ?? [])],
  }
  const addActivity = (
    kind: AgentActivityEntry['kind'],
    label: string,
    detail?: string,
  ) => {
    if (next.activity?.some((item) => item.id === event.event_id)) return
    next.activity = [...(next.activity ?? []), {
      id: event.event_id,
      kind,
      label,
      detail,
      timestamp: event.timestamp,
    }].slice(-80)
  }
  const addSource = (id: string, label: string, detail?: string) => {
    if (next.sources?.some((source) => source.id === id)) return
    next.sources = [...(next.sources ?? []), { id, kind: 'file' as const, label, detail }].slice(-50)
  }

  switch (event.type) {
    case 'session.created': {
      const mode = typeof event.payload.mode === 'string' ? event.payload.mode : 'session'
      next.statusText = `Session ready · ${mode.replace('_', ' ')}`
      addActivity('status', 'Session ready', mode.replace('_', ' '))
      break
    }
    case 'agent.started':
      next.statusText = 'Agent started'
      next.plan.push({ label: 'Agent started', status: 'active' })
      addActivity('status', 'Agent started', typeof event.payload.provider === 'string' ? event.payload.provider : undefined)
      break
    case 'agent.output.delta': {
      const status = typeof event.payload.status === 'string' ? event.payload.status : null
      if (status) {
        next.statusText = status
        const current = [...next.plan].reverse().find((step) => step.status === 'active')
        if (current?.label !== status) {
          for (const step of next.plan) if (step.status === 'active') step.status = 'done'
          if (next.plan.at(-1)?.label !== status) next.plan.push({ label: status, status: 'active' })
        }
        addActivity('status', status)
      }
      break
    }
    case 'tool.requested': {
      const tool = typeof event.payload.tool === 'string' ? event.payload.tool : 'Tool'
      next.statusText = `Running ${tool}`
      addActivity('tool', tool, 'Started')
      break
    }
    case 'tool.completed': {
      const tool = typeof event.payload.tool === 'string'
        ? event.payload.tool
        : event.payload.tool && typeof event.payload.tool === 'object' && 'name' in event.payload.tool
          ? String(event.payload.tool.name)
          : 'Tool'
      addActivity('tool', tool, 'Completed')
      break
    }
    case 'command.started': {
      const item = event.payload.item
      const command = item && typeof item === 'object' && 'command' in item
        ? String(item.command)
        : 'Command'
      next.statusText = `Running ${command}`
      addActivity('tool', command, 'Command started')
      break
    }
    case 'command.output.delta':
      addActivity('tool', 'Command output', typeof event.payload.delta === 'string' ? event.payload.delta.slice(-240) : undefined)
      break
    case 'command.completed':
      addActivity('tool', 'Command completed')
      break
    case 'file.change.updated': {
      const item = event.payload.item
      const path = item && typeof item === 'object' && 'path' in item ? String(item.path) : undefined
      if (path) addSource(`file:${path}`, path, 'Changed by this run')
      addActivity('change', path ? `Changed ${path}` : 'File change updated')
      break
    }
    case 'plan.updated': {
      const plan = Array.isArray(event.payload.plan) ? event.payload.plan : []
      if (plan.length) {
        next.plan = plan.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const row = item as Record<string, unknown>
          return [{
            label: typeof row.step === 'string' ? row.step : typeof row.label === 'string' ? row.label : 'Plan step',
            status: row.status === 'completed' ? 'done' as const : row.status === 'inProgress' ? 'active' as const : 'pending' as const,
          }]
        })
      }
      addActivity('status', 'Plan updated')
      break
    }
    case 'usage.updated':
      addActivity('status', 'Context usage updated')
      break
    case 'input.requested':
      next.statusText = 'Waiting for your answer'
      next.inputRequest = {
        kind: 'clarification',
        prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'The agent needs input to continue.',
      }
      addActivity('status', 'Agent requested input', next.inputRequest.prompt)
      break
    case 'warning':
      addActivity('error', 'Runtime warning', typeof event.payload.message === 'string' ? event.payload.message : undefined)
      break
    case 'approval.requested':
      next.statusText = 'Waiting for approval'
      next.inputRequest = {
        kind: 'approval',
        prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'This run needs approval before it can continue.',
      }
      addActivity('status', 'Approval requested')
      break
    case 'approval.resolved':
      next.inputRequest = undefined
      next.statusText = event.payload.allowed === false ? 'Approval denied' : 'Approval granted'
      addActivity('status', next.statusText)
      break
    case 'agent.input.requested':
      next.statusText = 'Waiting for your answer'
      next.inputRequest = {
        kind: 'clarification',
        prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'The agent needs more information to continue.',
      }
      addActivity('status', 'Agent asked a question', next.inputRequest.prompt)
      break
    case 'user.input.submitted':
      next.inputRequest = undefined
      next.statusText = 'Continuing'
      addActivity('status', 'Answer submitted')
      break
    case 'agent.paused':
      next.statusText = 'Paused'
      addActivity('status', 'Agent paused')
      break
    case 'agent.resumed':
      next.statusText = 'Resumed'
      addActivity('status', 'Agent resumed')
      break
    case 'diff.updated': {
      const files = Array.isArray(event.payload.files) ? event.payload.files as RawDiffFile[] : []
      if (files.length) {
        for (const file of files) addSource(`file:${file.path}`, file.path, 'Changed by this run')
        const diff = toDiffFiles(files)
        const existing = next.artifacts.findIndex((a) => a.type === 'diff')
        const artifact = {
          id: `art-diff-${event.run_id}`,
          type: 'diff' as const,
          title: `Changes · ${diff.length} file${diff.length === 1 ? '' : 's'}`,
          subtitle: `+${diff.reduce((n, f) => n + f.add, 0)} −${diff.reduce((n, f) => n + f.del, 0)}`,
          diff,
        }
        if (existing >= 0) next.artifacts[existing] = artifact
        else next.artifacts.push(artifact)
        next.statusText = 'Diff ready'
        addActivity('change', artifact.title, artifact.subtitle)
      }
      break
    }
    case 'file.changed': {
      const path = typeof event.payload.path === 'string' ? event.payload.path : ''
      if (path) addSource(`file:${path}`, path, 'Read or changed by this run')
      break
    }
    case 'review.started':
      next.statusText = `Reviewing with ${typeof event.payload.provider === 'string' ? event.payload.provider : 'second agent'}`
      next.plan.push({ label: 'Independent review', status: 'active' })
      addActivity('review', 'Independent review started', typeof event.payload.provider === 'string' ? event.payload.provider : undefined)
      break
    case 'review.completed':
      next.statusText = 'Independent review completed'
      for (const step of next.plan) if (step.status === 'active') step.status = 'done'
      addActivity('review', 'Independent review completed', typeof event.payload.provider === 'string' ? event.payload.provider : undefined)
      break
    case 'review.failed':
      next.statusText = `Review unavailable · ${typeof event.payload.provider === 'string' ? event.payload.provider : 'reviewer'}`
      for (const step of next.plan) if (step.status === 'active') step.status = 'done'
      addActivity('error', 'Independent review unavailable', typeof event.payload.error === 'string' ? event.payload.error : undefined)
      break
    case 'verification.started':
      next.statusText = 'Running verification'
      addActivity('check', 'Verification started')
      break
    case 'verification.completed': {
      const checks = Array.isArray(event.payload.checks) ? event.payload.checks as RawCheck[] : []
      if (checks.length) {
        const existing = next.artifacts.findIndex((a) => a.id === `art-verify-${event.run_id}`)
        const artifact = {
          id: `art-verify-${event.run_id}`,
          type: 'table' as const,
          title: 'Verification',
          subtitle: checks.every((c) => c.ok) ? 'All checks passed' : 'Some checks failed',
          table: {
            headers: ['Check', 'Result', 'Duration'],
            rows: checks.map((c) => [c.name, c.ok ? 'pass' : 'fail', c.duration ?? '—']),
          },
        }
        if (existing >= 0) next.artifacts[existing] = artifact
        else next.artifacts.push(artifact)
        addActivity('check', 'Verification completed', artifact.subtitle)
      }
      break
    }
    case 'agent.completed':
      next.done = true
      next.inputRequest = undefined
      next.statusText = 'Completed'
      for (const step of next.plan) if (step.status !== 'done') step.status = 'done'
      if (typeof event.payload.cost === 'string') next.cost = event.payload.cost
      addActivity('status', 'Agent completed')
      break
    case 'agent.failed': {
      next.done = true
      next.inputRequest = undefined
      const reason = typeof event.payload.reason === 'string'
        ? event.payload.reason
        : typeof event.payload.error === 'string' ? event.payload.error : 'failed'
      next.statusText = `Failed · ${reason}`
      addActivity('error', 'Agent failed', reason)
      break
    }
    case 'session.closed':
      if (event.payload.status === 'completed') {
        next.done = true
        next.statusText = 'Completed'
        for (const step of next.plan) if (step.status !== 'done') step.status = 'done'
      }
      addActivity(event.payload.status === 'failed' ? 'error' : 'status', 'Session closed', typeof event.payload.status === 'string' ? event.payload.status : undefined)
      break
    default:
      break
  }
  return next
}
