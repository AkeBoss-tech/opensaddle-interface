import type { AgentRunBlock, DiffFile, DiffHunk } from '../types'
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
  const next: AgentRunBlock = { ...run, plan: [...run.plan], tools: [...run.tools], artifacts: [...run.artifacts] }

  switch (event.type) {
    case 'session.created': {
      const mode = typeof event.payload.mode === 'string' ? event.payload.mode : 'session'
      next.statusText = `Session ready · ${mode.replace('_', ' ')}`
      break
    }
    case 'agent.started':
      next.statusText = 'Agent started'
      next.plan.push({ label: 'Agent started', status: 'active' })
      break
    case 'agent.output.delta': {
      const status = typeof event.payload.status === 'string' ? event.payload.status : null
      if (status) {
        next.statusText = status
        for (const step of next.plan) if (step.status === 'active') step.status = 'done'
        next.plan.push({ label: status, status: 'active' })
      }
      break
    }
    case 'diff.updated': {
      const files = Array.isArray(event.payload.files) ? event.payload.files as RawDiffFile[] : []
      if (files.length) {
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
      }
      break
    }
    case 'review.started':
      next.statusText = `Reviewing with ${typeof event.payload.provider === 'string' ? event.payload.provider : 'second agent'}`
      next.plan.push({ label: 'Independent review', status: 'active' })
      break
    case 'review.completed':
      next.statusText = 'Independent review completed'
      for (const step of next.plan) if (step.status === 'active') step.status = 'done'
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
      }
      break
    }
    case 'agent.completed':
      next.done = true
      next.statusText = 'Completed'
      for (const step of next.plan) if (step.status !== 'done') step.status = 'done'
      if (typeof event.payload.cost === 'string') next.cost = event.payload.cost
      break
    case 'agent.failed': {
      next.done = true
      const reason = typeof event.payload.reason === 'string' ? event.payload.reason : 'failed'
      next.statusText = `Failed · ${reason}`
      break
    }
    case 'session.closed':
      if (event.payload.status === 'completed') {
        next.done = true
        next.statusText = 'Completed'
        for (const step of next.plan) if (step.status !== 'done') step.status = 'done'
      }
      break
    default:
      break
  }
  return next
}
