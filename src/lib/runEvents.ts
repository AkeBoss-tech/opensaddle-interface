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

interface VerificationCheck {
  name: string
  ok: boolean
  duration: string
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function compactValue(value: unknown, limit = 20_000): string {
  if (typeof value === 'string') return value.slice(0, limit)
  if (value === undefined || value === null) return ''
  try {
    return JSON.stringify(value, null, 2).slice(0, limit)
  } catch {
    return String(value).slice(0, limit)
  }
}

function finiteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return undefined
}

function runUsage(payload: SessionEvent['payload']): NonNullable<AgentRunBlock['usage']> | undefined {
  const tokenUsage = objectRecord(payload.tokenUsage)
  const total = objectRecord(tokenUsage.total)
  const usage = objectRecord(payload.usage)
  const stats = objectRecord(payload.stats)
  const inputTokens = finiteNumber(total.inputTokens, usage.input_tokens, usage.inputTokens, stats.input_tokens, stats.inputTokens)
  const cachedInputTokens = finiteNumber(
    total.cachedInputTokens,
    usage.cache_read_input_tokens,
    usage.cached_input_tokens,
    usage.cachedInputTokens,
    stats.cached_input_tokens,
  )
  const outputTokens = finiteNumber(total.outputTokens, usage.output_tokens, usage.outputTokens, stats.output_tokens, stats.outputTokens)
  const reasoningTokens = finiteNumber(
    total.reasoningOutputTokens,
    usage.reasoning_tokens,
    usage.reasoningTokens,
    stats.reasoning_tokens,
  )
  const totalTokens = finiteNumber(
    total.totalTokens,
    payload.used,
    usage.total_tokens,
    usage.totalTokens,
    stats.total_tokens,
    stats.totalTokens,
  ) ?? (inputTokens !== undefined || outputTokens !== undefined
    ? (inputTokens ?? 0) + (outputTokens ?? 0)
    : undefined)
  const contextWindow = finiteNumber(
    tokenUsage.modelContextWindow,
    payload.size,
    usage.context_window,
    usage.contextWindow,
    stats.context_window,
  )
  if (totalTokens === undefined && inputTokens === undefined && outputTokens === undefined && contextWindow === undefined) {
    return undefined
  }
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    contextWindow,
    contextPercent: totalTokens !== undefined && contextWindow
      ? Math.min(100, Math.round(totalTokens / contextWindow * 1_000) / 10)
      : undefined,
  }
}

function toolIdentity(event: SessionEvent): string | undefined {
  const payload = event.payload
  const item = objectRecord(payload.item)
  const candidate = payload.tool_id
    ?? payload.item_id
    ?? payload.itemId
    ?? item.id
    ?? item.tool_use_id
    ?? item.toolUseId
    ?? item.call_id
  return typeof candidate === 'string' && candidate ? candidate : undefined
}

function toolName(event: SessionEvent, fallback: string): string {
  const payload = event.payload
  const item = objectRecord(payload.item)
  const tool = payload.tool
  if (typeof tool === 'string' && tool) return tool
  if (tool && typeof tool === 'object' && !Array.isArray(tool)) {
    const named = objectRecord(tool).name
    if (typeof named === 'string' && named) return named
  }
  for (const candidate of [item.name, item.type, item.tool_name]) {
    if (typeof candidate === 'string' && candidate) return candidate
  }
  return fallback
}

function toolInput(event: SessionEvent): string {
  const payload = event.payload
  const item = objectRecord(payload.item)
  const value = payload.command
    ?? payload.args
    ?? payload.input
    ?? item.command
    ?? item.input
    ?? item.arguments
  return compactValue(value)
}

function commandName(event: SessionEvent): string {
  const payload = event.payload
  const item = objectRecord(payload.item)
  const candidates = [
    payload,
    item,
    objectRecord(payload.args),
    objectRecord(payload.input),
    objectRecord(item.input),
  ]
  for (const candidate of candidates) {
    if (typeof candidate.command === 'string' && candidate.command) return candidate.command
  }
  const toolCall = objectRecord(item.tool_call)
  for (const value of Object.values(toolCall)) {
    const row = objectRecord(value)
    if (typeof row.command === 'string' && row.command) return row.command
    const args = objectRecord(row.args)
    if (typeof args.command === 'string' && args.command) return args.command
  }
  return toolName(event, 'Command')
}

function displayCommand(command: string): string {
  const shellWrapped = command.match(/^(?:\/(?:usr\/)?bin\/)?(?:ba|z|)sh\s+-lc\s+(['"])([\s\S]*)\1$/i)
  return (shellWrapped?.[2] ?? command).trim().replace(/\s+/g, ' ').slice(0, 120)
}

function verificationLabel(command: string): string | undefined {
  const normalized = displayCommand(command)
  if (!normalized || /^(?:echo|printf)\b/i.test(normalized)) return undefined

  const packageScript = /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?((?:test|typecheck|type-check|check:types|lint|build)(?::[\w-]+)?)\b/i.exec(normalized)?.[1]
  let category: string | undefined
  if (packageScript?.startsWith('test')) category = 'Tests'
  else if (packageScript && /^(?:typecheck|type-check|check:types)/i.test(packageScript)) category = 'Typecheck'
  else if (packageScript?.startsWith('lint')) category = 'Lint'
  else if (packageScript?.startsWith('build')) category = 'Build'
  else if (/\b(?:vitest|jest|pytest|go\s+test|cargo\s+test|rspec|mix\s+test|dotnet\s+test)\b/i.test(normalized)) category = 'Tests'
  else if (/\b(?:tsc(?:\s+--noEmit|\s+-b)|pyright|mypy)\b/i.test(normalized)) category = 'Typecheck'
  else if (/\b(?:eslint|oxlint|ruff\s+check|cargo\s+clippy|golangci-lint)\b/i.test(normalized)) category = 'Lint'
  else if (/\b(?:cargo\s+check|dotnet\s+build)\b/i.test(normalized)) category = 'Build'

  return category ? `${category} · ${normalized}` : undefined
}

function commandFailed(event: SessionEvent): boolean {
  const payload = event.payload
  const item = objectRecord(payload.item)
  return payload.status === 'failed'
    || payload.status === 'error'
    || item.status === 'failed'
    || item.status === 'error'
    || payload.ok === false
    || typeof payload.exit_code === 'number' && payload.exit_code !== 0
    || typeof payload.exitCode === 'number' && payload.exitCode !== 0
    || typeof item.exit_code === 'number' && item.exit_code !== 0
    || typeof item.exitCode === 'number' && item.exitCode !== 0
    || Boolean(payload.error)
}

function commandDuration(event: SessionEvent): string {
  const payload = event.payload
  const item = objectRecord(payload.item)
  if (typeof payload.duration === 'string') return payload.duration
  const durationMs = finiteNumber(payload.duration_ms, payload.durationMs, item.duration_ms, item.durationMs)
  return durationMs === undefined ? '—' : `${durationMs}ms`
}

function mergeVerificationChecks(run: AgentRunBlock, runId: string, checks: VerificationCheck[]): void {
  if (!checks.length) return
  const id = `art-verify-${runId}`
  const existing = run.artifacts.findIndex((artifact) => artifact.id === id)
  const previousRows = existing >= 0 ? run.artifacts[existing]?.table?.rows ?? [] : []
  const rows = [...previousRows]
  for (const check of checks) {
    const row = [check.name, check.ok ? 'pass' : 'fail', check.duration]
    const rowIndex = rows.findIndex((candidate) => candidate[0] === check.name)
    if (rowIndex >= 0) rows[rowIndex] = row
    else rows.push(row)
  }
  const artifact = {
    id,
    type: 'table' as const,
    title: 'Verification',
    subtitle: rows.every((row) => row[1]?.toLowerCase() === 'pass') ? 'All checks passed' : 'Some checks failed',
    table: {
      headers: ['Check', 'Result', 'Duration'],
      rows,
    },
  }
  if (existing >= 0) run.artifacts[existing] = artifact
  else run.artifacts.push(artifact)
}

function eventFilePaths(event: SessionEvent): string[] {
  const paths = new Set<string>()
  const pathKey = /^(?:path|file_path|filePath|filename|fileName|target_path|targetPath)$/
  const visit = (value: unknown, depth: number, key?: string) => {
    if (depth > 5 || value === null || value === undefined) return
    if (typeof value === 'string') {
      if (key && pathKey.test(key)) {
        const path = value.trim()
        if (path && path.length <= 2_000 && !/^https?:\/\//i.test(path)) paths.add(path)
      }
      return
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) visit(item, depth + 1)
      return
    }
    if (typeof value !== 'object') return
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      visit(child, depth + 1, childKey)
    }
  }
  visit(event.payload.path, 0, 'path')
  visit(event.payload.item, 0)
  visit(event.payload.args, 0)
  visit(event.payload.input, 0)
  visit(event.payload.changes, 0)
  visit(event.payload.files, 0)
  return [...paths].slice(0, 100)
}

function toolOutput(event: SessionEvent): string {
  const payload = event.payload
  const item = objectRecord(payload.item)
  return compactValue(
    payload.output
    ?? payload.preview
    ?? payload.error
    ?? item.output
    ?? item.aggregatedOutput
    ?? item.content
    ?? item.error,
  )
}

function inlineToolActivity(name: string): boolean {
  return ![
    'userMessage',
    'agentMessage',
    'mcpServer/startupStatus/updated',
    'runtime.provision',
    'cli.spawn',
    'finish',
  ].includes(name)
}

function runFailure(event: SessionEvent, harness: string): NonNullable<AgentRunBlock['failure']> {
  const raw = typeof event.payload.error === 'string'
    ? event.payload.error
    : typeof event.payload.reason === 'string' ? event.payload.reason : 'The harness stopped before completing the run.'
  const message = raw.trim().slice(0, 2_000) || 'The harness stopped before completing the run.'
  const normalized = message.toLowerCase()
  if (/auth|log[ -]?in|sign[ -]?in|credential|api[ _-]?key|unauthorized|\\b401\\b|\\b403\\b/.test(normalized)) {
    return {
      kind: 'authentication',
      title: `${harness} needs sign-in`,
      message,
      recovery: `Sign in to ${harness}, refresh harness availability, then retry this run.`,
      retryable: true,
    }
  }
  if (/permission|denied|approval|sandbox|not allowed|read[ -]?only|policy/.test(normalized)) {
    return {
      kind: 'permission',
      title: 'Project permissions blocked the run',
      message,
      recovery: 'Review this local project’s agent access preset, then retry only with the permissions you intend to grant.',
      retryable: true,
    }
  }
  if (/enoent|executable|command not found|not installed|harness.+(?:missing|unavailable)|spawn.+not found/.test(normalized)) {
    return {
      kind: 'harness',
      title: `${harness} is unavailable`,
      message,
      recovery: 'Install or select an available local harness, refresh its status, then retry.',
      retryable: true,
    }
  }
  if (/context.+(?:length|window)|token.+limit|maximum context|too many tokens/.test(normalized)) {
    return {
      kind: 'context',
      title: 'The model context is full',
      message,
      recovery: 'Start a fresh task with the essential context or choose a model with a larger context window.',
      retryable: false,
    }
  }
  if (/cancel|stopp?ed|restart|interrupt|disconnect|closed|signal|timed? out|timeout/.test(normalized)) {
    return {
      kind: 'interrupted',
      title: 'The run was interrupted',
      message,
      recovery: 'Retry from the saved checkpoint. OpenSaddle will preserve this run and link the retry.',
      retryable: true,
    }
  }
  return {
    kind: 'runtime',
    title: `${harness} could not finish`,
    message,
    recovery: 'Review the last command or tool output, adjust the task if needed, then retry from this checkpoint.',
    retryable: true,
  }
}

function findToolIndex(run: AgentRunBlock, event: SessionEvent, name: string, icon?: string): number {
  const identity = toolIdentity(event)
  if (identity) {
    const exact = run.tools.findIndex((tool) => tool.id === `tool-${identity}`)
    if (exact >= 0) return exact
  }
  for (let index = run.tools.length - 1; index >= 0; index -= 1) {
    const tool = run.tools[index]!
    if (tool.status === 'running' && (!icon || tool.icon === icon) && (tool.name === name || name === 'Tool' || name === 'Command')) {
      return index
    }
  }
  return -1
}

function startTool(run: AgentRunBlock, event: SessionEvent, name: string, icon: string): void {
  const identity = toolIdentity(event)
  const existing = findToolIndex(run, event, name, icon)
  const tool = {
    id: identity ? `tool-${identity}` : `tool-${event.event_id}`,
    name,
    icon,
    input: toolInput(event),
    output: '',
    duration: '',
    cost: 'running',
    status: 'running' as const,
  }
  if (existing >= 0) run.tools[existing] = { ...run.tools[existing]!, ...tool }
  else run.tools.push(tool)
  run.tools = run.tools.slice(-50)
}

function completeTool(run: AgentRunBlock, event: SessionEvent, name: string, icon: string): void {
  const index = findToolIndex(run, event, name, icon)
  const failed = commandFailed(event)
  const output = toolOutput(event)
  const eventDuration = commandDuration(event)
  const duration = eventDuration === '—' ? '' : eventDuration
  if (index >= 0) {
    const previous = run.tools[index]!
    run.tools[index] = {
      ...previous,
      name: previous.name === 'Tool' || previous.name === 'Command' ? name : previous.name,
      input: previous.input || toolInput(event),
      output: output || previous.output,
      duration: duration || previous.duration,
      cost: failed ? 'failed' : 'complete',
      status: failed ? 'error' : 'success',
    }
    return
  }
  const identity = toolIdentity(event)
  run.tools.push({
    id: identity ? `tool-${identity}` : `tool-${event.event_id}`,
    name,
    icon,
    input: toolInput(event),
    output,
    duration,
    cost: failed ? 'failed' : 'complete',
    status: failed ? 'error' : 'success',
  })
  run.tools = run.tools.slice(-50)
}

function interactionQuestions(value: unknown): NonNullable<AgentRunBlock['inputRequest']>['questions'] {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return []
    const row = candidate as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.prompt !== 'string') return []
    const options = Array.isArray(row.options) ? row.options.flatMap((candidateOption) => {
      if (!candidateOption || typeof candidateOption !== 'object' || Array.isArray(candidateOption)) return []
      const option = candidateOption as Record<string, unknown>
      return typeof option.label === 'string'
        ? [{ label: option.label, description: typeof option.description === 'string' ? option.description : undefined }]
        : []
    }) : undefined
    return [{
      id: row.id,
      header: typeof row.header === 'string' ? row.header : undefined,
      prompt: row.prompt,
      options,
      allowOther: row.allowOther === true,
      secret: row.secret === true,
    }]
  })
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

function diffHunkIdentity(path: string, hunk: DiffHunk): string {
  const lines = [...hunk.lines]
  while (lines.at(-1)?.t === 'ctx' && lines.at(-1)?.c === '') lines.pop()
  return `${path}\n${hunk.range}\n${lines.map((line) => `${line.t}:${line.c}`).join('\n')}`
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
    warnings: [...(run.warnings ?? [])],
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
      const executionMode = typeof event.payload.execution_mode === 'string'
        ? event.payload.execution_mode
        : undefined
      if (executionMode === 'plan' || executionMode === 'review' || executionMode === 'project' || executionMode === 'full-access') {
        next.executionMode = executionMode
      }
      const route = event.payload.route
      if (route && typeof route === 'object' && !Array.isArray(route)) {
        const cost = (route as Record<string, unknown>).cost
        const providerKey = (route as Record<string, unknown>).providerKey
        if (typeof cost === 'string') next.cost = cost
        if (typeof providerKey === 'string') next.providerKey = providerKey as AgentRunBlock['providerKey']
      }
      const detail = executionMode
        ? `${executionMode.replaceAll('-', ' ')} · ${mode.replace('_', ' ')}`
        : mode.replace('_', ' ')
      next.statusText = `Session ready · ${detail}`
      addActivity('status', 'Session ready', detail)
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
      const tool = toolName(event, 'Tool')
      if (!inlineToolActivity(tool)) break
      next.statusText = `Running ${tool}`
      startTool(next, event, tool, 'tools')
      addActivity('tool', tool, 'Started')
      break
    }
    case 'tool.completed': {
      const tool = toolName(event, 'Tool')
      if (tool === 'codex.thread.fork') {
        next.statusText = 'Codex thread forked'
        if (typeof event.payload.thread_id === 'string') next.providerSessionId = event.payload.thread_id
        next.providerSessionMode = 'resume'
        addActivity('status', 'Codex thread forked', typeof event.payload.thread_id === 'string' ? event.payload.thread_id : undefined)
      } else if (tool === 'codex.thread.resume') {
        next.statusText = 'Codex thread resumed'
        if (typeof event.payload.thread_id === 'string') next.providerSessionId = event.payload.thread_id
        next.providerSessionMode = 'resume'
        addActivity('status', 'Codex thread resumed', typeof event.payload.thread_id === 'string' ? event.payload.thread_id : undefined)
      } else if (tool === 'codex.thread.start') {
        if (typeof event.payload.thread_id === 'string') next.providerSessionId = event.payload.thread_id
        next.providerSessionMode = 'resume'
        addActivity('status', 'Codex thread linked', typeof event.payload.thread_id === 'string' ? event.payload.thread_id : undefined)
      } else if (tool === 'codex.turn.completed') {
        if (typeof event.payload.turn_id === 'string') next.providerTurnId = event.payload.turn_id
        addActivity('status', 'Codex checkpoint saved', typeof event.payload.turn_id === 'string' ? event.payload.turn_id : undefined)
      } else if (tool === 'claude.session.resume') {
        next.statusText = 'Claude session resumed'
        if (typeof event.payload.session_id === 'string') next.providerSessionId = event.payload.session_id
        next.providerSessionMode = 'resume'
        addActivity('status', 'Claude session resumed', typeof event.payload.session_id === 'string' ? event.payload.session_id : undefined)
      } else if (tool === 'claude.session') {
        if (typeof event.payload.session_id === 'string') next.providerSessionId = event.payload.session_id
        next.providerSessionMode = 'resume'
        addActivity('status', 'Claude session linked', typeof event.payload.session_id === 'string' ? event.payload.session_id : undefined)
      } else if (tool === 'cursor.session' || tool === 'gemini.session') {
        if (typeof event.payload.session_id === 'string') next.providerSessionId = event.payload.session_id
        next.providerSessionMode = 'resume'
        addActivity('status', `${tool === 'cursor.session' ? 'Cursor' : 'Gemini'} session linked`, typeof event.payload.session_id === 'string' ? event.payload.session_id : undefined)
      } else {
        if (!inlineToolActivity(tool)) break
        completeTool(next, event, tool, 'tools')
        addActivity('tool', tool, 'Completed')
      }
      break
    }
    case 'command.started': {
      const command = commandName(event)
      next.statusText = `Running ${command}`
      startTool(next, event, command, 'terminal')
      addActivity('tool', command, 'Command started')
      break
    }
    case 'command.output.delta': {
      const index = findToolIndex(next, event, 'Command', 'terminal')
      const delta = compactValue(event.payload.delta ?? event.payload.output)
      if (index >= 0 && delta) {
        const previous = next.tools[index]!
        next.tools[index] = { ...previous, output: `${previous.output}${delta}`.slice(-50_000) }
      }
      addActivity('tool', 'Command output', delta.slice(-240) || undefined)
      break
    }
    case 'command.completed': {
      const command = commandName(event)
      completeTool(next, event, command, 'terminal')
      const checkName = verificationLabel(command)
      if (checkName) {
        const ok = !commandFailed(event)
        mergeVerificationChecks(next, event.run_id, [{
          name: checkName,
          ok,
          duration: commandDuration(event),
        }])
        next.statusText = `${checkName.split(' · ')[0]} ${ok ? 'passed' : 'failed'}`
        addActivity('check', `${checkName.split(' · ')[0]} ${ok ? 'passed' : 'failed'}`, displayCommand(command))
      } else {
        addActivity('tool', 'Command completed')
      }
      break
    }
    case 'file.change.updated': {
      const paths = eventFilePaths(event)
      for (const path of paths) addSource(`file:${path}`, path, 'Changed by this run')
      addActivity(
        'change',
        paths.length === 1 ? `Changed ${paths[0]}` : paths.length > 1 ? `Changed ${paths.length} files` : 'File change updated',
        paths.length > 1 ? paths.slice(0, 5).join(', ') : undefined,
      )
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
    case 'usage.updated': {
      const usage = runUsage(event.payload)
      if (usage) {
        next.usage = {
          inputTokens: usage.inputTokens ?? next.usage?.inputTokens,
          cachedInputTokens: usage.cachedInputTokens ?? next.usage?.cachedInputTokens,
          outputTokens: usage.outputTokens ?? next.usage?.outputTokens,
          reasoningTokens: usage.reasoningTokens ?? next.usage?.reasoningTokens,
          totalTokens: usage.totalTokens ?? next.usage?.totalTokens,
          contextWindow: usage.contextWindow ?? next.usage?.contextWindow,
          contextPercent: usage.contextPercent ?? next.usage?.contextPercent,
        }
      }
      if (typeof event.payload.cost === 'string' || typeof event.payload.cost === 'number') {
        next.cost = String(event.payload.cost)
      }
      const detail = usage?.contextPercent !== undefined
        ? `${usage.contextPercent}% of context window`
        : usage?.totalTokens !== undefined ? `${usage.totalTokens.toLocaleString()} tokens` : undefined
      addActivity('status', 'Context usage updated', detail)
      break
    }
    case 'input.requested':
      next.statusText = 'Waiting for your answer'
      next.inputRequest = {
        kind: 'clarification',
        id: typeof event.payload.request_id === 'string' ? event.payload.request_id : undefined,
        prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'The agent needs input to continue.',
        detail: typeof event.payload.detail === 'string' ? event.payload.detail : undefined,
        questions: interactionQuestions(event.payload.questions),
      }
      addActivity('status', 'Agent requested input', next.inputRequest.prompt)
      break
    case 'warning': {
      const message = typeof event.payload.message === 'string'
        ? event.payload.message.trim().slice(0, 2_000)
        : ''
      if (message && !next.warnings?.some((warning) => warning.message === message)) {
        next.warnings = [...(next.warnings ?? []), {
          message,
          severity: typeof event.payload.severity === 'string' ? event.payload.severity : undefined,
        }].slice(-5)
      }
      addActivity('error', 'Runtime warning', message || undefined)
      break
    }
    case 'approval.requested':
      next.statusText = 'Waiting for approval'
      next.inputRequest = {
        kind: 'approval',
        id: typeof event.payload.request_id === 'string' ? event.payload.request_id : undefined,
        prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'This run needs approval before it can continue.',
        detail: typeof event.payload.detail === 'string' ? event.payload.detail : undefined,
        availableDecisions: Array.isArray(event.payload.available_decisions)
          ? event.payload.available_decisions.filter((value): value is string => typeof value === 'string')
          : undefined,
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
        id: typeof event.payload.request_id === 'string' ? event.payload.request_id : undefined,
        prompt: typeof event.payload.prompt === 'string' ? event.payload.prompt : 'The agent needs more information to continue.',
        questions: interactionQuestions(event.payload.questions),
      }
      addActivity('status', 'Agent asked a question', next.inputRequest.prompt)
      break
    case 'user.input.submitted':
      next.inputRequest = undefined
      next.statusText = 'Continuing'
      addActivity('status', 'Answer submitted')
      break
    case 'agent.queued':
      next.statusText = 'Queued after current turn'
      addActivity('status', 'Follow-up queued')
      break
    case 'agent.dequeued':
      next.statusText = 'Starting queued follow-up'
      addActivity('status', 'Queued follow-up started')
      break
    case 'agent.paused': {
      const recovered = event.payload.reason === 'control_plane_restarted'
      next.statusText = recovered ? 'Paused · ready to resume' : 'Paused'
      addActivity(
        'status',
        recovered ? 'Run recovered after restart' : 'Agent paused',
        recovered ? 'Saved workspace and provider session retained' : undefined,
      )
      break
    }
    case 'agent.resumed':
      next.statusText = 'Resumed'
      addActivity('status', 'Agent resumed')
      break
    case 'diff.updated': {
      const files = Array.isArray(event.payload.files) ? event.payload.files as RawDiffFile[] : []
      if (files.length) {
        for (const file of files) addSource(`file:${file.path}`, file.path, 'Changed by this run')
        const diff = toDiffFiles(files)
        const resolved = new Map<string, DiffHunk['status']>()
        for (const artifact of next.artifacts) {
          for (const file of artifact.diff ?? []) {
            for (const hunk of file.hunks) {
              if (hunk.status) resolved.set(diffHunkIdentity(file.path, hunk), hunk.status)
            }
          }
        }
        for (const file of diff) {
          for (const hunk of file.hunks) {
            hunk.status = resolved.get(diffHunkIdentity(file.path, hunk))
          }
        }
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
      const paths = eventFilePaths(event)
      for (const path of paths) addSource(`file:${path}`, path, 'Read or changed by this run')
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
        mergeVerificationChecks(next, event.run_id, checks.map((check) => ({
          name: check.name,
          ok: check.ok,
          duration: check.duration ?? '—',
        })))
        const artifact = next.artifacts.find((candidate) => candidate.id === `art-verify-${event.run_id}`)
        addActivity('check', 'Verification completed', artifact?.subtitle)
      }
      break
    }
    case 'agent.completed':
      if (typeof event.payload.provider_session_id === 'string') {
        next.providerSessionId = event.payload.provider_session_id
        next.providerSessionMode = event.payload.provider_session_mode === 'fork' ? 'fork' : 'resume'
      }
      if (typeof event.payload.provider_turn_id === 'string') next.providerTurnId = event.payload.provider_turn_id
      next.done = true
      next.inputRequest = undefined
      next.failure = undefined
      next.statusText = 'Completed'
      for (const step of next.plan) if (step.status !== 'done') step.status = 'done'
      if (typeof event.payload.cost === 'string') next.cost = event.payload.cost
      addActivity('status', 'Agent completed')
      break
    case 'agent.failed': {
      next.done = true
      next.inputRequest = undefined
      next.failure = runFailure(event, next.harness)
      next.statusText = next.failure.title
      addActivity('error', next.failure.title, next.failure.message)
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
