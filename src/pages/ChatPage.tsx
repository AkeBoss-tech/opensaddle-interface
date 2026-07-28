import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import {
  DEMO_FLOWS, deriveRoute, HARNESS_LABEL, MODEL_LABEL, needsPermission, RUNTIME_LABEL, simulateAgentRun,
  type RouteDecision,
} from '../lib/simulation'
import type { AgentRunBlock, CodingProvider, Harness, Message, ModelKey, PermissionGrant, RunExecutionMode, RuntimeKind } from '../types'
import { PROVIDER_NAME, ProviderLogo, providerFromLabel } from '../components/common/ProviderLogo'
import { evaluatePermissions } from '../services/permissions'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { useRunRegistry } from '../features/runs/RunRegistry'
import { InlineAgentRequest } from '../features/runs/InlineAgentRequest'
import { ChildRunList, UsedSourcesList, selectRelatedRuns, selectUsedRunSources } from '../features/runs/runRelations'
import { CollapsibleOutput, JumpToLatest, MessageActions, useTranscriptPosition } from '../features/thread'
import { buildPlanRevision } from '../features/thread/planRevision'
import {
  DEFAULT_THREAD_INSPECTOR_STATE,
  THREAD_INSPECTOR_STORAGE_KEY,
  clampInspectorWidth,
  parseThreadInspectorState,
  selectInspectorAttention,
  type ThreadInspectorState,
  type ThreadInspectorTab,
} from '../features/thread/inspectorState'
import type { GitComparisonResult, GitStatusResult, RouteEstimate } from '../services/contracts'

const HARNESS_PICKER_OPTIONS: Array<{
  id: CodingProvider
  label: string
  shortLabel: string
  detail: string
  logoLabel: string
  available?: boolean
}> = [
  { id: 'auto', label: 'Auto', shortLabel: 'Auto', detail: 'Best available', logoLabel: 'OpenSaddle' },
  { id: 'codex', label: 'Codex', shortLabel: 'Codex', detail: 'OpenAI app server', logoLabel: 'OpenAI' },
  { id: 'claude', label: 'Claude Code', shortLabel: 'Claude', detail: 'Anthropic CLI', logoLabel: 'Claude' },
  { id: 'cursor', label: 'Cursor', shortLabel: 'Cursor', detail: 'Cursor Agent CLI', logoLabel: 'Cursor' },
  { id: 'gemini', label: 'Gemini CLI', shortLabel: 'Gemini', detail: 'Google CLI', logoLabel: 'Gemini' },
  { id: 'opencode', label: 'OpenCode', shortLabel: 'OpenCode', detail: 'Open CLI', logoLabel: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity', shortLabel: 'Antigravity', detail: 'Agent CLI', logoLabel: 'Antigravity' },
  { id: 'opensaddle', label: 'OpenSaddle', shortLabel: 'OpenSaddle', detail: 'Native harness', logoLabel: 'OpenSaddle' },
  { id: 'custom', label: 'Project harness', shortLabel: 'Project', detail: 'Project-local CLI', logoLabel: 'OpenSaddle' },
]

const PROVIDER_LABEL: Partial<Record<CodingProvider, string>> = {
  opensaddle: 'OpenSaddle',
  codex: 'Codex App Server',
  claude: 'Claude Code',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  opencode: 'OpenCode',
  antigravity: 'Antigravity CLI',
  custom: 'Custom harness',
}

const EXECUTION_MODES: Array<{
  id: RunExecutionMode
  label: string
  detail: string
  icon: string
}> = [
  { id: 'plan', label: 'Plan', detail: 'Read-only · no file changes', icon: 'review' },
  { id: 'review', label: 'Review changes', detail: 'Prepare separately · apply after run', icon: 'shield' },
  { id: 'project', label: 'Auto-edit', detail: 'Edit inside this project', icon: 'spark' },
  { id: 'full-access', label: 'Full access', detail: 'Local machine · no approvals', icon: 'terminal' },
]

function routedModelLabel(route: RouteEstimate | undefined, fallback: ModelKey): string {
  const provider = route?.providerKey
  if (route?.nativeModelDefault && provider && provider !== 'auto') {
    return `${PROVIDER_LABEL[provider] ?? 'Harness'} default`
  }
  return MODEL_LABEL[route?.modelKey ?? fallback]
}

function routedHarnessLabel(route: RouteEstimate | undefined, fallback: Harness): string {
  const provider = route?.providerKey
  if ((route?.harnessKey ?? fallback) === 'coding' && provider && provider !== 'auto') {
    return PROVIDER_LABEL[provider] ?? HARNESS_LABEL[route?.harnessKey ?? fallback]
  }
  return HARNESS_LABEL[route?.harnessKey ?? fallback]
}

function routeDecisionFromEstimate(estimate: RouteEstimate, fallback: RouteDecision): RouteDecision {
  return {
    klass: estimate.harnessKey === 'coding' ? 'coding'
      : estimate.harnessKey === 'research' ? 'research'
      : estimate.harnessKey === 'browser' ? 'browser'
      : fallback.klass === 'ops' ? 'ops' : 'chat',
    modelKey: estimate.modelKey,
    harnessKey: estimate.harnessKey,
    runtimeKey: estimate.runtimeKey,
    reasons: estimate.reasons,
    cost: estimate.cost,
  }
}

type PromptPermission = NonNullable<ReturnType<typeof needsPermission>>
type PromptPermissionScope = 'once' | 'chat' | 'project' | 'always'
const TASK_CAPABILITIES = ['Browser', 'Network', 'Secure VM', 'Subagents'] as const
type TaskCapability = typeof TASK_CAPABILITIES[number]
type HarnessPolicyControl = 'native' | 'sandbox-only' | 'provider-defined'

function capabilitiesRequiredByHarnessPolicy(controls: HarnessPolicyControl): TaskCapability[] {
  if (controls === 'sandbox-only') return ['Browser', 'Secure VM', 'Subagents']
  return controls === 'provider-defined' ? [...TASK_CAPABILITIES] : []
}

function normalizeTaskCapabilities(values: Iterable<string>): Set<string> {
  const aliases: Record<string, string | undefined> = {
    Chrome: 'Browser',
    API: 'Network',
    VM: 'Secure VM',
    'Coding agent': 'Subagents',
    Files: undefined,
  }
  return new Set([...values].flatMap((value) => {
    const normalized = Object.hasOwn(aliases, value) ? aliases[value] : value
    return normalized && TASK_CAPABILITIES.includes(normalized as typeof TASK_CAPABILITIES[number]) ? [normalized] : []
  }))
}

function readThreadInspectorState(threadId: string | undefined): ThreadInspectorState {
  if (!threadId || typeof window === 'undefined') return { ...DEFAULT_THREAD_INSPECTOR_STATE }
  try {
    const stored = JSON.parse(window.localStorage.getItem(THREAD_INSPECTOR_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    return parseThreadInspectorState(stored[threadId])
  } catch {
    return { ...DEFAULT_THREAD_INSPECTOR_STATE }
  }
}

function writeThreadInspectorState(threadId: string | undefined, state: ThreadInspectorState): void {
  if (!threadId || typeof window === 'undefined') return
  try {
    const stored = JSON.parse(window.localStorage.getItem(THREAD_INSPECTOR_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    delete stored[threadId]
    const entries = [...Object.entries(stored).slice(-99), [threadId, state] as const]
    window.localStorage.setItem(THREAD_INSPECTOR_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // A blocked or full browser storage area must not break the thread.
  }
}

function promptGrantApplies(
  grant: PermissionGrant,
  permission: PromptPermission,
  context: { chatId: string; projectId: string },
): boolean {
  if (grant.principalKind !== 'user'
    || grant.resourceKind !== permission.resourceKind
    || grant.resourceId !== permission.resourceId
    || grant.action !== permission.action) return false
  if (grant.expiresAt !== undefined && grant.expiresAt <= Date.now()) return false
  if (grant.usesRemaining !== undefined && grant.usesRemaining <= 0) return false
  if (!grant.scope || grant.scope === 'organization') return true
  if (grant.scope === 'project') return grant.scopeId === context.projectId
  if (grant.scope === 'thread' || grant.scope === 'once') return grant.scopeId === context.chatId
  return false
}

const MODEL_PICKER_OPTIONS: Partial<Record<CodingProvider, Array<{
  id: ModelKey | 'auto'
  label: string
  detail: string
  logoLabel: string
}>>> = {
  auto: [
    { id: 'auto', label: 'Auto', detail: 'Harness decides', logoLabel: 'OpenSaddle' },
    { id: 'gpt', label: 'GPT', detail: 'Balanced', logoLabel: 'OpenAI' },
    { id: 'claude', label: 'Opus', detail: 'Highest quality', logoLabel: 'Claude' },
    { id: 'sonnet', label: 'Sonnet', detail: 'Fast quality', logoLabel: 'Claude' },
    { id: 'gemini', label: 'Gemini', detail: 'Long context', logoLabel: 'Gemini' },
    { id: 'llama', label: 'Llama', detail: 'Private/local', logoLabel: 'Llama' },
  ],
  codex: [
    { id: 'auto', label: 'Auto', detail: 'Codex router', logoLabel: 'OpenAI' },
    { id: 'gpt', label: 'GPT-5.4', detail: 'General coding', logoLabel: 'OpenAI' },
    { id: 'sonnet', label: 'GPT-5.3 Codex', detail: 'Agentic coding', logoLabel: 'OpenAI' },
    { id: 'gemini', label: 'Codex Spark', detail: 'Fast iteration', logoLabel: 'OpenAI' },
    { id: 'llama', label: 'Codex Mini', detail: 'Low latency', logoLabel: 'OpenAI' },
  ],
  claude: [
    { id: 'auto', label: 'Auto', detail: 'Claude router', logoLabel: 'Claude' },
    { id: 'claude', label: 'Opus', detail: 'Deep reasoning', logoLabel: 'Claude' },
    { id: 'sonnet', label: 'Sonnet', detail: 'Recommended', logoLabel: 'Claude' },
    { id: 'gemini', label: 'Haiku', detail: 'Fastest', logoLabel: 'Claude' },
  ],
  cursor: [
    { id: 'auto', label: 'Auto', detail: 'Cursor router', logoLabel: 'Cursor' },
    { id: 'gpt', label: 'GPT-5.4', detail: 'OpenAI', logoLabel: 'OpenAI' },
    { id: 'claude', label: 'Claude Opus 4', detail: 'Highest quality', logoLabel: 'Claude' },
    { id: 'sonnet', label: 'Claude Sonnet 4', detail: 'Recommended', logoLabel: 'Claude' },
    { id: 'gemini', label: 'Gemini 2.5 Pro', detail: 'Long context', logoLabel: 'Gemini' },
  ],
  gemini: [
    { id: 'auto', label: 'Auto', detail: 'Gemini router', logoLabel: 'Gemini' },
    { id: 'gemini', label: 'Gemini 2.5 Pro', detail: 'Most capable', logoLabel: 'Gemini' },
    { id: 'sonnet', label: 'Gemini Flash', detail: 'Fast', logoLabel: 'Gemini' },
    { id: 'llama', label: 'Flash Lite', detail: 'Lowest latency', logoLabel: 'Gemini' },
  ],
  opencode: [
    { id: 'auto', label: 'Auto', detail: 'OpenCode router', logoLabel: 'OpenCode' },
    { id: 'gpt', label: 'GPT-5.4', detail: 'OpenAI', logoLabel: 'OpenAI' },
    { id: 'claude', label: 'Claude Opus 4', detail: 'Anthropic', logoLabel: 'Claude' },
    { id: 'sonnet', label: 'Claude Sonnet 4', detail: 'Recommended', logoLabel: 'Claude' },
    { id: 'gemini', label: 'Gemini 2.5 Pro', detail: 'Google', logoLabel: 'Gemini' },
    { id: 'llama', label: 'Llama 4', detail: 'Meta', logoLabel: 'Llama' },
  ],
  antigravity: [
    { id: 'auto', label: 'Auto', detail: 'Harness router', logoLabel: 'Antigravity' },
    { id: 'gpt', label: 'GPT', detail: 'OpenAI route', logoLabel: 'OpenAI' },
    { id: 'claude', label: 'Claude', detail: 'Anthropic route', logoLabel: 'Claude' },
    { id: 'gemini', label: 'Gemini', detail: 'Google route', logoLabel: 'Gemini' },
  ],
  opensaddle: [
    { id: 'auto', label: 'Auto', detail: 'Model gateway', logoLabel: 'OpenSaddle' },
    { id: 'gpt', label: 'GPT', detail: 'OpenAI route', logoLabel: 'OpenAI' },
    { id: 'claude', label: 'Opus', detail: 'Anthropic route', logoLabel: 'Claude' },
    { id: 'sonnet', label: 'Sonnet', detail: 'Anthropic route', logoLabel: 'Claude' },
    { id: 'gemini', label: 'Gemini', detail: 'Google route', logoLabel: 'Gemini' },
    { id: 'llama', label: 'Llama', detail: 'Local route', logoLabel: 'Llama' },
  ],
  custom: [
    { id: 'auto', label: 'Harness default', detail: 'Use the project harness model', logoLabel: 'OpenSaddle' },
  ],
}

function HarnessVisual({ id, className = 'provider-logo' }: { id: CodingProvider; className?: string }) {
  if (id === 'codex') return <ProviderLogo provider="openai" className={className} />
  if (id === 'claude') return <ProviderLogo provider="anthropic" className={className} />
  if (id === 'gemini') return <ProviderLogo provider="google" className={className} />
  if (id === 'cursor') return <Icon name="code" className={className} />
  if (id === 'opencode') return <Icon name="terminal" className={className} />
  if (id === 'antigravity') return <Icon name="spark" className={className} />
  if (id === 'custom') return <Icon name="terminal" className={className} />
  return <ProviderLogo provider="opensaddle" className={className} />
}

export function ChatPage() {
  const { chatId } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const store = useStore()
  const runRegistry = useRunRegistry()
  const { data, appendMessage, updateMessage, createChat, setActiveChat, setActiveProject, setChatVisibility, setChatArchived, updateChatRunConfig, branchChat, branchChatFromMessage, renameChat, deleteChat, updateSource, updateHunk, upsertPermissionGrant, consumePermissionGrant, toast, services, harnessCapabilities, refreshHarnessCapabilities } = store
  const chat = data.chats.find((c) => c.id === (chatId ?? data.activeChatId))
  const durableRunConfigKey = JSON.stringify(chat?.runConfig ?? null)
  const continuationAction = chat?.continuation?.mode === 'fork' ? 'Fork' : 'Resume'
  const project = data.projects.find((p) => p.id === chat?.projectId) ?? data.projects.find((p) => p.id === data.activeProjectId) ?? data.projects[0]
  const chatAgent = data.agents.find((agent) => agent.id === chat?.agentId)
  const messages = useMemo(() => data.messages.filter((m) => m.chatId === chat?.id).sort((a, b) => a.createdAt - b.createdAt), [data.messages, chat?.id])
  const latestMessageRun = useMemo(() => [...messages].reverse().find((message) => message.run)?.run, [messages])
  const rootRun = useMemo(() => [...messages].reverse().find((message) => message.run && !message.run.parentRunId)?.run, [messages])
  const managedRuns = runRegistry.getForThread(chat?.id ?? '')
  const queuedManagedRuns = managedRuns.filter((managed) =>
    !managed.run.done && /queued after current turn/i.test(managed.run.statusText))
  const activeManagedRun = [...managedRuns].reverse().find((managed) =>
    !managed.run.done && !/queued after current turn/i.test(managed.run.statusText))
  const latestRun = activeManagedRun?.run ?? latestMessageRun
  const latestRunPaused = /^Paused\b/.test(latestRun?.statusText ?? '')
  const latestRunState = latestRun
    ? latestRun.done
      ? latestRun.failure ? 'Needs attention' : 'Ready'
      : latestRunPaused ? 'Paused'
        : /queued/i.test(latestRun.statusText) ? 'Queued' : 'Running'
    : 'Ready'
  const threadRunActivity = useMemo(() => {
    const entries = new Map<string, NonNullable<AgentRunBlock['activity']>[number]>()
    for (const message of messages) {
      for (const item of message.run?.activity ?? []) entries.set(item.id, item)
    }
    for (const managed of managedRuns) {
      for (const item of managed.run.activity ?? []) entries.set(item.id, item)
    }
    return [...entries.values()]
      .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
      .slice(-160)
  }, [managedRuns, messages])
  const steerableRun = activeManagedRun && /codex/i.test(activeManagedRun.run.harness)
    ? activeManagedRun
    : undefined

  const [text, setText] = useState('')
  const [activeSendMode, setActiveSendMode] = useState<'steer' | 'queue'>('steer')
  const [queueEditingRunId, setQueueEditingRunId] = useState<string | null>(null)
  const [queueDraft, setQueueDraft] = useState('')
  const [queueBusyRunId, setQueueBusyRunId] = useState<string | null>(null)
  const initialInspectorState = useRef(readThreadInspectorState(chat?.id))
  const [inspector, setInspector] = useState(initialInspectorState.current.open)
  const [itab, setItab] = useState<ThreadInspectorTab>(initialInspectorState.current.tab)
  const [inspectorWidth, setInspectorWidth] = useState(initialInspectorState.current.width)
  const inspectorWidthRef = useRef(initialInspectorState.current.width)
  const inspectorAttentionKey = useRef(initialInspectorState.current.lastAttentionKey)
  const [density, setDensity] = useState<'summary' | 'normal' | 'verbose'>('normal')
  const [routeOpen, setRouteOpen] = useState(false)
  const [refreshingHarnesses, setRefreshingHarnesses] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tools, setTools] = useState<Set<string>>(new Set(['Browser', 'Network']))
  const [auto, setAuto] = useState(true)
  const [modelOv, setModelOv] = useState<ModelKey | 'auto'>('auto')
  const [harnessOv, setHarnessOv] = useState<Harness | 'auto'>('auto')
  const [providerOv, setProviderOv] = useState<CodingProvider>('auto')
  const [runtimeOv, setRuntimeOv] = useState<RuntimeKind | 'auto'>('auto')
  const [executionMode, setExecutionMode] = useState<RunExecutionMode>('project')
  const [openRouterModelId, setOpenRouterModelId] = useState('')
  const [freeModels, setFreeModels] = useState<Array<{ id: string; name: string; contextLength?: number }>>([])
  const [route, setRoute] = useState<RouteDecision>(() => deriveRoute('', data.settings.routingPref))
  const [providerKey, setProviderKey] = useState<CodingProvider>('opensaddle')
  const [perm, setPerm] = useState<ReturnType<typeof needsPermission>>(null)
  const [pending, setPending] = useState('')
  const [permScope, setPermScope] = useState<PromptPermissionScope>('once')
  const [activity, setActivity] = useState<Array<{ title: string; sub: string; kind?: string; t: string }>>([])
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitComparison, setGitComparison] = useState<GitComparisonResult | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitError, setGitError] = useState('')
  const [gitAction, setGitAction] = useState<'branch' | 'commit' | 'push' | 'pull-request' | null>(null)
  const [branchName, setBranchName] = useState('')
  const [commitMessage, setCommitMessage] = useState('')
  const [commitPaths, setCommitPaths] = useState<string[]>([])
  const [pullRequestTitle, setPullRequestTitle] = useState('')
  const [pullRequestBody, setPullRequestBody] = useState('')
  const [pullRequestBase, setPullRequestBase] = useState('main')
  const [pullRequestDraft, setPullRequestDraft] = useState(false)
  const [pullRequestResult, setPullRequestResult] = useState<{ number: number; url: string; title: string } | null>(null)
  const [runConfigReadyChatId, setRunConfigReadyChatId] = useState<string | null>(null)
  const [repositoryEditorOpen, setRepositoryEditorOpen] = useState(false)
  const [repositoryDraft, setRepositoryDraft] = useState('')
  const [delegateEditorOpen, setDelegateEditorOpen] = useState(false)
  const [delegateDraft, setDelegateDraft] = useState('')
  const attachRef = useRef<HTMLInputElement>(null)
  const persistInspector = (state: Partial<ThreadInspectorState>) => {
    const next = {
      open: state.open ?? inspector,
      tab: state.tab ?? itab,
      width: clampInspectorWidth(state.width ?? inspectorWidthRef.current),
      lastAttentionKey: state.lastAttentionKey ?? inspectorAttentionKey.current,
    }
    writeThreadInspectorState(chat?.id, next)
  }
  const openInspector = (tab: ThreadInspectorTab = itab) => {
    setInspector(true)
    setItab(tab)
    persistInspector({ open: true, tab })
  }
  const closeInspector = () => {
    setInspector(false)
    persistInspector({ open: false })
  }
  const selectInspectorTab = (tab: ThreadInspectorTab) => {
    setItab(tab)
    persistInspector({ tab })
  }
  const beginInspectorResize = (startX: number) => {
    const startWidth = inspectorWidth
    const onMove = (event: PointerEvent) => {
      const width = clampInspectorWidth(startWidth - (event.clientX - startX))
      inspectorWidthRef.current = width
      setInspectorWidth(width)
    }
    const onUp = (event: PointerEvent) => {
      const width = clampInspectorWidth(startWidth - (event.clientX - startX))
      inspectorWidthRef.current = width
      setInspectorWidth(width)
      persistInspector({ width })
      document.body.classList.remove('is-resizing-panel')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    document.body.classList.add('is-resizing-panel')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const resizeInspectorTo = (width: number) => {
    const next = clampInspectorWidth(width)
    inspectorWidthRef.current = next
    setInspectorWidth(next)
    persistInspector({ width: next })
  }
  const transcript = useTranscriptPosition({
    itemCount: messages.length,
    revision: `${messages.at(-1)?.text.length ?? 0}:${messages.at(-1)?.run?.statusText ?? ''}`,
  })
  const runtimeOptions = useMemo(() => {
    const defaults: Array<{ value: RuntimeKind; label: string }> = [
      { value: 'local', label: 'My machine · Local desktop' },
      { value: 'browser', label: 'This browser · Browser sandbox' },
      { value: 'sandbox', label: 'Ephemeral cloud VM' },
      { value: 'vm', label: 'Connected project VM' },
      { value: 'gpu', label: 'Connected GPU machine' },
      { value: 'restricted', label: 'Restricted corporate runtime' },
    ]
    const connected = data.environments
      .filter((environment) => environment.status === 'Running')
      .map((environment) => ({ value: environment.kind, label: `${environment.name} · ${RUNTIME_LABEL[environment.kind]}` }))
    return [...defaults, ...connected.filter((item) => !defaults.some((base) => base.value === item.value))]
  }, [data.environments])

  useEffect(() => {
    if (chatId) {
      const c = data.chats.find((x) => x.id === chatId)
      if (c) { setActiveChat(c.id); setActiveProject(c.projectId) }
    } else if (!data.activeChatId) {
      const c = createChat(data.activeProjectId)
      nav(`/chat/${c.id}`, { replace: true })
    } else {
      nav(`/chat/${data.activeChatId}`, { replace: true })
    }
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const state = location.state as { initialPrompt?: unknown } | null
    if (typeof state?.initialPrompt !== 'string' || !state.initialPrompt.trim()) return
    setText(state.initialPrompt)
    nav(location.pathname, { replace: true, state: null })
  }, [location.pathname, location.state, nav])

  useEffect(() => {
    if (!chat) return
    setRunConfigReadyChatId(null)
    const config = chat.runConfig
    setTools(normalizeTaskCapabilities(config?.tools ?? ['Browser', 'Network']))
    setAuto(config?.auto ?? true)
    setProviderOv(config?.providerKey ?? 'auto')
    setModelOv(config?.modelKey ?? 'auto')
    setHarnessOv(config?.harnessKey ?? 'auto')
    setRuntimeOv(config?.runtimeKey ?? 'auto')
    setExecutionMode(config?.executionMode ?? 'project')
    setOpenRouterModelId(config?.openRouterModelId ?? '')
    setRunConfigReadyChatId(chat.id)
  }, [chat?.id, durableRunConfigKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chat || runConfigReadyChatId !== chat.id) return
    updateChatRunConfig(chat.id, {
      auto,
      providerKey: providerOv,
      modelKey: modelOv,
      harnessKey: harnessOv,
      runtimeKey: runtimeOv,
      executionMode,
      tools: [...tools].sort(),
      openRouterModelId: openRouterModelId || undefined,
    })
  }, [auto, providerOv, modelOv, harnessOv, runtimeOv, executionMode, tools, openRouterModelId, runConfigReadyChatId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chatAgent || chat?.continuation || chat?.runConfig) return
    const builtinProviders: CodingProvider[] = ['opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity']
    const agentProvider = chatAgent.harnessId && builtinProviders.includes(chatAgent.harnessId as CodingProvider)
      ? chatAgent.harnessId as CodingProvider
      : chatAgent.harnessId ? 'custom' : 'auto'
    setProviderOv(agentProvider)
    setHarnessOv(chatAgent.harness)
    setRuntimeOv(chatAgent.runtime)
    setModelOv(chatAgent.modelPolicy)
    setExecutionMode(chatAgent.permissionPolicy?.sandbox === 'full-access'
      ? 'full-access'
      : chatAgent.permissionPolicy?.sandbox === 'read-only'
        ? 'plan'
        : 'project')
    setOpenRouterModelId('')
    setRoute((current) => ({
      ...current,
      modelKey: chatAgent.modelPolicy === 'auto' ? current.modelKey : chatAgent.modelPolicy,
      harnessKey: chatAgent.harness,
      runtimeKey: chatAgent.runtime,
    }))
    if (agentProvider !== 'auto') setProviderKey(agentProvider)
    setAuto(false)
  }, [chat?.id, chatAgent?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!chat?.continuation || chat.runConfig) return
    setProviderOv(chat.continuation.provider)
    setHarnessOv('coding')
    setRuntimeOv('local')
    setExecutionMode(chat.continuation.authority === 'source_managed' ? 'full-access' : 'project')
    setOpenRouterModelId('')
    setRoute((current) => ({ ...current, harnessKey: 'coding', runtimeKey: 'local' }))
    setProviderKey(chat.continuation.provider)
    setAuto(false)
  }, [chat?.continuation, chat?.id])

  useEffect(() => {
    setDelegateEditorOpen(false)
    setDelegateDraft('')
    setRepositoryEditorOpen(false)
    setGitAction(null)
    setBranchName('')
    setCommitMessage('')
    setCommitPaths([])
    setPullRequestTitle('')
    setPullRequestBody('')
    setPullRequestBase('main')
    setPullRequestDraft(false)
    setPullRequestResult(null)
    setGitComparison(null)
    const savedInspector = readThreadInspectorState(chat?.id)
    setInspector(savedInspector.open)
    setItab(savedInspector.tab)
    inspectorWidthRef.current = savedInspector.width
    setInspectorWidth(savedInspector.width)
    inspectorAttentionKey.current = savedInspector.lastAttentionKey
  }, [chat?.id])

  const serverRouting = Boolean(services?.controlPlane.connected) && auto
  const defaults = project?.routingDefaults
  const defaultModel = chatAgent?.modelPolicy && chatAgent.modelPolicy !== 'auto'
    ? chatAgent.modelPolicy
    : defaults?.modelKey && defaults.modelKey !== 'auto' ? defaults.modelKey : undefined
  const agentHarnessId = chatAgent?.harnessId
  const builtinProviders: CodingProvider[] = ['opensaddle', 'codex', 'claude', 'cursor', 'gemini', 'opencode', 'antigravity']
  const agentProvider = agentHarnessId
    ? builtinProviders.includes(agentHarnessId as CodingProvider) ? agentHarnessId as CodingProvider : 'custom'
    : undefined
  const defaultProvider = agentProvider
    ?? (defaults?.providerKey && defaults.providerKey !== 'auto' ? defaults.providerKey : undefined)
  const defaultRuntime = chatAgent?.runtime ?? defaults?.runtimeKey
  const selectedProvider = providerOv === 'auto' ? defaultProvider : providerOv
  const pickerProvider = providerOv === 'auto' ? 'auto' : providerOv
  const activeCustomHarness = project?.local?.harnesses.find((item) =>
    item.id === (agentProvider === 'custom' ? agentHarnessId : project.local?.defaultHarnessId))
  const policyControlLabel = (capability: typeof harnessCapabilities[number] | undefined) =>
    capability?.capabilities.policyControls === 'native'
      ? 'Native policy'
      : capability?.capabilities.policyControls === 'sandbox-only'
        ? 'Sandbox controls'
        : 'Provider policy'
  const liveHarnessOptions = useMemo(() => HARNESS_PICKER_OPTIONS.map((option) => {
    if (option.id === 'auto') return { ...option, available: true }
    if (option.id === 'custom') {
      const capability = activeCustomHarness
        ? harnessCapabilities.find((item) => item.id === activeCustomHarness.id)
        : undefined
      const ready = capability
        ? capability.availability === 'available' && capability.readiness !== 'unavailable'
        : Boolean(activeCustomHarness)
      return {
        ...option,
        label: activeCustomHarness?.label ?? option.label,
        shortLabel: activeCustomHarness?.label ?? option.shortLabel,
        detail: activeCustomHarness
          ? ready
            ? `${policyControlLabel(capability)} · ${activeCustomHarness.protocol === 'acp' ? 'ACP' : 'CLI'} · ${capability?.version ?? activeCustomHarness.command}`
            : `${policyControlLabel(capability)} · ${capability?.unavailableReason ?? 'Executable unavailable'}`
          : 'Register in Local projects',
        reason: activeCustomHarness
          ? capability?.auth.message ?? capability?.unavailableReason ?? 'Project-local harness'
          : 'No project-local harness is selected.',
        available: ready,
      }
    }
    const capability = harnessCapabilities.find((item) => item.id === option.id)
    if (!capability) return { ...option, available: true }
    const ready = capability.availability === 'available' && capability.readiness === 'ready'
    const reason = capability.auth.message ?? capability.unavailableReason ?? 'This harness is unavailable.'
    return {
      ...option,
      label: capability.label,
      detail: ready
        ? `${policyControlLabel(capability)} · ${capability.version ?? 'Ready'}`
        : capability.auth.setupCommand
          ? `${policyControlLabel(capability)} · Setup required`
          : `${policyControlLabel(capability)} · Unavailable`,
      reason,
      available: ready,
    }
  }), [activeCustomHarness, harnessCapabilities])
  const harnessPickerOption = liveHarnessOptions.find((option) => option.id === pickerProvider)
    ?? liveHarnessOptions[0]!
  const liveCapability = harnessCapabilities.find((item) =>
    item.id === (pickerProvider === 'custom' ? activeCustomHarness?.id : pickerProvider))
  const selectedPolicyControls: HarnessPolicyControl = liveCapability?.capabilities.policyControls
    ?? (pickerProvider === 'auto' ? 'native' : 'provider-defined')
  const lockedTaskCapabilities = capabilitiesRequiredByHarnessPolicy(selectedPolicyControls)
  useEffect(() => {
    const required = capabilitiesRequiredByHarnessPolicy(selectedPolicyControls)
    if (!required.length) return
    setTools((current) => required.every((capability) => current.has(capability))
      ? current
      : new Set([...current, ...required]))
  }, [selectedPolicyControls])
  const compatibleModelOptions = useMemo(() => {
    const fallback = MODEL_PICKER_OPTIONS[pickerProvider] ?? MODEL_PICKER_OPTIONS.auto!
    if (!liveCapability?.models.length || pickerProvider === 'auto') return fallback
    return [
      { ...fallback[0]!, detail: 'Harness decides', nativeId: '' },
      ...liveCapability.models.map((model, index) => ({
        id: fallback[index + 1]?.id ?? 'auto' as const,
        label: model.id,
        detail: model.configured ? 'Configured locally' : 'Available in this harness',
        logoLabel: harnessPickerOption.logoLabel,
        nativeId: model.id,
      })),
    ]
  }, [harnessPickerOption.logoLabel, liveCapability, pickerProvider])
  const modelPickerOption = compatibleModelOptions.find((option) =>
    openRouterModelId && 'nativeId' in option && option.nativeId === openRouterModelId)
    ?? compatibleModelOptions.find((option) => option.id === modelOv)
    ?? compatibleModelOptions[0]!
  const selectedModelLabel = pickerProvider === 'auto'
    ? MODEL_LABEL[route.modelKey]
    : modelPickerOption.label
  const selectedHarnessLabel = pickerProvider === 'auto'
    ? HARNESS_LABEL[route.harnessKey]
    : harnessPickerOption.label
  const usesNativeCliRouter = selectedProvider !== undefined && selectedProvider !== 'opensaddle' && selectedProvider !== 'custom'
  useEffect(() => {
    if (!routeOpen || services?.controlPlane.modelProvider !== 'openrouter' || !services.runtime.listOpenRouterFreeModels) return
    void services.runtime.listOpenRouterFreeModels().then(setFreeModels).catch(() => setFreeModels([]))
  }, [routeOpen, services])

  const refreshRoute = (prompt: string) => {
    const r = deriveRoute(prompt, data.settings.routingPref, {
      model: modelOv === 'auto' ? undefined : modelOv,
      harness: harnessOv === 'auto' ? undefined : harnessOv,
      runtime: runtimeOv === 'auto' ? undefined : runtimeOv,
    })
    // When the control plane routes for real, don't overwrite its estimate
    // with the local mock — the debounced effect below keeps the pill honest.
    if (!serverRouting) setRoute(r)
    return r
  }

  const routeEstimatePreferences = useMemo(() => ({
    projectId: project.id,
    routingPref: data.settings.routingPref,
    modelKey: modelOv === 'auto' && usesNativeCliRouter ? 'auto' as const : modelOv === 'auto' ? defaultModel : modelOv,
    modelId: openRouterModelId || undefined,
    harnessKey: harnessOv === 'auto' ? undefined : harnessOv,
    providerKey: providerOv === 'auto' ? undefined : providerOv,
    runtimeKey: runtimeOv === 'auto' ? defaultRuntime : runtimeOv,
  }), [project.id, data.settings.routingPref, modelOv, usesNativeCliRouter, defaultModel, openRouterModelId, harnessOv, providerOv, runtimeOv, defaultRuntime])

  const resolveRoute = async (prompt: string): Promise<RouteDecision> => {
    const fallback = refreshRoute(prompt)
    if (!serverRouting || !services) return fallback
    const estimate = await services.runtime.estimate(prompt, routeEstimatePreferences)
    const resolved = routeDecisionFromEstimate(estimate, fallback)
    setRoute(resolved)
    if (estimate.providerKey) setProviderKey(estimate.providerKey)
    return resolved
  }

  // Reflect the backend's actual route estimate in the pill while typing.
  useEffect(() => {
    if (!serverRouting || !services) return
    const task = (text || pending || 'general chat message').trim()
    const timer = window.setTimeout(() => {
      void services.runtime.estimate(task, routeEstimatePreferences)
        .then((est) => {
          setRoute((current) => routeDecisionFromEstimate(est, current))
          if (est.providerKey) setProviderKey(est.providerKey)
        })
        .catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [text, pending, serverRouting, services, routeEstimatePreferences])

  const send = async (forced?: string) => {
    const prompt = (forced ?? text).trim()
    if (!prompt || !chat) return
    if (forced === undefined && activeManagedRun) {
      try {
        if (activeSendMode === 'steer' && steerableRun) {
          await runRegistry.steer(steerableRun.runId, prompt)
          setText('')
          appendMessage({ chatId: chat.id, role: 'user', text: prompt })
          setActivity((items) => [...items, {
            title: 'Guidance sent',
            sub: 'Steered the active Codex turn',
            kind: 'info',
            t: 'now',
          }])
        } else {
          const queued = await runRegistry.queue(activeManagedRun.runId, prompt)
          setText('')
          const queuedPromptMessage = appendMessage({ chatId: chat.id, role: 'user', text: prompt })
          const queuedRun: AgentRunBlock = {
            id: queued.runId,
            parentRunId: queued.parentRunId ?? activeManagedRun.runId,
            executionMode: activeManagedRun.run.executionMode,
            kind: activeManagedRun.run.kind,
            title: 'Queued follow-up',
            model: activeManagedRun.run.model,
            harness: activeManagedRun.run.harness,
            runtime: activeManagedRun.run.runtime,
            statusText: 'Queued after current turn',
            queuedTask: prompt,
            queuedPromptMessageId: queuedPromptMessage.id,
            done: false,
            tools: [],
            plan: [],
            artifacts: [],
            cost: queued.route?.cost ?? activeManagedRun.run.cost,
          }
          const placeholder = appendMessage({
            chatId: chat.id,
            role: 'assistant',
            text: '',
            routingNote: `Queued · ${queuedRun.model} · ${queuedRun.harness} · ${queuedRun.runtime}`,
            run: queuedRun,
          })
          runRegistry.track({
            runId: queued.runId,
            threadId: chat.id,
            messageId: placeholder.id,
            parentRunId: queuedRun.parentRunId,
            initialRun: queuedRun,
          })
          setActivity((items) => [...items, {
            title: 'Follow-up queued',
            sub: 'Starts when the active turn finishes',
            kind: 'info',
            t: 'now',
          }])
        }
      } catch (error) {
        toast(
          activeSendMode === 'steer' && steerableRun ? 'Could not steer this run' : 'Could not queue follow-up',
          error instanceof Error ? error.message : String(error),
        )
      }
      return
    }
    const selectedCapability = providerOv !== 'auto'
      ? harnessCapabilities.find((item) => item.id === providerOv)
      : undefined
    if (
      selectedCapability
      && (selectedCapability.availability !== 'available' || selectedCapability.readiness !== 'ready')
    ) {
      const setup = selectedCapability.auth.setupCommand
        ? ` Run ${selectedCapability.auth.setupCommand} in Terminal, then reopen the selector.`
        : ''
      toast(
        `${selectedCapability.label} needs setup`,
        `${selectedCapability.auth.message ?? selectedCapability.unavailableReason ?? 'This harness is not ready.'}${setup}`,
      )
      setRouteOpen(true)
      return
    }
    let r: RouteDecision
    try {
      r = await resolveRoute(prompt)
    } catch (error) {
      toast('Could not choose a ready harness', error instanceof Error ? error.message : String(error))
      return
    }
    setText('')
    setToolsOpen(false)
    setRouteOpen(false)
    appendMessage({ chatId: chat.id, role: 'user', text: prompt })
    const permission = needsPermission(prompt)
    if (permission) {
      const matching = data.permissionGrants.filter((grant) =>
        grant.principalId === data.currentUserId
        && promptGrantApplies(grant, permission, { chatId: chat.id, projectId: project.id }))
      const denied = matching.find((grant) => grant.effect === 'deny')
      if (denied) {
        if (denied.scope === 'once') await consumePermissionGrant(denied.id)
        appendMessage({
          chatId: chat.id,
          role: 'assistant',
          text: '',
          lightHtml: `<p>The saved policy denies <strong>${permission.resource}</strong> for this ${denied.scope === 'project' ? 'project' : denied.scope === 'organization' ? 'workspace' : 'thread'}.</p>`,
          routingNote: `Denied by ${denied.id}`,
        })
        toast('Access denied by policy', permission.resource)
        return
      }
      const allowed = matching.find((grant) => grant.effect === 'allow')
      if (allowed) {
        if (allowed.scope === 'once') await consumePermissionGrant(allowed.id)
        setActivity((items) => [...items, {
          title: 'Saved permission applied',
          sub: `${permission.resource} · ${allowed.scope ?? 'workspace'}`,
          kind: 'info',
          t: 'now',
        }])
        await runAgent(prompt, r, chat.id)
        return
      }
      setPending(prompt)
      setPerm(permission)
      return
    }
    await runAgent(prompt, r, chat.id)
  }

  useEffect(() => {
    if (!chatId) return
    try {
      const raw = sessionStorage.getItem('opensaddle-pending-prompt')
      if (!raw) return
      const pendingPrompt = JSON.parse(raw) as { chatId?: string; prompt?: string }
      if (pendingPrompt.chatId !== chatId || !pendingPrompt.prompt) return
      sessionStorage.removeItem('opensaddle-pending-prompt')
      window.setTimeout(() => { void send(pendingPrompt.prompt) }, 0)
    } catch {
      sessionStorage.removeItem('opensaddle-pending-prompt')
    }
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

  const runAgent = async (prompt: string, r: RouteDecision, cid: string, approvalId?: string) => {
    const agentId = chat?.agentId
    const exec = evaluatePermissions(data.permissionGrants, {
      userId: data.currentUserId,
      agentId,
      resourceKind: 'project',
      resourceId: project.id,
      action: 'execute',
    })
    if (!exec.allowed) {
      toast('Blocked', exec.reason)
      setActivity([{ title: 'Permission denied', sub: exec.reason, kind: 'error', t: 'now' }])
      return
    }
    setActivity([{ title: 'Run started', sub: `${project.name} · ${RUNTIME_LABEL[r.runtimeKey]}`, kind: 'info', t: '0.0s' }])
    openInspector('overview')

    if (r.klass === 'chat' && !services?.controlPlane.connected) {
      appendMessage({
        chatId: cid, role: 'assistant', text: '',
        lightHtml: `<p>Handled directly via <strong>${MODEL_LABEL[r.modelKey]}</strong> — lightweight answer, no side effects.</p><p>Ask me to build, research, or operate on a system for a full agent run.</p>`,
        routingNote: `Auto · ${MODEL_LABEL[r.modelKey]} · ${HARNESS_LABEL[r.harnessKey]} · ${RUNTIME_LABEL[r.runtimeKey]}`,
      })
      return
    }

    const runBlock: AgentRunBlock | undefined = r.klass === 'chat' ? undefined : {
      id: 'pending', kind: r.klass === 'ops' ? 'ops' : r.klass === 'browser' ? 'browser' : r.klass === 'research' ? 'research' : 'coding',
      executionMode,
      title: 'Agent run', model: MODEL_LABEL[r.modelKey], harness: HARNESS_LABEL[r.harnessKey], runtime: RUNTIME_LABEL[r.runtimeKey],
      statusText: 'Planning', done: false, tools: [], plan: [], artifacts: [],
    }
    const placeholder = appendMessage({
      chatId: cid, role: 'assistant', text: '',
      routingNote: `Auto · ${MODEL_LABEL[r.modelKey]} · ${HARNESS_LABEL[r.harnessKey]} · ${RUNTIME_LABEL[r.runtimeKey]}`,
      run: runBlock,
    })

    if (services?.runtime) {
      try {
        const started = await services.runtime.startRun({
          projectId: project.id,
          threadId: cid,
          task: prompt,
          agentId,
          providerSessionId: chat?.continuation?.sessionId,
          providerSessionMode: chat?.continuation ? chat.continuation.mode ?? 'resume' : undefined,
          providerTurnId: chat?.continuation?.mode === 'fork' ? chat.continuation.checkpointId : undefined,
          modelKey: modelOv === 'auto' && usesNativeCliRouter ? 'auto' : modelOv === 'auto' ? defaultModel : modelOv,
          modelId: openRouterModelId || undefined,
          harnessKey: harnessOv === 'auto' ? undefined : harnessOv,
          providerKey: providerOv === 'auto' ? undefined : providerOv,
          runtimeKey: runtimeOv === 'auto' ? defaultRuntime : runtimeOv,
          executionMode,
          capabilityIds: [...tools],
          repo: repositoryPath,
          approvalId,
          reviewProviderKey: defaults?.reviewProviderKey === 'auto' ? undefined : defaults?.reviewProviderKey,
        })
        const mode = started.mode ?? 'mock'
        const isMockMode = mode === 'mock' || mode === 'mock_with_repo'
        const actualModel = started.route?.modelKey ?? r.modelKey
        const actualHarness = started.route?.harnessKey ?? r.harnessKey
        const actualRuntime = started.route?.runtimeKey ?? r.runtimeKey
        const actualProvider = started.route?.providerKey ?? providerKey
        const actualModelLabel = routedModelLabel(started.route, r.modelKey)
        const actualHarnessLabel = routedHarnessLabel(started.route, r.harnessKey)
        const providerNote = actualHarness === 'coding' && actualProvider && actualProvider !== 'auto' && actualProvider !== 'custom'
          ? ` · ${PROVIDER_LABEL[actualProvider]}`
          : ''
        updateMessage(placeholder.id, {
          routingNote: `${started.route ? 'Server' : 'Auto'} · ${actualModelLabel} · ${HARNESS_LABEL[actualHarness]}${providerNote} · ${RUNTIME_LABEL[actualRuntime]}`,
        })
        // Keep the composer pill consistent with what the server actually ran.
        if (started.route) {
          setRoute((prev) => ({ ...prev, modelKey: actualModel, harnessKey: actualHarness, runtimeKey: actualRuntime }))
          if (started.route.providerKey) setProviderKey(started.route.providerKey)
        }

        if (isMockMode) {
          // Local mock runtime: the simulation IS the event source.
          await simulateAgentRun(prompt, r, (run: AgentRunBlock) => {
            updateMessage(placeholder.id, { text: run.output ?? '', run: { ...run, id: started.runId, executionMode } })
            if (run.tools.length) {
              const last = run.tools[run.tools.length - 1]!
              setActivity((a) => a.some((x) => x.title === last.name) ? a : [...a, { title: last.name, sub: last.output, t: last.duration }])
            }
          })
          setActivity((a) => [...a, { title: 'Run completed', sub: 'Artifacts ready for review', kind: 'info', t: 'done' }])
          return
        }

        // Real runtime (OpenSaddle simulated/safe_builtin/real_cli): build the
        // run card entirely from live session events.
        let liveRun: AgentRunBlock = {
          id: started.runId, kind: r.klass === 'ops' ? 'ops' : r.klass === 'browser' ? 'browser' : r.klass === 'research' ? 'research' : 'coding',
          executionMode,
          providerKey: actualProvider,
          title: 'Agent run', model: actualModelLabel, harness: actualHarnessLabel, runtime: RUNTIME_LABEL[actualRuntime],
          statusText: mode.replace('_', ' '), done: false, tools: [], plan: [], artifacts: [],
          cost: started.route?.cost ?? r.cost,
        }
        if (runBlock) updateMessage(placeholder.id, { run: liveRun })
        runRegistry.track({
          runId: started.runId,
          threadId: cid,
          messageId: placeholder.id,
          initialRun: liveRun,
          initialText: placeholder.text,
        })
        return
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        updateMessage(placeholder.id, runBlock
          ? {
            text: `I couldn’t start the coding agent because its execution environment is unavailable. ${reason}`,
            run: { ...runBlock, statusText: reason, done: true },
          }
          : { text: `OpenSaddle could not complete this message: ${reason}` })
        setActivity((a) => [...a, { title: 'Run rejected', sub: reason, kind: 'error', t: 'now' }])
        toast('Run failed', reason)
        return
      }
    }

    await simulateAgentRun(prompt, r, (run: AgentRunBlock) => {
      updateMessage(placeholder.id, { text: run.output ?? '', run })
      if (run.tools.length) {
        const last = run.tools[run.tools.length - 1]!
        setActivity((a) => {
          if (a.some((x) => x.title === last.name)) return a
          return [...a, { title: last.name, sub: last.output, t: last.duration }]
        })
      }
    })
    setActivity((a) => [...a, { title: 'Run completed', sub: 'Artifacts ready for review', kind: 'info', t: 'done' }])
  }

  const savePromptDecision = async (
    request: PromptPermission,
    effect: 'allow' | 'deny',
    scope: PromptPermissionScope,
  ) => {
    if (!chat) throw new Error('A task is required before saving a permission')
    const persistedScope: NonNullable<PermissionGrant['scope']> = scope === 'chat'
      ? 'thread'
      : scope === 'always'
        ? 'organization'
        : scope
    const scopeId = persistedScope === 'organization'
      ? 'org-default'
      : persistedScope === 'project'
        ? project.id
        : chat.id
    return await upsertPermissionGrant({
      principalKind: 'user',
      principalId: data.currentUserId,
      resourceKind: request.resourceKind,
      resourceId: request.resourceId,
      action: request.action,
      effect,
      inheritance: 'direct',
      scope: persistedScope,
      scopeId,
      usesRemaining: persistedScope === 'once' ? 1 : undefined,
      createdBy: data.currentUserId,
    })
  }

  const grantPerm = async () => {
    const request = perm
    if (!request || !chat) return
    setPerm(null)
    let grant: PermissionGrant
    try {
      grant = await savePromptDecision(request, 'allow', permScope)
      if (grant.scope === 'once') grant = await consumePermissionGrant(grant.id)
    } catch (error) {
      toast('Could not save permission', error instanceof Error ? error.message : String(error))
      setPerm(request)
      return
    }
    let approvalId: string | undefined
    const execution = chat ? evaluatePermissions(data.permissionGrants, {
      userId: data.currentUserId,
      agentId: chat.agentId,
      resourceKind: 'project',
      resourceId: project.id,
      action: 'execute',
    }) : null
    if (execution?.approvalRequired && services?.runtime.requestApproval && chat) {
      try {
        const approval = await services.runtime.requestApproval({
          projectId: project.id,
          agentId: chat.agentId,
          action: 'execute',
        })
        approvalId = approval.id
        if (approval.status === 'pending') {
          if (!services.runtime.resolveApproval) throw new Error('Approval is waiting for an authorized reviewer')
          await services.runtime.resolveApproval(approval.id, true)
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        toast('Approval pending', reason)
        setActivity((a) => [...a, { title: 'Approval requested', sub: reason, kind: 'info', t: 'now' }])
        return
      }
    }
    toast('Access granted', `${request.resource} · ${permScope}`)
    setActivity((a) => [...a, {
      title: 'Permission granted',
      sub: `${request.resource} · ${permScope}${grant.consumedAt ? ' · consumed' : ''}`,
      kind: 'info',
      t: 'now',
    }])
    let r: RouteDecision
    try {
      r = await resolveRoute(pending)
    } catch (error) {
      toast('Could not choose a ready harness', error instanceof Error ? error.message : String(error))
      return
    }
    await runAgent(pending, r, chat.id, approvalId)
  }

  const denyPromptPermission = async (persist: boolean) => {
    const request = perm
    if (!request || !chat) return
    setPerm(null)
    const scope: PromptPermissionScope = persist ? permScope : 'once'
    try {
      let grant = await savePromptDecision(request, 'deny', scope)
      if (grant.scope === 'once') grant = await consumePermissionGrant(grant.id)
      appendMessage({
        chatId: chat.id,
        role: 'assistant',
        text: '',
        lightHtml: `<p>The capability <strong>${request.resource}</strong> was denied${persist ? ` for this ${scope}` : ' once'}, so I paused.</p>`,
        routingNote: `Permission denied · ${grant.id}`,
      })
      toast(persist ? 'Deny policy saved' : 'Access denied', `${request.resource} · ${scope}`)
      setActivity((items) => [...items, {
        title: 'Permission denied',
        sub: `${request.resource} · ${scope}${grant.consumedAt ? ' · consumed' : ''}`,
        kind: 'error',
        t: 'now',
      }])
    } catch (error) {
      toast('Could not save denial', error instanceof Error ? error.message : String(error))
      setPerm(request)
    }
  }

  const starters = [
    { icon: 'search', title: 'Explore and understand', sub: 'Knowledge + architecture', prompt: 'Explore this project and explain how the model router, tool permissions, and runtimes fit together.' },
    { icon: 'tools', title: 'Build a new feature', sub: 'Code in an isolated runtime', prompt: DEMO_FLOWS[0].prompt },
    { icon: 'review', title: 'Review code', sub: 'GitHub + coding harness', prompt: 'Review the latest GitHub pull requests and suggest safe changes.' },
    { icon: 'bug', title: 'Fix issues', sub: 'Logs + cloud runtime', prompt: 'Investigate the failed cloud task and fix the issue without changing production data.' },
  ]
  const changedFiles = messages.flatMap((message) => message.run?.artifacts.flatMap((artifact) => artifact.diff ?? []) ?? [])
  const latestRunChangePaths = [...new Set(latestRun?.artifacts.flatMap((artifact) =>
    artifact.diff?.map((file) => file.path) ?? []) ?? [])]
  const verificationChecks = messages.flatMap((message) => message.run?.artifacts
    .filter((artifact) =>
      artifact.type === 'table'
      && artifact.table
      && artifact.title.toLowerCase().includes('verification'))
    .flatMap((artifact) => artifact.table?.rows ?? []) ?? [])
  const failedChecks = verificationChecks.filter((check) => check[1]?.toLowerCase() !== 'pass')
  const inspectorAttention = selectInspectorAttention({
    run: latestRun,
    failedChecks: failedChecks.map((check) => `${check[0] ?? 'Check'}:${check[1] ?? 'fail'}`),
    changedPaths: [...new Set(changedFiles.map((file) => file.path))].sort(),
  })
  useEffect(() => {
    if (!chat || !inspectorAttention || inspectorAttention.key === inspectorAttentionKey.current) return
    inspectorAttentionKey.current = inspectorAttention.key
    setInspector(true)
    setItab(inspectorAttention.tab)
    writeThreadInspectorState(chat.id, {
      open: true,
      tab: inspectorAttention.tab,
      width: inspectorWidthRef.current,
      lastAttentionKey: inspectorAttention.key,
    })
  }, [chat?.id, inspectorAttention?.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const artifactAdditions = changedFiles.reduce((total, file) => total + file.add, 0)
  const artifactDeletions = changedFiles.reduce((total, file) => total + file.del, 0)
  const projectSources = data.sources.filter((source) => source.projectId === project.id)
  const projectSessions = data.agentSessions.filter((session) => session.projectId === project.id)
  const activeEnvironment = data.environments.find((environment) =>
    latestRun
      ? RUNTIME_LABEL[environment.kind] === latestRun.runtime
      : environment.kind === route.runtimeKey,
  )
  const repository = projectSources.find((source) => source.kind === 'github')
  const repositoryPath = repository?.folderPath ?? project.local?.rootPath
  const relationEvents = managedRuns.flatMap((managed) => managed.lastEvent ? [managed.lastEvent] : [])
  const childRuns = rootRun ? selectRelatedRuns({
    parentRunId: rootRun.id,
    runs: [
      ...Object.values(runRegistry.runs),
      ...messages.filter((message) => message.run?.parentRunId).map((message) => ({
        id: message.run!.id,
        parentRunId: message.run!.parentRunId,
        run: message.run,
      })),
    ],
    events: relationEvents,
  }).filter((child) => !/^Queued follow-up$/i.test(child.title)) : []
  const usedSources = latestRun ? selectUsedRunSources({
    runId: latestRun.id,
    events: relationEvents,
    sources: projectSources,
    relatedRunIds: childRuns.map((child) => child.id),
    explicitSources: latestRun.sources?.map((source) => ({
      id: source.id,
      name: source.label,
      kind: source.kind,
      detail: source.detail,
    })),
  }) : []
  const additions = gitStatus?.additions ?? artifactAdditions
  const deletions = gitStatus?.deletions ?? artifactDeletions
  const defaultPullRequestBase = repository?.branch ?? 'main'

  useEffect(() => {
    const repo = repositoryPath
    const client = services?.runtime
    if (!repo || !client?.gitStatus || !services?.controlPlane.connected) {
      setGitStatus(null)
      return
    }
    let cancelled = false
    const refresh = () => {
      void client.gitStatus!(project.id, repo)
        .then((status) => {
          if (cancelled) return
          setGitStatus(status)
          setGitError('')
        })
        .catch((error) => {
          if (!cancelled) setGitError(error instanceof Error ? error.message : String(error))
        })
    }
    refresh()
    const timer = window.setInterval(refresh, latestRun && !latestRun.done ? 1_500 : 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [latestRun?.done, project.id, repositoryPath, services])

  const chooseRepository = async () => {
    if (!repository) {
      toast('Connect a Git source first', 'Add a GitHub repository to this project before selecting its local checkout.')
      return
    }
    if (!window.opensaddle?.pickRepository) {
      setRepositoryDraft(repository.folderPath ?? '')
      setRepositoryEditorOpen(true)
      return
    }
    const selected = await window.opensaddle.pickRepository()
    if (!selected) return
    updateSource(repository.id, { folderPath: selected })
    toast('Repository selected', selected)
  }

  const saveRepositoryPath = () => {
    const selected = repositoryDraft.trim()
    if (!repository || !selected) return
    updateSource(repository.id, { folderPath: selected })
    setRepositoryEditorOpen(false)
    toast('Repository selected', selected)
  }

  const createBranch = async () => {
    const repo = repositoryPath
    const client = services?.runtime
    const branch = branchName.trim()
    if (!repo || !branch || !client?.gitCreateBranch) return
    setGitBusy(true)
    setGitError('')
    try {
      let approvalId: string | undefined
      try {
        const result = await client.gitCreateBranch({ projectId: project.id, repo, branch })
        toast('Branch created', result.branch)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!/approval/i.test(reason) || !client.requestApproval || !client.resolveApproval) throw error
        const approval = await client.requestApproval({ projectId: project.id, action: 'write' })
        await client.resolveApproval(approval.id, true)
        approvalId = approval.id
        const result = await client.gitCreateBranch({ projectId: project.id, repo, branch, approvalId })
        toast('Branch created', result.branch)
      }
      setGitAction(null)
      setBranchName('')
      setActivity((items) => [...items, {
        title: 'Branch created',
        sub: branch,
        kind: 'info',
        t: 'now',
      }])
      setGitStatus(await client.gitStatus?.(project.id, repo) ?? null)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setGitError(reason)
      toast('Create branch failed', reason)
    } finally {
      setGitBusy(false)
    }
  }

  const commitChanges = async (message: string, paths: string[]) => {
    const repo = repositoryPath
    const client = services?.runtime
    if (!repo || !client?.gitCommit) return void chooseRepository()
    const trimmedMessage = message.trim()
    if (!trimmedMessage || !paths.length) return
    setGitBusy(true)
    try {
      let approvalId: string | undefined
      try {
        const result = await client.gitCommit({ projectId: project.id, repo, message: trimmedMessage, paths })
        toast('Changes committed', result.commit.slice(0, 10))
        setActivity((items) => [...items, {
          title: 'Changes committed',
          sub: `${result.commit.slice(0, 10)} · ${trimmedMessage}`,
          kind: 'info',
          t: 'now',
        }])
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!/approval/i.test(reason) || !client.requestApproval || !client.resolveApproval) throw error
        const approval = await client.requestApproval({ projectId: project.id, action: 'write' })
        await client.resolveApproval(approval.id, true)
        approvalId = approval.id
        const result = await client.gitCommit({ projectId: project.id, repo, message: trimmedMessage, paths, approvalId })
        toast('Changes committed', result.commit.slice(0, 10))
        setActivity((items) => [...items, {
          title: 'Changes committed',
          sub: `${result.commit.slice(0, 10)} · ${trimmedMessage}`,
          kind: 'info',
          t: 'now',
        }])
      }
      setGitAction(null)
      setCommitMessage('')
      setCommitPaths([])
      setGitStatus(await client.gitStatus?.(project.id, repo) ?? null)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setGitError(reason)
      toast('Commit failed', reason)
    } finally {
      setGitBusy(false)
    }
  }

  const pushChanges = async () => {
    const repo = repositoryPath
    const client = services?.runtime
    if (!repo || !client?.gitPush || !client.requestApproval || !client.resolveApproval) return void chooseRepository()
    setGitBusy(true)
    try {
      const approval = await client.requestApproval({ projectId: project.id, action: 'push' })
      await client.resolveApproval(approval.id, true)
      const result = await client.gitPush({
        projectId: project.id,
        repo,
        remote: gitStatus?.upstream?.split('/')[0] ?? 'origin',
        branch: gitStatus?.branch ?? undefined,
        approvalId: approval.id,
      })
      toast('Branch pushed', `${result.remote}/${result.branch}`)
      setActivity((items) => [...items, {
        title: 'Branch pushed',
        sub: `${result.remote}/${result.branch}`,
        kind: 'info',
        t: 'now',
      }])
      setGitAction(null)
      setGitStatus(await client.gitStatus?.(project.id, repo) ?? null)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setGitError(reason)
      toast('Push failed', reason)
    } finally {
      setGitBusy(false)
    }
  }

  const createPullRequest = async () => {
    const repo = repositoryPath
    const client = services?.runtime
    const branch = gitStatus?.branch
    if (
      !repo
      || !branch
      || !client?.gitCreatePullRequest
      || !client.requestApproval
      || !client.resolveApproval
      || !pullRequestTitle.trim()
      || !pullRequestBase.trim()
    ) return
    setGitBusy(true)
    setGitError('')
    try {
      const approval = await client.requestApproval({ projectId: project.id, action: 'push' })
      await client.resolveApproval(approval.id, true)
      const result = await client.gitCreatePullRequest({
        projectId: project.id,
        repo,
        title: pullRequestTitle.trim(),
        body: pullRequestBody.trim(),
        base: pullRequestBase.trim(),
        head: branch,
        draft: pullRequestDraft,
        approvalId: approval.id,
      })
      setPullRequestResult({ number: result.number, url: result.url, title: result.title })
      setGitAction(null)
      setActivity((items) => [...items, {
        title: `Pull request #${result.number} created`,
        sub: `${result.head} → ${result.base}`,
        kind: 'info',
        t: 'now',
      }])
      toast(`Pull request #${result.number} created`, result.title)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      setGitError(reason)
      toast('Pull request failed', reason)
    } finally {
      setGitBusy(false)
    }
  }

  const compareBranch = async () => {
    const repo = repositoryPath
    const client = services?.runtime
    if (!repo || !client?.gitCompare) return void chooseRepository()
    setGitBusy(true)
    try {
      const comparison = await client.gitCompare(project.id, repo, gitStatus?.upstream ?? repository?.branch ?? 'main')
      setGitComparison(comparison)
      selectInspectorTab('changes')
      toast('Branch comparison ready', `${comparison.files.length} files · +${comparison.additions} −${comparison.deletions}`)
      setActivity((items) => [...items, {
        title: 'Branch comparison ready',
        sub: `${comparison.base}…${comparison.head} · ${comparison.files.length} files`,
        kind: 'info',
        t: 'now',
      }])
    } catch (error) {
      toast('Compare failed', error instanceof Error ? error.message : String(error))
    } finally {
      setGitBusy(false)
    }
  }

  const delegateSubtask = async (requestedTask?: string) => {
    if (!rootRun || !services?.runtime || !chat) {
      toast('Start a run first', 'Subtasks need a parent run in this thread.')
      return
    }
    const task = requestedTask?.trim()
    if (!task) {
      setDelegateEditorOpen(true)
      return
    }
    const requestedRoute = deriveRoute(task, data.settings.routingPref)
    const initial: AgentRunBlock = {
      id: 'pending',
      parentRunId: rootRun.id,
      executionMode,
      kind: requestedRoute.klass === 'research' ? 'research' : requestedRoute.klass === 'browser' ? 'browser' : 'coding',
      title: `Subagent · ${task.slice(0, 52)}`,
      model: MODEL_LABEL[requestedRoute.modelKey],
      harness: HARNESS_LABEL[requestedRoute.harnessKey],
      runtime: RUNTIME_LABEL[requestedRoute.runtimeKey],
      statusText: 'Starting delegated run',
      done: false,
      tools: [],
      plan: [],
      artifacts: [],
    }
    const message = appendMessage({
      chatId: chat.id,
      role: 'assistant',
      text: `Delegated subtask: ${task}`,
      routingNote: `Subagent · ${initial.model} · ${initial.runtime}`,
      run: initial,
    })
    try {
      const started = await services.runtime.startRun({
        projectId: project.id,
        task,
        agentId: chat.agentId,
        parentRunId: rootRun.id,
        sourceIds: usedSources.map((source) => source.id),
        executionMode,
        capabilityIds: [...tools],
        repo: repositoryPath,
      })
      const child: AgentRunBlock = {
        ...initial,
        id: started.runId,
        model: MODEL_LABEL[started.route?.modelKey ?? requestedRoute.modelKey],
        harness: HARNESS_LABEL[started.route?.harnessKey ?? requestedRoute.harnessKey],
        runtime: RUNTIME_LABEL[started.route?.runtimeKey ?? requestedRoute.runtimeKey],
        statusText: started.mode?.replaceAll('_', ' ') ?? 'Queued',
      }
      updateMessage(message.id, { run: child })
      if (started.mode === 'mock' || started.mode === 'mock_with_repo') {
        await simulateAgentRun(task, requestedRoute, (run) => {
          updateMessage(message.id, { text: run.output ?? '', run: { ...run, id: started.runId, parentRunId: rootRun.id, title: initial.title, executionMode } })
        })
      } else {
        runRegistry.track({
          runId: started.runId,
          threadId: chat.id,
          messageId: message.id,
          initialRun: child,
          initialText: message.text,
          parentRunId: rootRun.id,
        })
      }
      setDelegateDraft('')
      setDelegateEditorOpen(false)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      updateMessage(message.id, {
        text: `The delegated run could not start. ${reason}`,
        run: { ...initial, statusText: `Failed · ${reason}`, done: true },
      })
      toast('Subagent failed to start', reason)
    }
  }

  if (!chat) return <div className="content-page"><div className="empty-state"><h3>No chat selected</h3></div></div>

  return (
    <section className="page active" style={{ height: '100%' }}>
      <div
        className={`chat-shell ${inspector ? 'inspector-open' : ''}`}
        style={{ '--inspector-w': `${inspectorWidth}px` } as React.CSSProperties}
      >
        <div className="chat-main">
          {!!messages.length && (
            <div className="tf-thread-toolbar">
              <div className="tf-density-control" aria-label="Activity detail">
                {(['summary', 'normal', 'verbose'] as const).map((item) => (
                  <button key={item} className={density === item ? 'active' : ''} onClick={() => setDensity(item)}>
                    {item[0]!.toUpperCase() + item.slice(1)}
                  </button>
                ))}
              </div>
              {latestRun?.artifacts.some((artifact) => artifact.type === 'diff') && (
                <button className="tf-toolbar-button" onClick={() => openInspector('changes')}>
                  <Icon name="git" className="icon xs" />
                  {latestRun.artifacts.flatMap((artifact) => artifact.diff ?? []).length} changes
                </button>
              )}
              <button className="tf-toolbar-button" onClick={() => openInspector()}><Icon name="panel" className="icon xs" />Details</button>
            </div>
          )}
          <div className="chat-scroll" ref={transcript.containerRef} onScroll={transcript.onScroll}>
            {!messages.length && (
              <div className="welcome">
                <div className="welcome-logo"><Icon name="saddle" className="icon xl" /></div>
                <h1>What should we build?</h1>
                <div className="starter-grid">
                  {starters.map((s) => (
                    <button key={s.title} className="starter-card" onClick={() => send(s.prompt)}>
                      <Icon name={s.icon} className="icon starter-icon" /><strong>{s.title}</strong><span>{s.sub}</span>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 18, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                  {DEMO_FLOWS.map((f) => (
                    <button key={f.id} className="tiny-btn" onClick={() => {
                      const proj = data.projects.find((p) => p.name === f.projectHint)
                      if (proj) setActiveProject(proj.id)
                      const c = createChat(proj?.id ?? data.activeProjectId, f.title)
                      nav(`/chat/${c.id}`)
                      sessionStorage.setItem('opensaddle-pending-prompt', JSON.stringify({ chatId: c.id, prompt: f.prompt }))
                    }}>Try {f.title}</button>
                  ))}
                </div>
              </div>
            )}

            <div className={`messages ${messages.length ? 'active' : ''}`}>
              {messages.map((m, messageIndex) => (
                <MessageView key={m.id} m={m} onHunk={async (filePath, hunkIndex, hid, st) => {
                  try {
                    if (m.run?.id && m.run.id !== 'pending' && services?.runtime.resolveDiff) {
                      await services.runtime.resolveDiff(m.run.id, filePath, hunkIndex, st)
                    }
                    updateHunk(m.id, hid, st)
                    const reviewMode = m.run?.executionMode === 'review'
                    toast(
                      st === 'accepted'
                        ? reviewMode ? 'Applied to project' : 'Hunk accepted'
                        : reviewMode ? 'Review change discarded' : 'Hunk reverted',
                      filePath,
                    )
                  } catch (error) {
                    toast('Diff update failed', error instanceof Error ? error.message : String(error))
                  }
                }} toast={toast} files={services?.files} density={density}
                onRetry={() => {
                  const prompt = [...messages.slice(0, messageIndex + (m.role === 'user' ? 1 : 0))]
                    .reverse()
                    .find((message) => message.role === 'user')
                  if (prompt) void send(prompt.text)
                }}
                onBranch={() => {
                  const branched = branchChatFromMessage(chat.id, m.id)
                  if (branched) {
                    nav(`/chat/${branched.id}`)
                    toast('Thread branched', `Started from this ${m.role === 'user' ? 'request' : 'response'}.`)
                  }
                }} />
              ))}
            </div>
          </div>

          <JumpToLatest
            visible={!transcript.isAtLatest}
            unreadCount={transcript.unreadCount}
            busy={Boolean(latestRun && !latestRun.done)}
            onJump={() => transcript.jumpToLatest()}
          />

          <div className="composer-wrap">
            {!!queuedManagedRuns.length && (
              <div className="queued-followups" aria-label="Queued follow-ups">
                <div className="queued-followups-head">
                  <span><Icon name="clock" className="icon xs" />Up next</span>
                  <span>{queuedManagedRuns.length}</span>
                </div>
                {queuedManagedRuns.map((managed, index) => {
                  const queuedPrompt = managed.run.queuedTask ?? 'Queued follow-up'
                  const editing = queueEditingRunId === managed.runId
                  const busy = queueBusyRunId === managed.runId
                  return (
                    <div className="queued-followup" key={managed.runId}>
                      <span className="queued-followup-position">{index + 1}</span>
                      {editing ? (
                        <textarea
                          aria-label={`Edit queued follow-up ${index + 1}`}
                          value={queueDraft}
                          onChange={(event) => setQueueDraft(event.target.value)}
                          rows={2}
                          maxLength={20_000}
                        />
                      ) : (
                        <span className="queued-followup-text">{queuedPrompt}</span>
                      )}
                      <span className="queued-followup-actions">
                        {editing ? (
                          <>
                            <button type="button" disabled={busy} onClick={() => setQueueEditingRunId(null)}>Cancel</button>
                            <button
                              type="button"
                              disabled={busy || !queueDraft.trim()}
                              onClick={() => {
                                const revised = queueDraft.trim()
                                if (!revised) return
                                setQueueBusyRunId(managed.runId)
                                void runRegistry.updateQueue(managed.runId, revised)
                                  .then(() => {
                                    if (managed.run.queuedPromptMessageId) {
                                      updateMessage(managed.run.queuedPromptMessageId, { text: revised })
                                    }
                                    setQueueEditingRunId(null)
                                    toast('Follow-up updated', 'The durable queue will use the revised prompt.')
                                  })
                                  .catch((error) => toast('Queue update failed', error instanceof Error ? error.message : String(error)))
                                  .finally(() => setQueueBusyRunId(null))
                              }}
                            >
                              {busy ? 'Saving…' : 'Save'}
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setQueueDraft(queuedPrompt)
                                setQueueEditingRunId(managed.runId)
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setQueueBusyRunId(managed.runId)
                                void runRegistry.stop(managed.runId)
                                  .then(() => toast('Follow-up removed', 'The queued turn will not run.'))
                                  .catch((error) => toast('Could not remove follow-up', error instanceof Error ? error.message : String(error)))
                                  .finally(() => setQueueBusyRunId(null))
                              }}
                            >
                              Remove
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
            <div className="composer" id="composer">
              <div className="composer-context">
                <span className="context-chip"><Icon name="folder" className="icon sm" />{project.name}</span>
                <button className="context-gear" title={`${project.name} settings`} aria-label={`${project.name} settings`} onClick={() => nav(`/project/${project.id}`)}>
                  <Icon name="settings" className="icon sm" />
                </button>
                <button className="context-chip branch context-action" title="Change runtime" onClick={() => { setToolsOpen(false); setRouteOpen(true); refreshRoute(text || pending || 'build a feature') }}><Icon name="vm" className="icon sm" />{RUNTIME_LABEL[route.runtimeKey].split(' ')[0]}<Icon name="chevron" className="icon xs" /></button>
                <span className="composer-context-hint">Choose a runtime when you need one</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); refreshRoute(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                aria-label="Message"
                placeholder={activeManagedRun
                  ? activeSendMode === 'steer' && steerableRun
                    ? 'Steer the active Codex run'
                    : 'Queue a follow-up'
                  : 'Message your agent'}
                rows={1}
              />
              <div className="composer-bottom">
                <input
                  ref={attachRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void (async () => {
                      if (!services?.files?.importFiles || !e.target.files?.length) {
                        toast('Attach unavailable', 'File storage is not ready yet.')
                        return
                      }
                      const paths = await services.files.importFiles(e.target.files)
                      toast('Attached to workspace', `${paths.length} file(s) → Files`)
                      appendMessage({
                        chatId: chat.id, role: 'user',
                        text: `Attached ${paths.length} file(s): ${paths.join(', ')}`,
                      })
                      e.target.value = ''
                    })()
                  }}
                />
                <button className="composer-btn composer-icon-btn" title="Attach files (stored in workspace Files)" aria-label="Attach files" onClick={() => attachRef.current?.click()}><Icon name="paperclip" className="icon sm" /></button>
                <button className="composer-btn options-btn" onClick={() => { setRouteOpen(false); setToolsOpen((v) => !v) }}><Icon name="tools" className="icon sm" />Options</button>
                {chat.continuation && (
                  <span
                    className="composer-continuation-chip"
                    title={`Native session ${chat.continuation.sessionId}`}
                  >
                    <HarnessVisual id={chat.continuation.provider} className="provider-logo xs" />
                    {continuationAction} {PROVIDER_LABEL[chat.continuation.provider]}
                  </span>
                )}
                {activeManagedRun && (
                  <span className="composer-active-mode" aria-label="Active turn message behavior">
                    {steerableRun && (
                      <button
                        className={activeSendMode === 'steer' ? 'active' : ''}
                        title="Guide the active Codex turn immediately"
                        onClick={() => setActiveSendMode('steer')}
                      >
                        <Icon name="arrow" className="icon xs" />
                        Steer
                      </button>
                    )}
                    <button
                      className={activeSendMode === 'queue' || !steerableRun ? 'active' : ''}
                      title="Run this message after the active turn finishes"
                      onClick={() => setActiveSendMode('queue')}
                    >
                      <Icon name="clock" className="icon xs" />
                      Queue{queuedManagedRuns.length ? ` ${queuedManagedRuns.length}` : ''}
                    </button>
                  </span>
                )}
                <button
                  className={`composer-btn execution-mode-chip ${executionMode}`}
                  title="Choose per-task access mode"
                  onClick={() => { setToolsOpen(false); setRouteOpen(true) }}
                >
                  <Icon name={EXECUTION_MODES.find((mode) => mode.id === executionMode)?.icon ?? 'shield'} className="icon sm" />
                  {EXECUTION_MODES.find((mode) => mode.id === executionMode)?.label}
                </button>
                <span className="composer-spacer" />
                <button className={`route-pill ${auto ? '' : 'manual'}`} title={serverRouting ? 'Routed by the OpenSaddle control plane' : 'Routed locally (mock)'} onClick={() => { setToolsOpen(false); setRouteOpen((v) => !v); refreshRoute(text || pending || 'build a feature') }}>
                  {auto && <span className="pulse" />}
                  <HarnessVisual id={harnessPickerOption.id} className="provider-logo xs" />
                  <span className="route-seg">{harnessPickerOption.shortLabel}</span>
                  <span className="route-model-label">{modelPickerOption.label}</span>
                  <Icon name="chevron" className="icon sm" />
                </button>
                <button
                  className="send-btn"
                  title={activeManagedRun
                    ? activeSendMode === 'steer' && steerableRun ? 'Steer active run' : 'Queue follow-up'
                    : 'Send message'}
                  onClick={() => void send()}
                >
                  <Icon name="arrow" className="icon sm" />
                </button>
              </div>

              {toolsOpen && (
                <div className="popover tools-popover open">
                  <div className="popover-title">Chat options</div>
                  <div className="popover-actions">
                    <button onClick={() => nav(`/permissions/${project.id}`)}><Icon name="shield" className="icon sm" /><span><strong>Scoped access</strong><small>Review project permissions</small></span></button>
                    <button onClick={() => openInspector()}><Icon name="panel" className="icon sm" /><span><strong>Run details</strong><small>Open the activity inspector</small></span></button>
                  </div>
                  <div className="popover-title popover-title-secondary">Available tools</div>
                  {TASK_CAPABILITIES.map((t) => {
                    const locked = lockedTaskCapabilities.includes(t)
                    return (
                      <button
                        key={t}
                        className={`tool-option ${tools.has(t) ? 'enabled' : ''}`}
                        disabled={locked}
                        title={locked
                          ? selectedPolicyControls === 'sandbox-only'
                            ? 'This harness exposes sandbox controls, not a separate switch for this capability.'
                            : 'This harness owns this capability through its provider-defined policy.'
                          : undefined}
                        onClick={() => {
                          const next = new Set(tools)
                          if (next.has(t)) next.delete(t); else next.add(t)
                          setTools(next)
                          toast(`${t} ${next.has(t) ? 'enabled' : 'disabled'}`, 'Applies to this chat.')
                        }}
                      >
                        <span className="tool-icon-wrap"><Icon name={t === 'Secure VM' ? 'vm' : t === 'Network' ? 'api' : t === 'Subagents' ? 'code' : 'globe'} /></span>
                        <span className="tool-copy"><strong>{t}</strong><small>{locked ? 'Controlled by the selected harness' : t === 'Browser' ? 'Browser and Chrome tools' : t === 'Network' ? 'Web fetch and search' : t === 'Secure VM' ? 'Provision external runtimes' : 'Delegate child runs'}</small></span>
                        <span className="check"><Icon name="check" className="icon sm" /></span>
                      </button>
                    )
                  })}
                </div>
              )}

              {routeOpen && (
                <div className="popover routing-popover open">
                  <div className="compact-route-head">
                    <div><strong>Run with</strong><span>{route.cost} estimated</span></div>
                    <div className="compact-route-actions">
                      <button
                        aria-label="Refresh harness status"
                        title="Check local CLI sign-in and model access again"
                        disabled={refreshingHarnesses}
                        onClick={() => {
                          setRefreshingHarnesses(true)
                          void refreshHarnessCapabilities()
                            .then(() => toast('Harness status refreshed', 'Local CLI access and models were checked again.'))
                            .catch((error: unknown) => toast('Harness refresh failed', error instanceof Error ? error.message : String(error)))
                            .finally(() => setRefreshingHarnesses(false))
                        }}
                      >
                        <Icon name="refresh" className={`icon sm ${refreshingHarnesses ? 'spin' : ''}`} />
                      </button>
                      <button aria-label="Close agent selector" onClick={() => setRouteOpen(false)}><Icon name="x" className="icon sm" /></button>
                    </div>
                  </div>

                  <div className="compact-route-section">
                    <span className="compact-route-label">Harness</span>
                    <div className="harness-quick-grid">
                      {liveHarnessOptions.map((option) => (
                        <button
                          key={option.id}
                          className={pickerProvider === option.id ? 'active' : ''}
                          disabled={option.available === false}
                          title={'reason' in option ? option.reason : option.detail}
                          onClick={() => {
                            setProviderOv(option.id)
                            setHarnessOv(option.id === 'auto' ? 'auto' : 'coding')
                            const nextCapability = harnessCapabilities.find((item) =>
                              item.id === (option.id === 'custom' ? activeCustomHarness?.id : option.id))
                            const controls = nextCapability?.capabilities.policyControls
                              ?? (option.id === 'auto' ? 'native' : 'provider-defined')
                            const required = capabilitiesRequiredByHarnessPolicy(controls)
                            if (required.length) {
                              setTools((current) => new Set([...current, ...required]))
                            }
                            const nextModels = MODEL_PICKER_OPTIONS[option.id] ?? MODEL_PICKER_OPTIONS.auto!
                            if (!nextModels.some((model) => model.id === modelOv)) setModelOv('auto')
                            setAuto(option.id === 'auto' && modelOv === 'auto')
                            setOpenRouterModelId('')
                          }}
                        >
                          <span className="quick-logo"><HarnessVisual id={option.id} /></span>
                          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                          <Icon name={option.available === false ? 'close' : 'check'} className="icon xs quick-check" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="compact-route-section model-section">
                    <span className="compact-route-label">Model <small>{pickerProvider === 'auto' ? 'chosen with the harness' : `for ${harnessPickerOption.label}`}</small></span>
                    <div className="model-quick-list">
                      {compatibleModelOptions.map((option) => (
                        <button
                          key={'nativeId' in option && option.nativeId ? option.nativeId : option.id}
                          className={(('nativeId' in option && option.nativeId)
                            ? openRouterModelId === option.nativeId
                            : !openRouterModelId && modelOv === option.id) ? 'active' : ''}
                          onClick={() => {
                            setModelOv(option.id)
                            setOpenRouterModelId('nativeId' in option ? option.nativeId : '')
                            setAuto(option.id === 'auto' && providerOv === 'auto' && harnessOv === 'auto')
                            refreshRoute(text || pending || 'build a feature')
                            setRouteOpen(false)
                          }}
                        >
                          <span className="quick-logo sm">{option.id === 'auto'
                            ? <HarnessVisual id={pickerProvider} />
                            : <ProviderLogo label={option.logoLabel} className="provider-logo" />}</span>
                          <strong>{option.label}</strong>
                          <small>{option.detail}</small>
                          <Icon name="check" className="icon xs quick-check" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="compact-route-section execution-mode-section">
                    <span className="compact-route-label">Access <small>for this task</small></span>
                    <div className="execution-mode-grid">
                      {EXECUTION_MODES.map((mode) => {
                        const disabled = mode.id === 'full-access' && !project.local
                        return (
                          <button
                            key={mode.id}
                            className={executionMode === mode.id ? 'active' : ''}
                            disabled={disabled}
                            title={disabled ? 'Full access is available only for local projects.' : mode.detail}
                            onClick={() => setExecutionMode(mode.id)}
                          >
                            <Icon name={mode.icon} className="icon sm" />
                            <span><strong>{mode.label}</strong><small>{mode.detail}</small></span>
                            <Icon name="check" className="icon xs quick-check" />
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  <details className="compact-route-advanced">
                    <summary><span>Advanced routing</span><Icon name="chevron" className="icon xs" /></summary>
                    <div className="compact-advanced-body">
                      <label>Task mode<select value={harnessOv} onChange={(e) => { setHarnessOv(e.target.value as Harness | 'auto'); setAuto(false); refreshRoute(text) }}><option value="auto">Auto</option><option value="chat">Chat</option><option value="research">Research</option><option value="coding">Coding</option><option value="browser">Browser</option></select></label>
                      <label>Runtime<select value={runtimeOv} onChange={(e) => { setRuntimeOv(e.target.value as RuntimeKind | 'auto'); setAuto(false); refreshRoute(text) }}><option value="auto">Auto routing</option>{runtimeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                      <label>Optimize<select value={data.settings.routingPref} onChange={(e) => { const value = e.target.value as typeof data.settings.routingPref; store.updateSettings({ routingPref: value }); setTimeout(() => refreshRoute(text || 'build'), 0) }}><option value="quality">Highest quality</option><option value="fast">Fastest</option><option value="cost">Lowest cost</option><option value="local">Keep data local</option><option value="enterprise">Enterprise models</option></select></label>
                      {services?.controlPlane.modelProvider === 'openrouter' && (
                        <label>OpenRouter model<select value={openRouterModelId} onChange={(e) => setOpenRouterModelId(e.target.value)}>
                          <option value="">Auto free router</option>
                          {freeModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                        </select></label>
                      )}
                    </div>
                  </details>
                </div>
              )}
            </div>
            <div className="composer-footnote">OpenSaddle can make mistakes. Tool calls remain subject to project permissions and audit policy.</div>
          </div>
        </div>

        <div
          className="resizer"
          role="separator"
          aria-label="Resize thread inspector"
          aria-orientation="vertical"
          aria-valuemin={260}
          aria-valuemax={520}
          aria-valuenow={inspectorWidth}
          tabIndex={0}
          onPointerDown={(event) => beginInspectorResize(event.clientX)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') resizeInspectorTo(inspectorWidth + 16)
            else if (event.key === 'ArrowRight') resizeInspectorTo(inspectorWidth - 16)
            else if (event.key === 'Home') resizeInspectorTo(260)
            else if (event.key === 'End') resizeInspectorTo(520)
            else return
            event.preventDefault()
          }}
        />
        <aside className="inspector">
          <div className="inspector-inner">
            <div className="inspector-header">
              <strong>{itab === 'overview' ? 'Current state' : itab[0]!.toUpperCase() + itab.slice(1)}</strong>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {itab !== 'overview' && <button className="tiny-btn" onClick={() => selectInspectorTab('overview')}>Back</button>}
                <button className="tiny-btn" onClick={() => { const n = branchChat(chat.id); if (n) { nav(`/chat/${n.id}`); toast('Chat forked', n.title) } }}>Fork</button>
                <button className="icon-btn" onClick={closeInspector}><Icon name="x" className="icon sm" /></button>
              </div>
            </div>
            {itab !== 'overview' && <div className="inspector-tabs">
              {[
                ['changes', 'Changes'],
                ['checks', 'Checks'],
                ['activity', 'Activity'],
                ['environment', 'Environment'],
                ['access', 'Access'],
              ].map(([key, label]) => (
                <button key={key} className={`itab ${itab === key ? 'active' : ''}`} onClick={() => selectInspectorTab(key as ThreadInspectorTab)}>{label}</button>
              ))}
            </div>}
            {itab === 'overview' && (
              <div className="ipanel active tf-state-rail">
                <section className="tf-state-card">
                  <div className="tf-state-heading"><span>Environment</span><Icon name="plus" className="icon sm" /></div>
                  <button className="tf-state-row" onClick={() => selectInspectorTab('changes')}>
                    <Icon name="git" className="icon sm" />
                    <span>Changes</span>
                    <strong className="tf-change-count"><i>+{additions}</i> <b>−{deletions}</b></strong>
                  </button>
                  <button className="tf-state-row" onClick={() => selectInspectorTab('checks')}>
                    <Icon name="check" className="icon sm" />
                    <span>Checks</span>
                    <small>{verificationChecks.length
                      ? failedChecks.length ? `${failedChecks.length} need attention` : `${verificationChecks.length} passed`
                      : 'Not run'}</small>
                  </button>
                  <button className="tf-state-row" onClick={() => selectInspectorTab('environment')}>
                    <Icon name="terminal" className="icon sm" />
                    <span>{latestRun?.runtime ?? activeEnvironment?.name ?? RUNTIME_LABEL[route.runtimeKey]}</span>
                    <small>{latestRun ? latestRunState : activeEnvironment?.status ?? 'Ready'}</small>
                  </button>
                  <div className="tf-state-row">
                    <Icon name="branch" className="icon sm" />
                    <span>{gitStatus?.branch ?? repository?.branch ?? 'main'}</span>
                    <small>{gitStatus ? `${gitStatus.ahead}↑ ${gitStatus.behind}↓` : repository?.status ?? 'local'}</small>
                  </div>
                  <button className="tf-state-row" disabled={!repositoryPath || !gitStatus?.branch || gitBusy || !services?.runtime.gitCreateBranch} onClick={() => {
                    setGitAction((current) => {
                      if (current === 'branch') return null
                      const source = chat.title === 'New task'
                        ? [...messages].reverse().find((message) => message.role === 'user')?.text ?? 'task'
                        : chat.title
                      const slug = source
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-|-$/g, '')
                        .slice(0, 48) || 'task'
                      setBranchName(`opensaddle/${slug}`)
                      return 'branch'
                    })
                    setGitError('')
                  }}>
                    <Icon name="plus" className="icon sm" />
                    <span>Create branch</span>
                    <small>From {gitStatus?.branch ?? 'current'}</small>
                  </button>
                  {gitAction === 'branch' && gitStatus?.branch && (
                    <form className="tf-state-inline-form tf-git-action" onSubmit={(event) => {
                      event.preventDefault()
                      void createBranch()
                    }}>
                      <label htmlFor="branch-name">New branch from {gitStatus.branch}</label>
                      <input
                        id="branch-name"
                        value={branchName}
                        onChange={(event) => setBranchName(event.target.value)}
                        placeholder="opensaddle/my-task"
                        autoFocus
                      />
                      <p>Uncommitted changes remain in the working tree when the branch is created.</p>
                      <div>
                        <button type="button" onClick={() => setGitAction(null)}>Cancel</button>
                        <button type="submit" disabled={!branchName.trim() || gitBusy}>{gitBusy ? 'Creating…' : 'Create branch'}</button>
                      </div>
                    </form>
                  )}
                  {!repository?.folderPath && repository && (
                    <button className="tf-state-row" onClick={() => void chooseRepository()}>
                      <Icon name="folder" className="icon sm" />
                      <span>Select local checkout</span>
                    </button>
                  )}
                  {repositoryEditorOpen && repository && (
                    <form className="tf-state-inline-form" onSubmit={(event) => { event.preventDefault(); saveRepositoryPath() }}>
                      <label htmlFor="repository-path">Local checkout path</label>
                      <input
                        id="repository-path"
                        value={repositoryDraft}
                        onChange={(event) => setRepositoryDraft(event.target.value)}
                        placeholder="/path/to/repository"
                        autoFocus
                      />
                      <div>
                        <button type="button" onClick={() => setRepositoryEditorOpen(false)}>Cancel</button>
                        <button type="submit" disabled={!repositoryDraft.trim()}>Connect</button>
                      </div>
                    </form>
                  )}
                  <button className="tf-state-row" disabled={!gitStatus || gitStatus.clean || gitBusy} onClick={() => {
                    setGitAction((current) => {
                      if (current === 'commit') return null
                      const available = gitStatus?.files.map((file) => file.path) ?? []
                      const taskPaths = latestRunChangePaths.filter((path) => available.includes(path))
                      setCommitPaths(taskPaths.length ? taskPaths : available)
                      return 'commit'
                    })
                    setGitError('')
                  }}>
                    <Icon name="activity" className="icon sm" />
                    <span>Commit changes</span>
                    <small>{gitBusy ? 'Working…' : gitStatus?.clean ? 'Clean' : gitStatus ? `${gitStatus.files.length} files` : 'Unavailable'}</small>
                  </button>
                  {gitAction === 'commit' && gitStatus && !gitStatus.clean && (
                    <form className="tf-state-inline-form tf-git-action" onSubmit={(event) => {
                      event.preventDefault()
                      void commitChanges(commitMessage, commitPaths)
                    }}>
                      <label htmlFor="commit-message">Commit {commitPaths.length} of {gitStatus.files.length} changed file{gitStatus.files.length === 1 ? '' : 's'}</label>
                      <input
                        id="commit-message"
                        value={commitMessage}
                        onChange={(event) => setCommitMessage(event.target.value)}
                        placeholder="Describe this change"
                        autoFocus
                      />
                      <div className="tf-git-file-actions">
                        <button type="button" onClick={() => setCommitPaths(gitStatus.files.map((file) => file.path))}>Select all</button>
                        <button type="button" onClick={() => setCommitPaths([])}>Clear</button>
                      </div>
                      <div className="tf-git-file-list" role="group" aria-label="Files to commit">
                        {gitStatus.files.map((file) => {
                          const checked = commitPaths.includes(file.path)
                          return (
                            <label key={file.path}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setCommitPaths((paths) =>
                                  checked ? paths.filter((path) => path !== file.path) : [...paths, file.path])}
                              />
                              <span>{file.path}</span>
                              <small>{file.untracked ? 'untracked' : file.staged ? 'staged' : file.modified ? 'modified' : file.worktree}</small>
                            </label>
                          )
                        })}
                      </div>
                      <p>Creates a commit on <strong>{gitStatus.branch}</strong>. Git hooks are not run by OpenSaddle.</p>
                      <div>
                        <button type="button" onClick={() => setGitAction(null)}>Cancel</button>
                        <button type="submit" disabled={!commitMessage.trim() || !commitPaths.length || gitBusy}>{gitBusy ? 'Committing…' : 'Commit'}</button>
                      </div>
                    </form>
                  )}
                  <button className="tf-state-row" disabled={!gitStatus?.ahead || gitBusy} onClick={() => {
                    setGitAction((current) => current === 'push' ? null : 'push')
                    setGitError('')
                  }}>
                    <Icon name="cloud" className="icon sm" />
                    <span>Push branch</span>
                    <small>{gitStatus?.ahead ? `${gitStatus.ahead} commit${gitStatus.ahead === 1 ? '' : 's'}` : 'Up to date'}</small>
                  </button>
                  {gitAction === 'push' && gitStatus?.ahead ? (
                    <form className="tf-state-inline-form tf-git-action" onSubmit={(event) => {
                      event.preventDefault()
                      void pushChanges()
                    }}>
                      <label>Push {gitStatus.ahead} commit{gitStatus.ahead === 1 ? '' : 's'}?</label>
                      <p>This updates <strong>{gitStatus.upstream ?? `origin/${gitStatus.branch}`}</strong> and requires explicit approval.</p>
                      <div>
                        <button type="button" onClick={() => setGitAction(null)}>Cancel</button>
                        <button type="submit" disabled={gitBusy}>{gitBusy ? 'Pushing…' : 'Approve & push'}</button>
                      </div>
                    </form>
                  ) : null}
                  <button
                    className="tf-state-row"
                    disabled={
                      !repositoryPath
                      || !gitStatus?.branch
                      || gitStatus.ahead > 0
                      || gitStatus.branch === defaultPullRequestBase
                      || gitBusy
                      || !services?.runtime.gitCreatePullRequest
                    }
                    onClick={() => {
                      setGitAction((current) => {
                        if (current === 'pull-request') return null
                        const latestUserPrompt = [...messages].reverse().find((message) => message.role === 'user')?.text.trim()
                        setPullRequestTitle(
                          chat.title !== 'New task'
                            ? chat.title
                            : latestUserPrompt?.split('\n')[0]?.slice(0, 120) || `Merge ${gitStatus?.branch ?? 'branch'}`,
                        )
                        const summary = latestRun?.output?.trim()
                        const checks = verificationChecks.map((check) => `- ${check[0]}: ${check[1] ?? check.at(-1)}`).join('\n')
                        setPullRequestBody([
                          '## Summary',
                          '',
                          summary || 'Changes prepared and reviewed in OpenSaddle.',
                          '',
                          '## Verification',
                          '',
                          checks || '- Not recorded',
                        ].join('\n'))
                        setPullRequestBase(defaultPullRequestBase)
                        return 'pull-request'
                      })
                      setGitError('')
                    }}
                  >
                    <Icon name="git" className="icon sm" />
                    <span>Create pull request</span>
                    <small>{gitStatus?.ahead
                      ? 'Push first'
                      : gitStatus?.branch === defaultPullRequestBase
                        ? `Create a branch from ${defaultPullRequestBase}`
                        : pullRequestResult ? `#${pullRequestResult.number}` : 'GitHub'}</small>
                  </button>
                  {gitAction === 'pull-request' && gitStatus?.branch && (
                    <form className="tf-state-inline-form tf-git-action" onSubmit={(event) => {
                      event.preventDefault()
                      void createPullRequest()
                    }}>
                      <label htmlFor="pull-request-title">Pull request title</label>
                      <input
                        id="pull-request-title"
                        value={pullRequestTitle}
                        onChange={(event) => setPullRequestTitle(event.target.value)}
                        autoFocus
                      />
                      <div className="tf-git-ref-grid">
                        <label>Base<input value={pullRequestBase} onChange={(event) => setPullRequestBase(event.target.value)} /></label>
                        <label>Head<input value={gitStatus.branch} readOnly /></label>
                      </div>
                      <label htmlFor="pull-request-body">Description</label>
                      <textarea
                        id="pull-request-body"
                        value={pullRequestBody}
                        onChange={(event) => setPullRequestBody(event.target.value)}
                        rows={6}
                      />
                      <label className="tf-git-draft-option">
                        <input type="checkbox" checked={pullRequestDraft} onChange={(event) => setPullRequestDraft(event.target.checked)} />
                        <span>Create as draft</span>
                      </label>
                      <p>Creates a GitHub pull request using your local <strong>gh</strong> login and requires explicit approval.</p>
                      <div>
                        <button type="button" onClick={() => setGitAction(null)}>Cancel</button>
                        <button
                          type="submit"
                          disabled={!pullRequestTitle.trim() || !pullRequestBase.trim() || pullRequestBase.trim() === gitStatus.branch || gitBusy}
                        >
                          {gitBusy ? 'Creating…' : 'Approve & create'}
                        </button>
                      </div>
                    </form>
                  )}
                  {pullRequestResult && (
                    <button className="tf-state-row tf-pr-result" onClick={() => window.open(pullRequestResult.url, '_blank', 'noopener,noreferrer')}>
                      <Icon name="check" className="icon sm" />
                      <span>PR #{pullRequestResult.number} · {pullRequestResult.title}</span>
                      <Icon name="forward" className="icon xs" />
                    </button>
                  )}
                  <button className="tf-state-row" disabled={!repositoryPath || gitBusy} onClick={() => void compareBranch()}>
                    <Icon name="git" className="icon sm" />
                    <span>Compare branch</span>
                    <Icon name="forward" className="icon xs" />
                  </button>
                  {gitError && <div className="tf-state-error">{gitError}</div>}
                </section>

                <section className="tf-state-card">
                  <div className="tf-state-heading">
                    <span>Subagents</span>
                    <button className="tf-state-heading-action" onClick={() => void delegateSubtask()} title="Delegate a subtask">
                      <Icon name="plus" className="icon sm" />
                    </button>
                  </div>
                  <ChildRunList runs={childRuns} onOpenRun={() => selectInspectorTab('activity')} />
                  {delegateEditorOpen && (
                    <form className="tf-state-inline-form" onSubmit={(event) => { event.preventDefault(); void delegateSubtask(delegateDraft) }}>
                      <label htmlFor="delegate-task">Subagent task</label>
                      <textarea
                        id="delegate-task"
                        value={delegateDraft}
                        onChange={(event) => setDelegateDraft(event.target.value)}
                        placeholder="Review the implementation and report risks…"
                        rows={3}
                        autoFocus
                      />
                      <div>
                        <button type="button" onClick={() => setDelegateEditorOpen(false)}>Cancel</button>
                        <button type="submit" disabled={!delegateDraft.trim()}>Delegate</button>
                      </div>
                    </form>
                  )}
                  {!!projectSessions.length && !childRuns.length && (
                    <div className="tf-state-sublabel">{projectSessions.length} other project agent{projectSessions.length === 1 ? '' : 's'} available</div>
                  )}
                </section>

                <section className="tf-state-card">
                  <div className="tf-state-heading"><span>Sources</span><Icon name="plus" className="icon sm" /></div>
                  {!!usedSources.length && <div className="tf-state-sublabel">Used in this run</div>}
                  <UsedSourcesList sources={usedSources.slice(0, 5)} onOpenSource={(source) => {
                    if (source.url) window.open(source.url, '_blank', 'noopener,noreferrer')
                    else selectInspectorTab('changes')
                  }} />
                  {!!projectSources.length && <div className="tf-state-sublabel">Available to project</div>}
                  {projectSources.slice(0, usedSources.length ? 2 : 4).map((source) => (
                    <button key={source.id} className="tf-state-row" onClick={() => source.url ? window.open(source.url, '_blank', 'noopener,noreferrer') : nav(`/project/${project.id}`)}>
                      <Icon name={source.kind === 'github' ? 'git' : source.kind === 'slack' ? 'message' : 'file'} className="icon sm" />
                      <span>{source.name}</span>
                      <small>{source.status}</small>
                    </button>
                  ))}
                  {!projectSources.length && !usedSources.length && <div className="tf-state-empty">No sources connected</div>}
                  <button className="tf-state-view-all" onClick={() => nav(`/project/${project.id}`)}>View all</button>
                </section>

                <section className="tf-state-card tf-state-run">
                  <div className="tf-state-heading"><span>Run</span></div>
                  <div className="scope-box">
                    <strong>{latestRun?.title ?? (chat.continuation ? 'Native session ready' : 'Thread ready')}</strong>
                    <p>{latestRun?.statusText ?? (chat.continuation
                      ? `Send a message to ${continuationAction.toLowerCase()} this ${PROVIDER_LABEL[chat.continuation.provider]} session.`
                      : 'Send a message to begin work in this project.')}</p>
                  </div>
                  {chat.continuation && <div className="kv"><span>{continuationAction} session</span><span title={chat.continuation.sessionId}>{PROVIDER_LABEL[chat.continuation.provider]} · {chat.continuation.sessionId.slice(0, 8)}</span></div>}
                  <div className="kv"><span>Harness</span><span>{latestRun?.harness ?? selectedHarnessLabel}</span></div>
                  <div className="kv"><span>Model</span><span>{latestRun?.model ?? selectedModelLabel}</span></div>
                  <div className="kv"><span>Access</span><span>{EXECUTION_MODES.find((mode) => mode.id === (latestRun?.executionMode ?? executionMode))?.label}</span></div>
                  {(latestRun?.executionMode ?? executionMode) === 'review' && (
                    <div className="scope-box review-workspace-note">
                      <strong>Isolated review workspace</strong>
                      <p>Changes stay separate until you apply individual hunks.</p>
                    </div>
                  )}
                  {latestRun?.usage && (
                    <div className="kv">
                      <span>Context</span>
                      <span>{latestRun.usage.totalTokens !== undefined ? formatTokenCount(latestRun.usage.totalTokens) : '—'}{latestRun.usage.contextWindow ? ` / ${formatTokenCount(latestRun.usage.contextWindow)}` : ''}{latestRun.usage.contextPercent !== undefined ? ` · ${latestRun.usage.contextPercent}%` : ''}</span>
                    </div>
                  )}
                  {!!latestRun?.warnings?.length && <div className="kv"><span>Warnings</span><span>{latestRun.warnings.length}</span></div>}
                  {!!queuedManagedRuns.length && <div className="kv"><span>Queue</span><span>{queuedManagedRuns.length} follow-up{queuedManagedRuns.length === 1 ? '' : 's'}</span></div>}
                  <div className="kv"><span>Cost</span><span>{latestRun?.cost ?? route.cost}</span></div>
                  {!!threadRunActivity.length && (
                    <div className="tf-state-live-activity" aria-label="Recent harness activity">
                      <div className="tf-state-sublabel">Recent activity</div>
                      {threadRunActivity.slice(-3).map((item) => (
                        <button key={item.id} type="button" onClick={() => selectInspectorTab('activity')}>
                          <Icon
                            name={item.kind === 'tool' ? 'terminal' : item.kind === 'change' ? 'file' : item.kind === 'error' ? 'x' : 'activity'}
                            className="icon sm"
                          />
                          <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {latestRun && latestRun.id !== 'pending' && (
                    <div className="tf-state-run-actions">
                      {!latestRun.done && (latestRunPaused
                        ? <button type="button" onClick={() => void runRegistry.resume(latestRun.id).catch((error) => toast('Resume failed', error instanceof Error ? error.message : String(error)))}><Icon name="play" className="icon sm" />Resume</button>
                        : <button type="button" onClick={() => void runRegistry.pause(latestRun.id).catch((error) => toast('Pause failed', error instanceof Error ? error.message : String(error)))}><Icon name="pause" className="icon sm" />Pause</button>)}
                      {!latestRun.done && <button type="button" onClick={() => void runRegistry.stop(latestRun.id).catch((error) => toast('Stop failed', error instanceof Error ? error.message : String(error)))}><Icon name="x" className="icon sm" />Stop</button>}
                      {latestRun.done && <button type="button" onClick={() => void runRegistry.retry(latestRun.id, chat.id, latestRun).catch((error) => toast('Retry failed', error instanceof Error ? error.message : String(error)))}><Icon name="refresh" className="icon sm" />Retry from checkpoint</button>}
                    </div>
                  )}
                  <button className="tf-state-view-all" onClick={() => selectInspectorTab('activity')}>View activity</button>
                </section>
              </div>
            )}
            {itab === 'changes' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>{gitComparison ? `${gitComparison.base}…${gitComparison.head}` : 'Changed files'}</h4>
                {latestRun?.executionMode === 'review' && (
                  <div className="scope-box review-workspace-note">
                    <strong>Prepared separately</strong>
                    <p>Apply approved hunks to the project or discard them from this review.</p>
                  </div>
                )}
                {(() => {
                  const liveFiles = gitComparison?.files ?? gitStatus?.diffFiles
                  const files = liveFiles?.map((file) => ({
                    path: file.path,
                    add: file.additions ?? 0,
                    del: file.deletions ?? 0,
                  })) ?? messages.flatMap((m) => m.run?.artifacts?.flatMap((a) => a.diff ?? []) ?? [])
                  return files.length ? files.map((f) => (
                    <div key={f.path} className="insp-file"><Icon name="file" className="icon sm" /><span className="if-path">{f.path}</span><span className="if-stat"><span style={{ color: '#7bd39a' }}>+{f.add}</span> <span style={{ color: '#e79393' }}>−{f.del}</span></span></div>
                  )) : <p style={{ fontSize: 11, color: 'var(--dim)' }}>No file changes yet.</p>
                })()}
                {gitComparison?.patch && (
                  <CollapsibleOutput
                    title="Comparison patch"
                    kind="terminal"
                    summary={`${gitComparison.files.length} changed files`}
                    output={gitComparison.patch}
                    copyText={gitComparison.patch}
                    status="success"
                    statusLabel={gitComparison.truncated ? 'truncated' : 'complete'}
                  />
                )}
              </div></div>
            )}
            {itab === 'checks' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <div className="tf-inspector-section-head">
                  <div><h4>Verification</h4><p>Run checks in this task with the selected local harness.</p></div>
                  <button
                    className="tiny-btn"
                    disabled={Boolean(activeManagedRun)}
                    onClick={() => void send('Run the relevant tests, typechecks, and validation for the changes in this task. Do not make unrelated edits. Report each check and whether it passed.')}
                  >
                    {activeManagedRun ? 'Agent running' : verificationChecks.length ? 'Run again' : 'Run checks'}
                  </button>
                </div>
                {(() => {
                  return verificationChecks.length ? verificationChecks.map((check, index) => (
                    <div key={`${check[0]}-${index}`} className="insp-file">
                      <Icon name={check[1]?.toLowerCase() === 'pass' ? 'check' : 'activity'} className="icon sm" />
                      <span className="if-path">{check[0]}</span>
                      <span className="if-stat">{check[1] ?? check.at(-1)}</span>
                    </div>
                  )) : <p style={{ fontSize: 11, color: 'var(--dim)' }}>Checks will appear here when the agent verifies its work.</p>
                })()}
              </div></div>
            )}
            {itab === 'activity' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Run timeline</h4>
                <div className="timeline">
                  {(threadRunActivity.length
                    ? threadRunActivity.map((item) => ({
                      title: item.label,
                      sub: item.detail ?? item.kind,
                      kind: item.kind === 'error' ? 'error' : 'info',
                      t: new Date(item.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
                    }))
                    : activity.length ? activity : [{ title: 'Thread open', sub: project.name, kind: 'info', t: 'now' }]).map((a, i) => (
                    <div key={i} className="tl-item"><span className={`tl-dot ${a.kind ?? ''}`} /><div className="tl-body"><strong>{a.title}</strong><span>{a.sub}</span></div><span className="tl-time">{a.t}</span></div>
                  ))}
                </div>
              </div></div>
            )}
            {itab === 'environment' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Execution environment</h4>
                <div className="scope-box"><strong>{latestRun?.runtime ?? RUNTIME_LABEL[route.runtimeKey]}</strong><p>Selected by Auto routing or your thread override.</p></div>
                <div className="kv"><span>Model</span><span>{latestRun?.model ?? selectedModelLabel}</span></div>
                <div className="kv"><span>Harness</span><span>{latestRun?.harness ?? selectedHarnessLabel}</span></div>
                <button className="secondary-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => nav('/environments')}>Manage environments</button>
              </div></div>
            )}
            {itab === 'access' && (
              <div className="ipanel active">
                <div className="inspector-section" style={{ borderTop: 0 }}>
                  <h4>Project boundary</h4>
                  <div className="scope-box"><strong>{project.name}</strong><p>Out-of-scope access generates approval + audit.</p></div>
                </div>
                <div className="inspector-section">
                  <h4>Chat sharing</h4>
                  <div className="kv"><span>Visibility</span><span>{chat.visibility}</span></div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    {(['private', 'shared', 'project'] as const).map((v) => (
                      <button key={v} className="tiny-btn" onClick={() => { setChatVisibility(chat.id, v, v === 'shared' ? ['user-maya'] : []); toast('Visibility updated', v) }}>{v}</button>
                    ))}
                  </div>
                  <button className="tiny-btn" style={{ marginTop: 8 }} onClick={() => { const t = prompt('Rename chat', chat.title); if (t) renameChat(chat.id, t) }}>Rename</button>
                  <button className="tiny-btn" style={{ marginTop: 8, marginLeft: 6 }} onClick={() => {
                    setChatArchived(chat.id, true)
                    nav('/work')
                    toast('Task archived', 'Its history is preserved and can be restored from Work.')
                  }}>Archive</button>
                  <button className="tiny-btn" style={{ marginTop: 8, marginLeft: 6 }} onClick={() => { deleteChat(chat.id); nav('/'); toast('Chat deleted', '') }}>Delete</button>
                </div>
              </div>
            )}
            {!inspector ? null : (
              <div style={{ padding: 12 }}><button className="secondary-btn" style={{ width: '100%' }} onClick={() => nav(`/project/${project.id}`)}>Configure project</button></div>
            )}
          </div>
        </aside>
      </div>

      {!inspector && !messages.length && (
        <button className="icon-btn" style={{ position: 'absolute', right: 12, top: 8, zIndex: 5 }} onClick={() => openInspector()} title="Open inspector"><Icon name="panel" /></button>
      )}

      {perm && (
        <div className="modal-backdrop open">
          <div className="modal" style={{ width: 'min(560px, 100%)' }}>
            <div className="modal-head"><div className="modal-icon"><Icon name="shield" /></div><div><h3>{perm.title}</h3><p>Review exactly what will happen before deciding.</p></div></div>
            <div className="modal-body">
              <div className="permission-box">
                <div className="permission-row"><Icon name="key" className="icon sm" /><span>Capability</span><strong>{perm.resource}</strong></div>
                <div className="permission-row"><Icon name="message" className="icon sm" /><span>Why</span><strong style={{ maxWidth: '58%', textAlign: 'right', fontWeight: 500 }}>{perm.why}</strong></div>
                <div className="permission-row"><Icon name="folder" className="icon sm" /><span>Project</span><strong>{project.name}</strong></div>
                <div className="permission-row"><Icon name="db" className="icon sm" /><span>Data sent</span><strong>{perm.data}</strong></div>
                <div className="permission-row"><Icon name="spark" className="icon sm" /><span>Model</span><strong>{perm.model}</strong></div>
                <div className="permission-row"><Icon name="undo" className="icon sm" /><span>Reversible?</span><strong style={{ color: '#9bdab0' }}>{perm.reversible}</strong></div>
                <div className="permission-row"><Icon name="chart" className="icon sm" /><span>Cost / risk</span><strong>{perm.risk}</strong></div>
              </div>
              <div className="form-row" style={{ marginTop: 12, marginBottom: 0 }}><label>Grant for</label>
                <div className="seg">{(['once', 'chat', 'project', 'always'] as const).map((s) => <button key={s} className={permScope === s ? 'active' : ''} onClick={() => setPermScope(s)}>{s}</button>)}</div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="danger-btn" onClick={() => void denyPromptPermission(true)}>Deny & add policy</button>
              <button className="ghost-btn" onClick={() => void denyPromptPermission(false)}>Deny once</button>
              <button className="primary-btn" onClick={() => void grantPerm()}>Allow</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function fallbackRunOutput(run: AgentRunBlock) {
  if (!run.done) return run.statusText ? `I’m working on this now: ${run.statusText.toLowerCase()}.` : ''
  if (run.failure) {
    return `I couldn’t complete this run. ${run.failure.message}`
  }
  if (/failed|unavailable|rejected|error/i.test(run.statusText)) {
    return `I couldn’t complete this run. ${run.statusText}`
  }
  const diffFiles = run.artifacts.flatMap((artifact) => artifact.diff ?? [])
  const checks = run.artifacts
    .filter((artifact) => artifact.type === 'table' && artifact.title.toLowerCase().includes('verification'))
    .flatMap((artifact) => artifact.table?.rows ?? [])
  if (run.kind === 'coding') {
    const changeSummary = diffFiles.length
      ? `I implemented the requested change across ${diffFiles.length} file${diffFiles.length === 1 ? '' : 's'} (+${diffFiles.reduce((sum, file) => sum + file.add, 0)} −${diffFiles.reduce((sum, file) => sum + file.del, 0)}).`
      : 'I completed the coding task.'
    const verification = checks.length
      ? ` ${checks.filter((check) => check[1]?.toLowerCase() === 'pass').length} verification checks passed.`
      : run.tools.some((tool) => /test/i.test(tool.name)) ? ' The focused tests passed.' : ''
    return `${changeSummary}${verification} The implementation and supporting details are ready for review below.`
  }
  if (run.kind === 'research') return 'I completed the research and prepared the findings below, including the sources and supporting evidence.'
  return 'I completed the requested work and prepared the result below for review.'
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1)}K`
  return String(value)
}

function MessageView({ m, onHunk, toast, files, density, onRetry, onBranch }: {
  m: Message
  onHunk: (filePath: string, hunkIndex: number, id: string, s: 'accepted' | 'rejected') => void
  toast: (t: string, m: string) => void
  files?: { write: (path: string, content: string) => Promise<void> } | null
  density: 'summary' | 'normal' | 'verbose'
  onRetry?: () => void
  onBranch?: () => void
}) {
  const runRegistry = useRunRegistry()
  const [planEditing, setPlanEditing] = useState(false)
  const [planDraft, setPlanDraft] = useState('')
  const [planSubmitting, setPlanSubmitting] = useState(false)
  if (m.role === 'user') {
    return <div className="message user"><div className="message-body"><div className="message-text">{m.text}</div><MessageActions text={m.text} onRetry={onRetry} onBranch={onBranch} onCopyError={() => toast('Copy failed', 'Clipboard access is unavailable.')} /></div></div>
  }
  const run = m.run
  const paused = /^Paused\b/.test(run?.statusText ?? '')
  const interrupted = !!run?.done && (!!run.failure || /^(Stopped|Failed|Cancelled)/i.test(run.statusText))
  const lastDecision = [...(run?.activity ?? [])].reverse().find((item) =>
    /^(?:Approval granted|Approval denied|Answer submitted|Guidance sent)$/.test(item.label))
  const agentOutput = m.text || run?.output || (run ? fallbackRunOutput(run) : '')
  const canRevisePlan = Boolean(run && !run.done && !paused && run.id !== 'pending' && /codex/i.test(run.harness))
  const beginPlanEdit = () => {
    if (!run) return
    setPlanDraft(run.plan.map((step) => step.label).join('\n'))
    setPlanEditing(true)
  }
  const submitPlanRevision = async () => {
    if (!run) return
    const revision = buildPlanRevision(planDraft)
    if (!revision) {
      toast('Plan needs a step', 'Add at least one concrete step before updating it.')
      return
    }
    setPlanSubmitting(true)
    try {
      await runRegistry.steer(run.id, revision.prompt)
      setPlanEditing(false)
      toast('Plan revision sent', 'Codex will reconcile the visible plan with your changes.')
    } catch (error) {
      toast('Plan update failed', error instanceof Error ? error.message : String(error))
    } finally {
      setPlanSubmitting(false)
    }
  }
  return (
    <div className="message assistant">
      {!run && (
        <div className="assistant-avatar" title={PROVIDER_NAME[providerFromLabel(m.routingNote)]}>
          <ProviderLogo label={m.routingNote} className="provider-logo" />
        </div>
      )}
      <div className="message-body" style={run ? { maxWidth: 760 } : undefined}>
        {m.lightHtml && <div className="message-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(m.lightHtml) }} />}
        {!m.lightHtml && agentOutput && (
          <div className={`message-text ${run ? 'tf-agent-transcript' : ''}`}>
            {!run?.done && <span className="tf-live-label"><i /> Live agent output</span>}
            {agentOutput}
            {!run?.done && <span className="streaming-cursor" aria-hidden="true" />}
          </div>
        )}
        {!run && !m.lightHtml && !m.text && <div className="message-thinking stale"><strong>Run unavailable</strong><span>Configure OpenRouter or an OpenAI-compatible model endpoint in Settings.</span></div>}
        {run && (
          <div className="agent-run">
            <div className="run-top">
              <div className="run-avatar" title={PROVIDER_NAME[providerFromLabel(run.model)]}><ProviderLogo label={run.model} className="provider-logo sm" /></div>
              <div><div className="run-title">{run.title}</div><div className="run-sub">{run.model} · {run.harness} · {run.runtime}</div></div>
              <div className={`run-live ${run.done ? interrupted ? 'interrupted' : 'done' : paused ? 'paused' : ''}`}>
                {run.done
                  ? interrupted ? run.statusText.split(' · ')[0] : 'Done'
                  : paused ? <><Icon name="pause" className="icon xs" /> Paused</> : <><span className="spinner" /> Working</>}
              </div>
              {!run.done && run.id !== 'pending' && (
                <div className="run-controls">
                  {paused
                    ? <button className="tiny-btn" onClick={() => void runRegistry.resume(run.id).catch((error) => toast('Resume failed', error instanceof Error ? error.message : String(error)))}>Resume</button>
                    : <button className="tiny-btn" onClick={() => void runRegistry.pause(run.id).catch((error) => toast('Pause failed', error instanceof Error ? error.message : String(error)))}>Pause</button>}
                  <button className="tiny-btn" onClick={() => void runRegistry.stop(run.id).catch((error) => toast('Stop failed', error instanceof Error ? error.message : String(error)))}>Stop</button>
                </div>
              )}
              {run.done && run.id !== 'pending' && (
                <button className="tiny-btn" onClick={() => void runRegistry.retry(run.id, m.chatId, run).catch((error) => toast('Retry failed', error instanceof Error ? error.message : String(error)))}>Retry</button>
              )}
            </div>
            <div className={`run-status ${run.done ? interrupted ? 'interrupted' : 'done' : ''}`}>
              {!run.done && !paused && <span className="typing-indicator" aria-label="Working"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>}
              {paused && <Icon name="pause" className="icon sm" />}
              {run.done && <Icon name={interrupted ? 'x' : 'check'} className={`icon sm ${interrupted ? '' : 'tool-check'}`} />}
              <span>{run.statusText}</span>
              {!run.done && !paused && <span className="streaming-cursor" aria-hidden="true" />}
              {(run.usage || run.done && run.cost) && (
                <span className="status-time">
                  {[
                    run.usage?.contextPercent !== undefined ? `${run.usage.contextPercent}% context` : undefined,
                    run.tools.length ? `${run.tools.length} tools` : undefined,
                    run.done ? run.cost : undefined,
                  ].filter(Boolean).join(' · ')}
                </span>
              )}
            </div>
            {lastDecision && (
              <div className="tf-run-decision">
                <Icon name={lastDecision.label.startsWith('Approval') ? 'shield' : 'message'} className="icon sm" />
                <strong>{lastDecision.label}</strong>
                {lastDecision.detail && <span>{lastDecision.detail}</span>}
              </div>
            )}
            {!!run.warnings?.length && (
              <div className="tf-run-warnings">
                <Icon name="activity" className="icon sm" />
                <div>
                  <strong>Runtime warning</strong>
                  <p>{run.warnings.at(-1)?.message}</p>
                </div>
              </div>
            )}
            {run.failure && (
              <div className={`tf-run-failure ${run.failure.kind}`}>
                <Icon name="x" className="icon sm" />
                <div>
                  <strong>{run.failure.title}</strong>
                  <p>{run.failure.message}</p>
                  <small>{run.failure.recovery}</small>
                </div>
              </div>
            )}
            {run.inputRequest && <InlineAgentRequest run={run} toast={toast} />}
            {density !== 'summary' && !!run.plan.length && (
              <div className="plan">
                <div className="plan-head">
                  <span><Icon name="review" className="icon sm" /> Task plan</span>
                  {canRevisePlan && !planEditing && <button className="plan-edit-btn" type="button" onClick={beginPlanEdit}>Edit plan</button>}
                </div>
                {planEditing ? (
                  <div className="plan-editor">
                    <textarea
                      aria-label="Plan steps"
                      value={planDraft}
                      onChange={(event) => setPlanDraft(event.target.value)}
                      rows={Math.min(8, Math.max(3, planDraft.split('\n').length))}
                      maxLength={2_400}
                    />
                    <p>One step per line. Updating the plan steers the active Codex turn.</p>
                    <div className="plan-editor-actions">
                      <button className="tiny-btn" type="button" disabled={planSubmitting} onClick={() => setPlanEditing(false)}>Cancel</button>
                      <button className="tiny-btn primary" type="button" disabled={planSubmitting} onClick={() => void submitPlanRevision()}>
                        {planSubmitting ? 'Updating…' : 'Update plan'}
                      </button>
                    </div>
                  </div>
                ) : run.plan.map((p, index) => (
                  <div key={`${p.label}-${index}`} className={`plan-step ${p.status}`}><span className="pstate"><Icon name="check" className="icon sm" /></span>{p.label}</div>
                ))}
              </div>
            )}
            {density !== 'summary' && <div className="run-tools tf-run-outputs">
              {run.tools.map((t) => (
                <CollapsibleOutput
                  key={t.id}
                  title={t.name}
                  kind={t.icon === 'terminal' ? 'terminal' : 'tool'}
                  command={t.input}
                  output={t.output}
                  copyText={t.output}
                  status={t.status ?? 'success'}
                  statusLabel={t.cost}
                  duration={t.duration}
                  defaultExpanded={density === 'verbose'}
                  onCopyError={() => toast('Copy failed', 'Clipboard access is unavailable.')}
                />
              ))}
            </div>}
            {run.artifacts.map((a) => (
              <div key={a.id} className="artifact">
                <div className="artifact-head">
                  <span className="a-ico"><Icon name={a.type === 'diff' ? 'git' : a.type === 'table' ? 'chart' : 'file'} className="icon sm" /></span>
                  <span className="a-title"><strong>{a.title}</strong><span>{a.subtitle}</span></span>
                  <span className="a-actions">
                    {a.type === 'diff' && <button className="secondary-btn" style={{ minHeight: 27 }} onClick={async () => {
                      if (files) {
                        await files.write(`artifacts/pr-${Date.now()}.md`, `# Simulated PR\n\nFrom message ${m.id}\n`)
                        toast('Pull request artifact saved', 'Wrote to OPFS artifacts/')
                      } else {
                        toast('Pull request created', 'PR #1933 opened (simulated).')
                      }
                    }}>Create pull request</button>}
                    {a.type === 'report' && <button className="tiny-btn" onClick={async () => {
                      if (files && a.reportHtml) {
                        await files.write(`artifacts/report-${Date.now()}.html`, a.reportHtml)
                        toast('Saved', 'Report written to OPFS artifacts/')
                      } else {
                        toast('Saved', 'Report saved to project.')
                      }
                    }}>Save to project</button>}
                  </span>
                </div>
                {a.diff?.map((f) => (
                  <details key={f.path} className="diff-file" open>
                    <summary className="diff-file-head"><span className="df-path">{f.path}</span><span className="df-right"><span className="diff-stat"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span></span></summary>
                    <div className="diff-hunks">
                      {m.run?.executionMode === 'review' && (
                        <div className="review-diff-notice">
                          <Icon name="shield" className="icon sm" />
                          <span><strong>Prepared in an isolated workspace</strong><small>Apply only the changes you want in the project.</small></span>
                        </div>
                      )}
                      {f.hunks.map((h, hunkIndex) => (
                        <div key={h.id} className={`hunk ${h.status === 'rejected' ? 'rejected' : ''}`}>
                          <div className="hunk-bar"><span>{h.range}</span><span className="hunk-actions">
                            {h.status === 'accepted' ? <span className="accepted-pill">{m.run?.executionMode === 'review' ? 'Applied' : 'Accepted'}</span> : (
                              <><button className="tiny-btn" onClick={() => onHunk(f.path, hunkIndex, h.id, 'rejected')}>{m.run?.executionMode === 'review' ? 'Discard' : 'Reject'}</button><button className="tiny-btn" onClick={() => onHunk(f.path, hunkIndex, h.id, 'accepted')}>{m.run?.executionMode === 'review' ? 'Apply' : 'Accept'}</button></>
                            )}
                          </span></div>
                          {h.lines.map((ln, i) => (
                            <div key={i} className={`dline ${ln.t === 'add' ? 'add' : ln.t === 'del' ? 'del' : ''}`}><span className="ln">{ln.t === 'add' ? '' : ln.n}</span><span className="dc">{ln.t === 'add' ? '+' : ln.t === 'del' ? '−' : ' '} {ln.c}</span></div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
                {a.reportHtml && <div className="report-html" style={{ padding: '13px 15px', fontSize: 12, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.reportHtml) }} />}
                {a.table && (
                  <table className="table-artifact"><thead><tr>{a.table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{a.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
                )}
              </div>
            ))}
          </div>
        )}
        {density !== 'summary' && m.routingNote && <div className="routing-note"><span className="pulse" />{m.routingNote}</div>}
        <MessageActions
          text={agentOutput || m.text}
          onRetry={onRetry}
          onBranch={onBranch}
          onCopyError={() => toast('Copy failed', 'Clipboard access is unavailable.')}
        />
      </div>
    </div>
  )
}
