import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import {
  DEMO_FLOWS, deriveRoute, HARNESS_LABEL, MODEL_LABEL, needsPermission, RUNTIME_LABEL, simulateAgentRun,
  type RouteDecision,
} from '../lib/simulation'
import type { AgentRunBlock, CodingProvider, Harness, Message, ModelKey, RuntimeKind } from '../types'
import { PROVIDER_NAME, ProviderLogo, providerFromLabel } from '../components/common/ProviderLogo'
import { evaluatePermissions } from '../services/permissions'
import { sanitizeHtml } from '../lib/sanitizeHtml'
import { useRunRegistry } from '../features/runs/RunRegistry'
import { ChildRunList, UsedSourcesList, selectRelatedRuns, selectUsedRunSources } from '../features/runs/runRelations'
import { CollapsibleOutput, JumpToLatest, MessageActions, useTranscriptPosition } from '../features/thread'
import type { GitComparisonResult, GitStatusResult } from '../services/contracts'

const HARNESS_PICKER_OPTIONS: Array<{
  id: CodingProvider
  label: string
  shortLabel: string
  detail: string
  logoLabel: string
}> = [
  { id: 'auto', label: 'Auto', shortLabel: 'Auto', detail: 'Best available', logoLabel: 'OpenSaddle' },
  { id: 'codex', label: 'Codex', shortLabel: 'Codex', detail: 'OpenAI app server', logoLabel: 'OpenAI' },
  { id: 'claude', label: 'Claude Code', shortLabel: 'Claude', detail: 'Anthropic CLI', logoLabel: 'Claude' },
  { id: 'cursor', label: 'Cursor', shortLabel: 'Cursor', detail: 'Cursor Agent CLI', logoLabel: 'Cursor' },
  { id: 'gemini', label: 'Gemini CLI', shortLabel: 'Gemini', detail: 'Google CLI', logoLabel: 'Gemini' },
  { id: 'opencode', label: 'OpenCode', shortLabel: 'OpenCode', detail: 'Open CLI', logoLabel: 'OpenCode' },
  { id: 'antigravity', label: 'Antigravity', shortLabel: 'Antigravity', detail: 'Agent CLI', logoLabel: 'Antigravity' },
  { id: 'opensaddle', label: 'OpenSaddle', shortLabel: 'OpenSaddle', detail: 'Native harness', logoLabel: 'OpenSaddle' },
]

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
}

function HarnessVisual({ id, className = 'provider-logo' }: { id: CodingProvider; className?: string }) {
  if (id === 'codex') return <ProviderLogo provider="openai" className={className} />
  if (id === 'claude') return <ProviderLogo provider="anthropic" className={className} />
  if (id === 'gemini') return <ProviderLogo provider="google" className={className} />
  if (id === 'cursor') return <Icon name="code" className={className} />
  if (id === 'opencode') return <Icon name="terminal" className={className} />
  if (id === 'antigravity') return <Icon name="spark" className={className} />
  return <ProviderLogo provider="opensaddle" className={className} />
}

export function ChatPage() {
  const { chatId } = useParams()
  const nav = useNavigate()
  const location = useLocation()
  const store = useStore()
  const runRegistry = useRunRegistry()
  const { data, appendMessage, updateMessage, createChat, setActiveChat, setActiveProject, setChatVisibility, branchChat, branchChatFromMessage, renameChat, deleteChat, updateSource, updateHunk, toast, services } = store
  const chat = data.chats.find((c) => c.id === (chatId ?? data.activeChatId))
  const project = data.projects.find((p) => p.id === chat?.projectId) ?? data.projects.find((p) => p.id === data.activeProjectId) ?? data.projects[0]
  const messages = useMemo(() => data.messages.filter((m) => m.chatId === chat?.id).sort((a, b) => a.createdAt - b.createdAt), [data.messages, chat?.id])
  const latestRun = useMemo(() => [...messages].reverse().find((message) => message.run)?.run, [messages])
  const rootRun = useMemo(() => [...messages].reverse().find((message) => message.run && !message.run.parentRunId)?.run, [messages])
  const managedRuns = runRegistry.getForThread(chat?.id ?? '')

  const [text, setText] = useState('')
  const [inspector, setInspector] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1080)
  const [itab, setItab] = useState('overview')
  const [density, setDensity] = useState<'summary' | 'normal' | 'verbose'>('normal')
  const [routeOpen, setRouteOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tools, setTools] = useState(new Set(['Chrome', 'Files', 'API']))
  const [auto, setAuto] = useState(true)
  const [modelOv, setModelOv] = useState<ModelKey | 'auto'>('auto')
  const [harnessOv, setHarnessOv] = useState<Harness | 'auto'>('auto')
  const [providerOv, setProviderOv] = useState<CodingProvider>('auto')
  const [runtimeOv, setRuntimeOv] = useState<RuntimeKind | 'auto'>('auto')
  const [openRouterModelId, setOpenRouterModelId] = useState('')
  const [freeModels, setFreeModels] = useState<Array<{ id: string; name: string; contextLength?: number }>>([])
  const [route, setRoute] = useState<RouteDecision>(() => deriveRoute('', data.settings.routingPref))
  const [providerKey, setProviderKey] = useState<CodingProvider>('opensaddle')
  const PROVIDER_LABEL: Record<Exclude<CodingProvider, 'auto' | 'custom'>, string> = {
    opensaddle: 'OpenSaddle',
    codex: 'Codex App Server',
    claude: 'Claude Code',
    cursor: 'Cursor',
    gemini: 'Gemini CLI',
    opencode: 'OpenCode',
    antigravity: 'Antigravity CLI',
  }
  const [perm, setPerm] = useState<ReturnType<typeof needsPermission>>(null)
  const [pending, setPending] = useState('')
  const [permScope, setPermScope] = useState('once')
  const [activity, setActivity] = useState<Array<{ title: string; sub: string; kind?: string; t: string }>>([])
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitComparison, setGitComparison] = useState<GitComparisonResult | null>(null)
  const [gitBusy, setGitBusy] = useState(false)
  const [gitError, setGitError] = useState('')
  const [repositoryEditorOpen, setRepositoryEditorOpen] = useState(false)
  const [repositoryDraft, setRepositoryDraft] = useState('')
  const [delegateEditorOpen, setDelegateEditorOpen] = useState(false)
  const [delegateDraft, setDelegateDraft] = useState('')
  const attachRef = useRef<HTMLInputElement>(null)
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
    setDelegateEditorOpen(false)
    setDelegateDraft('')
    setRepositoryEditorOpen(false)
    setGitComparison(null)
  }, [chat?.id])

  const serverRouting = Boolean(services?.controlPlane.connected) && auto
  const defaults = project?.routingDefaults
  const defaultModel = defaults?.modelKey && defaults.modelKey !== 'auto' ? defaults.modelKey : undefined
  const defaultProvider = defaults?.providerKey && defaults.providerKey !== 'auto' ? defaults.providerKey : undefined
  const defaultRuntime = defaults?.runtimeKey
  const selectedProvider = providerOv === 'auto' ? defaultProvider : providerOv
  const pickerProvider = providerOv === 'auto' ? 'auto' : providerOv
  const harnessPickerOption = HARNESS_PICKER_OPTIONS.find((option) => option.id === (selectedProvider ?? 'auto'))
    ?? HARNESS_PICKER_OPTIONS[0]!
  const compatibleModelOptions = MODEL_PICKER_OPTIONS[pickerProvider] ?? MODEL_PICKER_OPTIONS.auto!
  const modelPickerOption = compatibleModelOptions.find((option) => option.id === modelOv)
    ?? compatibleModelOptions[0]!
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

  // Reflect the backend's actual route estimate in the pill while typing.
  useEffect(() => {
    if (!serverRouting || !services) return
    const task = (text || pending || 'general chat message').trim()
    const timer = window.setTimeout(() => {
      void services.runtime.estimate(task, {
        projectId: project.id,
        routingPref: data.settings.routingPref,
        modelKey: modelOv === 'auto' && usesNativeCliRouter ? 'auto' : modelOv === 'auto' ? defaultModel : modelOv,
        modelId: openRouterModelId || undefined,
        harnessKey: harnessOv === 'auto' ? undefined : harnessOv,
        providerKey: providerOv === 'auto' ? defaultProvider : providerOv,
        runtimeKey: runtimeOv === 'auto' ? defaultRuntime : runtimeOv,
      })
        .then((est) => {
          setRoute((r) => ({
            ...r,
            klass: est.harnessKey === 'coding' ? 'coding'
              : est.harnessKey === 'research' ? 'research'
              : est.harnessKey === 'browser' ? 'browser'
              : r.klass === 'ops' ? 'ops' : 'chat',
            modelKey: est.modelKey,
            harnessKey: est.harnessKey,
            runtimeKey: est.runtimeKey,
            reasons: est.reasons,
            cost: est.cost,
          }))
          if (est.providerKey) setProviderKey(est.providerKey)
        })
        .catch(() => undefined)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [text, pending, serverRouting, services, data.settings.routingPref, modelOv, harnessOv, providerOv, runtimeOv, openRouterModelId, project.id, defaultModel, defaultProvider, defaultRuntime, usesNativeCliRouter])

  const send = async (forced?: string) => {
    const prompt = (forced ?? text).trim()
    if (!prompt || !chat) return
    setText('')
    setToolsOpen(false)
    setRouteOpen(false)
    appendMessage({ chatId: chat.id, role: 'user', text: prompt })
    const r = refreshRoute(prompt)
    const permission = needsPermission(prompt)
    if (permission) {
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
    const effectiveProvider = providerOv === 'auto' ? (defaultProvider ?? providerKey) : providerOv
    if (!approvalId && !exec.approvalRequired && effectiveProvider === 'claude' && services?.runtime.requestApproval) {
      try {
        const approval = await services.runtime.requestApproval({
          projectId: project.id,
          agentId,
          action: 'harness.claude.shell',
        })
        if (approval.status === 'pending') {
          if (!services.runtime.resolveApproval) throw new Error('Claude Code shell approval is waiting for a reviewer')
          await services.runtime.resolveApproval(approval.id, true)
        }
        approvalId = approval.id
      } catch (error) {
        toast('Approval required', error instanceof Error ? error.message : String(error))
        return
      }
    }

    setActivity([{ title: 'Run started', sub: `${project.name} · ${RUNTIME_LABEL[r.runtimeKey]}`, kind: 'info', t: '0.0s' }])
    setInspector(true)
    setItab('overview')

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
          task: prompt,
          agentId,
          modelKey: modelOv === 'auto' && usesNativeCliRouter ? 'auto' : modelOv === 'auto' ? defaultModel : modelOv,
          modelId: openRouterModelId || undefined,
          harnessKey: harnessOv === 'auto' ? undefined : harnessOv,
          providerKey: providerOv === 'auto' ? defaultProvider : providerOv,
          runtimeKey: runtimeOv === 'auto' ? defaultRuntime : runtimeOv,
          repo: repository?.folderPath,
          approvalId,
          reviewProviderKey: defaults?.reviewProviderKey === 'auto' ? undefined : defaults?.reviewProviderKey,
        })
        const mode = started.mode ?? 'mock'
        const isMockMode = mode === 'mock' || mode === 'mock_with_repo'
        const actualModel = started.route?.modelKey ?? r.modelKey
        const actualHarness = started.route?.harnessKey ?? r.harnessKey
        const actualRuntime = started.route?.runtimeKey ?? r.runtimeKey
        const actualProvider = started.route?.providerKey ?? providerKey
        const providerNote = actualHarness === 'coding' && actualProvider && actualProvider !== 'auto' && actualProvider !== 'custom'
          ? ` · ${PROVIDER_LABEL[actualProvider]}`
          : ''
        updateMessage(placeholder.id, {
          routingNote: `${started.route ? 'Server' : 'Auto'} · ${MODEL_LABEL[actualModel]} · ${HARNESS_LABEL[actualHarness]}${providerNote} · ${RUNTIME_LABEL[actualRuntime]}`,
        })
        // Keep the composer pill consistent with what the server actually ran.
        if (started.route) {
          setRoute((prev) => ({ ...prev, modelKey: actualModel, harnessKey: actualHarness, runtimeKey: actualRuntime }))
          if (started.route.providerKey) setProviderKey(started.route.providerKey)
        }

        if (isMockMode) {
          // Local mock runtime: the simulation IS the event source.
          await simulateAgentRun(prompt, r, (run: AgentRunBlock) => {
            updateMessage(placeholder.id, { text: run.output ?? '', run: { ...run, id: started.runId } })
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
          title: 'Agent run', model: MODEL_LABEL[actualModel], harness: HARNESS_LABEL[actualHarness], runtime: RUNTIME_LABEL[actualRuntime],
          statusText: mode.replace('_', ' '), done: false, tools: [], plan: [], artifacts: [],
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

  const grantPerm = async () => {
    setPerm(null)
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
    toast('Access granted', `Scope: ${permScope}`)
    setActivity((a) => [...a, { title: 'Permission granted', sub: perm?.resource ?? '', kind: 'info', t: 'now' }])
    if (chat) {
      const r = refreshRoute(pending)
      await runAgent(pending, r, chat.id, approvalId)
    }
  }

  const starters = [
    { icon: 'search', title: 'Explore and understand', sub: 'Knowledge + architecture', prompt: 'Explore this project and explain how the model router, tool permissions, and runtimes fit together.' },
    { icon: 'tools', title: 'Build a new feature', sub: 'Code in an isolated runtime', prompt: DEMO_FLOWS[0].prompt },
    { icon: 'review', title: 'Review code', sub: 'GitHub + coding harness', prompt: 'Review the latest GitHub pull requests and suggest safe changes.' },
    { icon: 'bug', title: 'Fix issues', sub: 'Logs + cloud runtime', prompt: 'Investigate the failed cloud task and fix the issue without changing production data.' },
  ]
  const changedFiles = messages.flatMap((message) => message.run?.artifacts.flatMap((artifact) => artifact.diff ?? []) ?? [])
  const artifactAdditions = changedFiles.reduce((total, file) => total + file.add, 0)
  const artifactDeletions = changedFiles.reduce((total, file) => total + file.del, 0)
  const projectSources = data.sources.filter((source) => source.projectId === project.id)
  const projectSessions = data.agentSessions.filter((session) => session.projectId === project.id)
  const activeEnvironment = data.environments.find((environment) =>
    latestRun && RUNTIME_LABEL[environment.kind] === latestRun.runtime,
  ) ?? (!latestRun ? data.environments.find((environment) => environment.status === 'Running') : undefined)
  const repository = projectSources.find((source) => source.kind === 'github')
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
  }) : []
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
  const runActivity = latestRun?.activity ?? []
  const additions = gitStatus?.additions ?? artifactAdditions
  const deletions = gitStatus?.deletions ?? artifactDeletions

  useEffect(() => {
    const repo = repository?.folderPath
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
  }, [latestRun?.done, project.id, repository?.folderPath, services])

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

  const commitChanges = async () => {
    const repo = repository?.folderPath
    const client = services?.runtime
    if (!repo || !client?.gitCommit) return void chooseRepository()
    const message = window.prompt('Commit message')
    if (!message?.trim()) return
    if (!window.confirm(`Commit ${gitStatus?.files.length ?? 'the'} changed files to ${gitStatus?.branch ?? 'the current branch'}?`)) return
    setGitBusy(true)
    try {
      let approvalId: string | undefined
      try {
        const result = await client.gitCommit({ projectId: project.id, repo, message, paths: gitStatus?.files.map((file) => file.path) })
        toast('Changes committed', result.commit.slice(0, 10))
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        if (!/approval/i.test(reason) || !client.requestApproval || !client.resolveApproval) throw error
        const approval = await client.requestApproval({ projectId: project.id, action: 'write' })
        await client.resolveApproval(approval.id, true)
        approvalId = approval.id
        const result = await client.gitCommit({ projectId: project.id, repo, message, paths: gitStatus?.files.map((file) => file.path), approvalId })
        toast('Changes committed', result.commit.slice(0, 10))
      }
      setGitStatus(await client.gitStatus?.(project.id, repo) ?? null)
    } catch (error) {
      toast('Commit failed', error instanceof Error ? error.message : String(error))
    } finally {
      setGitBusy(false)
    }
  }

  const pushChanges = async () => {
    const repo = repository?.folderPath
    const client = services?.runtime
    if (!repo || !client?.gitPush || !client.requestApproval || !client.resolveApproval) return void chooseRepository()
    if (!window.confirm(`Push ${gitStatus?.branch ?? 'the current branch'} to ${gitStatus?.upstream ?? 'origin'}? This updates the remote repository.`)) return
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
      setGitStatus(await client.gitStatus?.(project.id, repo) ?? null)
    } catch (error) {
      toast('Push failed', error instanceof Error ? error.message : String(error))
    } finally {
      setGitBusy(false)
    }
  }

  const compareBranch = async () => {
    const repo = repository?.folderPath
    const client = services?.runtime
    if (!repo || !client?.gitCompare) return void chooseRepository()
    setGitBusy(true)
    try {
      const comparison = await client.gitCompare(project.id, repo, repository.branch ?? 'main')
      setGitComparison(comparison)
      setItab('changes')
      toast('Branch comparison ready', `${comparison.files.length} files · +${comparison.additions} −${comparison.deletions}`)
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
        repo: repository?.folderPath,
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
          updateMessage(message.id, { text: run.output ?? '', run: { ...run, id: started.runId, parentRunId: rootRun.id, title: initial.title } })
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
      <div className={`chat-shell ${inspector ? 'inspector-open' : ''}`}>
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
                <button className="tf-toolbar-button" onClick={() => { setInspector(true); setItab('changes') }}>
                  <Icon name="git" className="icon xs" />
                  {latestRun.artifacts.flatMap((artifact) => artifact.diff ?? []).length} changes
                </button>
              )}
              <button className="tf-toolbar-button" onClick={() => setInspector(true)}><Icon name="panel" className="icon xs" />Details</button>
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
                    toast(st === 'accepted' ? 'Hunk accepted' : 'Hunk reverted', filePath)
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
                placeholder="Message your agent"
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
                <span className="composer-spacer" />
                <button className={`route-pill ${auto ? '' : 'manual'}`} title={serverRouting ? 'Routed by the OpenSaddle control plane' : 'Routed locally (mock)'} onClick={() => { setToolsOpen(false); setRouteOpen((v) => !v); refreshRoute(text || pending || 'build a feature') }}>
                  {auto && <span className="pulse" />}
                  <HarnessVisual id={harnessPickerOption.id} className="provider-logo xs" />
                  <span className="route-seg">{harnessPickerOption.shortLabel}</span>
                  <span className="route-model-label">{modelPickerOption.label}</span>
                  <Icon name="chevron" className="icon sm" />
                </button>
                <button className="send-btn" onClick={() => void send()}><Icon name="arrow" className="icon sm" /></button>
              </div>

              {toolsOpen && (
                <div className="popover tools-popover open">
                  <div className="popover-title">Chat options</div>
                  <div className="popover-actions">
                    <button onClick={() => nav(`/permissions/${project.id}`)}><Icon name="shield" className="icon sm" /><span><strong>Scoped access</strong><small>Review project permissions</small></span></button>
                    <button onClick={() => setInspector(true)}><Icon name="panel" className="icon sm" /><span><strong>Run details</strong><small>Open the activity inspector</small></span></button>
                  </div>
                  <div className="popover-title popover-title-secondary">Available tools</div>
                  {['Chrome', 'Files', 'API', 'VM', 'Coding agent'].map((t) => (
                    <button key={t} className={`tool-option ${tools.has(t) ? 'enabled' : ''}`} onClick={() => {
                      const next = new Set(tools)
                      if (next.has(t)) next.delete(t); else next.add(t)
                      setTools(next)
                      toast(`${t} ${next.has(t) ? 'enabled' : 'disabled'}`, 'Applies to this chat.')
                    }}>
                      <span className="tool-icon-wrap"><Icon name={t === 'VM' ? 'vm' : t === 'Files' ? 'file' : t === 'API' ? 'api' : t === 'Coding agent' ? 'code' : 'globe'} /></span>
                      <span className="tool-copy"><strong>{t}</strong><small>Toggle availability</small></span>
                      <span className="check"><Icon name="check" className="icon sm" /></span>
                    </button>
                  ))}
                </div>
              )}

              {routeOpen && (
                <div className="popover routing-popover open">
                  <div className="compact-route-head">
                    <div><strong>Run with</strong><span>{route.cost} estimated</span></div>
                    <button aria-label="Close agent selector" onClick={() => setRouteOpen(false)}><Icon name="x" className="icon sm" /></button>
                  </div>

                  <div className="compact-route-section">
                    <span className="compact-route-label">Harness</span>
                    <div className="harness-quick-grid">
                      {HARNESS_PICKER_OPTIONS.map((option) => (
                        <button
                          key={option.id}
                          className={pickerProvider === option.id ? 'active' : ''}
                          onClick={() => {
                            setProviderOv(option.id)
                            setHarnessOv(option.id === 'auto' ? 'auto' : 'coding')
                            const nextModels = MODEL_PICKER_OPTIONS[option.id] ?? MODEL_PICKER_OPTIONS.auto!
                            if (!nextModels.some((model) => model.id === modelOv)) setModelOv('auto')
                            setAuto(option.id === 'auto' && modelOv === 'auto')
                            setOpenRouterModelId('')
                          }}
                        >
                          <span className="quick-logo"><HarnessVisual id={option.id} /></span>
                          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                          <Icon name="check" className="icon xs quick-check" />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="compact-route-section model-section">
                    <span className="compact-route-label">Model <small>for {harnessPickerOption.label}</small></span>
                    <div className="model-quick-list">
                      {compatibleModelOptions.map((option) => (
                        <button
                          key={option.id}
                          className={modelOv === option.id ? 'active' : ''}
                          onClick={() => {
                            setModelOv(option.id)
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

        <div className="resizer" />
        <aside className="inspector">
          <div className="inspector-inner">
            <div className="inspector-header">
              <strong>{itab === 'overview' ? 'Current state' : itab[0]!.toUpperCase() + itab.slice(1)}</strong>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {itab !== 'overview' && <button className="tiny-btn" onClick={() => setItab('overview')}>Back</button>}
                <button className="tiny-btn" onClick={() => { const n = branchChat(chat.id); if (n) { nav(`/chat/${n.id}`); toast('Chat forked', n.title) } }}>Fork</button>
                <button className="icon-btn" onClick={() => setInspector(false)}><Icon name="x" className="icon sm" /></button>
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
                <button key={key} className={`itab ${itab === key ? 'active' : ''}`} onClick={() => setItab(key)}>{label}</button>
              ))}
            </div>}
            {itab === 'overview' && (
              <div className="ipanel active tf-state-rail">
                <section className="tf-state-card">
                  <div className="tf-state-heading"><span>Environment</span><Icon name="plus" className="icon sm" /></div>
                  <button className="tf-state-row" onClick={() => setItab('changes')}>
                    <Icon name="git" className="icon sm" />
                    <span>Changes</span>
                    <strong className="tf-change-count"><i>+{additions}</i> <b>−{deletions}</b></strong>
                  </button>
                  <button className="tf-state-row" onClick={() => setItab('environment')}>
                    <Icon name="terminal" className="icon sm" />
                    <span>{latestRun?.runtime ?? activeEnvironment?.name ?? 'Local'}</span>
                    <small>{latestRun ? latestRun.done ? 'Ready' : 'Running' : activeEnvironment?.status ?? 'Ready'}</small>
                  </button>
                  <div className="tf-state-row">
                    <Icon name="branch" className="icon sm" />
                    <span>{gitStatus?.branch ?? repository?.branch ?? 'main'}</span>
                    <small>{gitStatus ? `${gitStatus.ahead}↑ ${gitStatus.behind}↓` : repository?.status ?? 'local'}</small>
                  </div>
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
                  <button className="tf-state-row" disabled={!gitStatus || gitStatus.clean || gitBusy} onClick={() => void commitChanges()}>
                    <Icon name="activity" className="icon sm" />
                    <span>Commit changes</span>
                    <small>{gitBusy ? 'Working…' : gitStatus?.clean ? 'Clean' : gitStatus ? `${gitStatus.files.length} files` : 'Unavailable'}</small>
                  </button>
                  <button className="tf-state-row" disabled={!gitStatus?.ahead || gitBusy} onClick={() => void pushChanges()}>
                    <Icon name="cloud" className="icon sm" />
                    <span>Push branch</span>
                    <small>{gitStatus?.ahead ? `${gitStatus.ahead} commit${gitStatus.ahead === 1 ? '' : 's'}` : 'Up to date'}</small>
                  </button>
                  <button className="tf-state-row" disabled={!repository?.folderPath || gitBusy} onClick={() => void compareBranch()}>
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
                  <ChildRunList runs={childRuns} onOpenRun={() => setItab('activity')} />
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
                    else setItab('changes')
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
                    <strong>{latestRun?.title ?? 'Thread ready'}</strong>
                    <p>{latestRun?.statusText ?? 'Send a message to begin work in this project.'}</p>
                  </div>
                  <div className="kv"><span>Model</span><span>{latestRun?.model ?? MODEL_LABEL[route.modelKey]}</span></div>
                  <div className="kv"><span>Cost</span><span>{latestRun?.cost ?? route.cost}</span></div>
                  <button className="tf-state-view-all" onClick={() => setItab('activity')}>View activity</button>
                </section>
              </div>
            )}
            {itab === 'changes' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>{gitComparison ? `${gitComparison.base}…${gitComparison.head}` : 'Changed files'}</h4>
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
                <h4>Verification</h4>
                {(() => {
                  const checks = messages.flatMap((message) => message.run?.artifacts
                    .filter((artifact) => artifact.type === 'table' && artifact.table)
                    .flatMap((artifact) => artifact.table?.rows ?? []) ?? [])
                  return checks.length ? checks.map((check, index) => (
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
                  {(runActivity.length
                    ? runActivity.map((item) => ({
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
                <div className="kv"><span>Model</span><span>{latestRun?.model ?? MODEL_LABEL[route.modelKey]}</span></div>
                <div className="kv"><span>Harness</span><span>{latestRun?.harness ?? HARNESS_LABEL[route.harnessKey]}</span></div>
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
        <button className="icon-btn" style={{ position: 'absolute', right: 12, top: 8, zIndex: 5 }} onClick={() => setInspector(true)} title="Open inspector"><Icon name="panel" /></button>
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
                <div className="seg">{['once', 'chat', 'project', 'always'].map((s) => <button key={s} className={permScope === s ? 'active' : ''} onClick={() => setPermScope(s)}>{s}</button>)}</div>
              </div>
            </div>
            <div className="modal-actions">
              <button className="danger-btn" onClick={() => { setPerm(null); toast('Policy added', `Deny ${perm.resource}`) }}>Deny & add policy</button>
              <button className="ghost-btn" onClick={() => { setPerm(null); appendMessage({ chatId: chat.id, role: 'assistant', text: '', lightHtml: `<p>The capability <strong>${perm.resource}</strong> is outside this project's boundary, so I paused.</p>`, routingNote: 'Permission denied' }); toast('Access denied', '') }}>Deny</button>
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
  if (m.role === 'user') {
    return <div className="message user"><div className="message-body"><div className="message-text">{m.text}</div><MessageActions text={m.text} onRetry={onRetry} onBranch={onBranch} onCopyError={() => toast('Copy failed', 'Clipboard access is unavailable.')} /></div></div>
  }
  const run = m.run
  const agentOutput = m.text || run?.output || (run ? fallbackRunOutput(run) : '')
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
              <div><div className="run-title">{run.title}</div><div className="run-sub">Auto · {run.model} · {run.harness} · {run.runtime}</div></div>
              <div className={`run-live ${run.done ? 'done' : ''}`}>{run.done ? 'Done' : <><span className="spinner" /> Working</>}</div>
              {!run.done && run.id !== 'pending' && <button className="tiny-btn" onClick={() => void runRegistry.stop(run.id)}>Stop</button>}
            </div>
            <div className={`run-status ${run.done ? 'done' : ''}`}>
              {!run.done && <span className="typing-indicator" aria-label="Working"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /></span>}
              {run.done && <Icon name="check" className="icon sm tool-check" />}
              <span>{run.statusText}</span>
              {!run.done && <span className="streaming-cursor" aria-hidden="true" />}
              {run.done && run.cost && <span className="status-time">{run.tools.length} tools · {run.cost}</span>}
            </div>
            {run.inputRequest && (
              <div className={`tf-inline-request ${run.inputRequest.kind}`}>
                <Icon name={run.inputRequest.kind === 'approval' ? 'shield' : 'message'} className="icon sm" />
                <span>
                  <strong>{run.inputRequest.kind === 'approval' ? 'Approval required' : 'Agent needs your input'}</strong>
                  <small>{run.inputRequest.prompt}</small>
                </span>
              </div>
            )}
            {density !== 'summary' && !!run.plan.length && (
              <div className="plan">
                <div className="plan-head"><Icon name="review" className="icon sm" /> Task plan</div>
                {run.plan.map((p, index) => (
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
                  status="success"
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
                      {f.hunks.map((h, hunkIndex) => (
                        <div key={h.id} className={`hunk ${h.status === 'rejected' ? 'rejected' : ''}`}>
                          <div className="hunk-bar"><span>{h.range}</span><span className="hunk-actions">
                            {h.status === 'accepted' ? <span className="accepted-pill">Accepted</span> : (
                              <><button className="tiny-btn" onClick={() => onHunk(f.path, hunkIndex, h.id, 'rejected')}>Reject</button><button className="tiny-btn" onClick={() => onHunk(f.path, hunkIndex, h.id, 'accepted')}>Accept</button></>
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
