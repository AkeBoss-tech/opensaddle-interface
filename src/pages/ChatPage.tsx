import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import {
  DEMO_FLOWS, deriveRoute, HARNESS_LABEL, MODEL_LABEL, needsPermission, RUNTIME_LABEL, simulateAgentRun,
  type RouteDecision,
} from '../lib/simulation'
import type { AgentRunBlock, CodingProvider, Harness, Message, ModelKey, RuntimeKind } from '../types'
import { PROVIDER_NAME, ProviderLogo, providerFromLabel } from '../components/common/ProviderLogo'
import { evaluatePermissions } from '../services/permissions'
import { applyRunEvent } from '../lib/runEvents'

export function ChatPage() {
  const { chatId } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const { data, appendMessage, updateMessage, createChat, setActiveChat, setActiveProject, setChatVisibility, branchChat, renameChat, deleteChat, updateHunk, toast, services } = store
  const project = data.projects.find((p) => p.id === data.activeProjectId) ?? data.projects[0]
  const chat = data.chats.find((c) => c.id === (chatId ?? data.activeChatId))
  const messages = useMemo(() => data.messages.filter((m) => m.chatId === chat?.id).sort((a, b) => a.createdAt - b.createdAt), [data.messages, chat?.id])

  const [text, setText] = useState('')
  const [inspector, setInspector] = useState(false)
  const [itab, setItab] = useState('activity')
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
  const scrollRef = useRef<HTMLDivElement>(null)
  const runUnsub = useRef<(() => void) | null>(null)
  const attachRef = useRef<HTMLInputElement>(null)
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.run?.statusText])

  const serverRouting = Boolean(services?.controlPlane.connected) && auto
  const defaults = project?.routingDefaults
  const defaultModel = defaults?.modelKey && defaults.modelKey !== 'auto' ? defaults.modelKey : undefined
  const defaultProvider = defaults?.providerKey && defaults.providerKey !== 'auto' ? defaults.providerKey : undefined
  const defaultRuntime = defaults?.runtimeKey
  const selectedProvider = providerOv === 'auto' ? defaultProvider : providerOv
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
    setItab('activity')

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

    runUnsub.current?.()
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
            updateMessage(placeholder.id, { run: { ...run, id: started.runId } })
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
        let liveText = ''
        runUnsub.current = services.runtime.subscribe(started.runId, (event) => {
          if (event.type === 'agent.output.delta' && typeof event.payload.text === 'string') {
            liveText += event.payload.text
            updateMessage(placeholder.id, { text: liveText })
          }
          liveRun = applyRunEvent(liveRun, event)
          if (runBlock) updateMessage(placeholder.id, { run: liveRun })
          setActivity((a) => [...a, { title: event.type, sub: liveRun.statusText, t: `#${event.sequence}` }])
          if (event.type === 'agent.completed' || event.type === 'agent.failed') {
            setActivity((a) => [...a, {
              title: event.type === 'agent.completed' ? 'Run completed' : 'Run failed',
              sub: liveRun.statusText, kind: event.type === 'agent.failed' ? 'error' : 'info', t: 'done',
            }])
          }
        })
        return
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        updateMessage(placeholder.id, runBlock
          ? { run: { ...runBlock, statusText: reason, done: true } }
          : { text: `OpenSaddle could not complete this message: ${reason}` })
        setActivity((a) => [...a, { title: 'Run rejected', sub: reason, kind: 'error', t: 'now' }])
        toast('Run failed', reason)
        return
      }
    }

    await simulateAgentRun(prompt, r, (run: AgentRunBlock) => {
      updateMessage(placeholder.id, { run })
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

  if (!chat) return <div className="content-page"><div className="empty-state"><h3>No chat selected</h3></div></div>

  return (
    <section className="page active" style={{ height: '100%' }}>
      <div className={`chat-shell ${inspector ? 'inspector-open' : ''}`}>
        <div className="chat-main">
          <div className="chat-scroll" ref={scrollRef}>
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
                      setTimeout(() => send(f.prompt), 50)
                    }}>Try {f.title}</button>
                  ))}
                </div>
              </div>
            )}

            <div className={`messages ${messages.length ? 'active' : ''}`}>
              {messages.map((m) => (
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
                }} toast={toast} files={services?.files} />
              ))}
            </div>
          </div>

          <div className="composer-wrap">
            <div className="composer" id="composer">
              <div className="composer-context">
                <span className="context-chip"><Icon name="folder" className="icon sm" />{project.name}</span>
                <button className="context-gear" title={`${project.name} settings`} aria-label={`${project.name} settings`} onClick={() => nav(`/project/${project.id}`)}>
                  <Icon name="settings" className="icon sm" />
                </button>
                <button className="context-chip branch context-action" title="Change runtime" onClick={() => { setToolsOpen(false); setRouteOpen(true); refreshRoute(text || pending || 'build a feature') }}><Icon name="vm" className="icon sm" />{RUNTIME_LABEL[route.runtimeKey].split(' ')[0]}<Icon name="chevron" className="icon xs" /></button>
                <span className="context-chip branch"><Icon name="branch" className="icon sm" />{chat.visibility}</span>
                <span className="context-chip runtime">{route.runtimeKey === 'local' ? 'No cloud runtime allocated' : route.runtimeKey === 'browser' ? 'Runs in your browser' : RUNTIME_LABEL[route.runtimeKey]}</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); refreshRoute(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                placeholder="Do anything"
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
                <button className="composer-btn" title="Attach files (stored in workspace Files)" onClick={() => attachRef.current?.click()}><Icon name="plus" className="icon sm" /></button>
                <button className="composer-btn" onClick={() => { setRouteOpen(false); setToolsOpen((v) => !v) }}><Icon name="tools" className="icon sm" />Tools</button>
                <button className="composer-btn access" title="View this project's permission grants" onClick={() => nav(`/permissions/${project.id}`)}><Icon name="shield" className="icon sm" />Scoped access</button>
                <button className="composer-btn" title="Show run details" onClick={() => setInspector(true)}><Icon name="panel" className="icon sm" />Details</button>
                <span className="composer-spacer" />
                <button className={`route-pill ${auto ? '' : 'manual'}`} title={serverRouting ? 'Routed by the OpenSaddle control plane' : 'Routed locally (mock)'} onClick={() => { setToolsOpen(false); setRouteOpen((v) => !v); refreshRoute(text || pending || 'build a feature') }}>
                  {auto && <span className="pulse" />}
                  <span className="route-seg">Codex</span>
                  <Icon name="chevron" className="icon sm" />
                </button>
                <button className="send-btn" onClick={() => void send()}><Icon name="arrow" className="icon sm" /></button>
              </div>

              {toolsOpen && (
                <div className="popover tools-popover open">
                  <div className="popover-title">Available in this chat</div>
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
                  <div className="rp-head"><strong>Codex configuration</strong><p>Choose a specific model or let Codex route each task automatically.</p></div>
                  <div className="rp-reasons">{route.reasons.map((r) => <div key={r} className="rp-reason"><Icon name="check" className="icon sm" /><span>{r}</span></div>)}</div>
                  <div className="rp-cost">Estimated cost for this run<strong>{route.cost}</strong></div>
                  <div className="rp-prefs">
                    <div className="popover-title" style={{ paddingLeft: 0 }}>Codex preferences</div>
                    {([['quality', 'Prefer highest quality'], ['fast', 'Prefer fastest'], ['cost', 'Prefer lowest cost'], ['local', 'Keep data local'], ['enterprise', 'Approved enterprise models only']] as const).map(([k, label]) => (
                      <div key={k} className={`rp-pref ${data.settings.routingPref === k ? 'active' : ''}`} onClick={() => { store.updateSettings({ routingPref: k }); setTimeout(() => refreshRoute(text || 'build'), 0); toast('Preference set', label) }}>
                        <span>{label}</span><span className="check"><Icon name="check" className="icon sm" /></span>
                      </div>
                    ))}
                  </div>
                  <div className="rp-selectors">
                    <div className="popover-title" style={{ paddingLeft: 0 }}>Override manually</div>
                    <div><label>Model</label><select value={modelOv} onChange={(e) => { setModelOv(e.target.value as ModelKey | 'auto'); setAuto(e.target.value === 'auto' && harnessOv === 'auto' && providerOv === 'auto'); refreshRoute(text) }}><option value="auto">Provider default router</option><option value="gpt">GPT / balanced</option><option value="claude">Claude Opus / quality</option><option value="sonnet">Claude Sonnet / fast</option><option value="gemini">Gemini</option><option value="llama">Llama / local</option></select></div>
                    {services?.controlPlane.modelProvider === 'openrouter' && (
                      <div><label>OpenRouter free model</label><select value={openRouterModelId} onChange={(e) => setOpenRouterModelId(e.target.value)}>
                        <option value="">Auto free router</option>
                        {freeModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                      </select></div>
                    )}
                    <div><label>Harness</label><select value={harnessOv} onChange={(e) => { setHarnessOv(e.target.value as Harness | 'auto'); setAuto(false); refreshRoute(text) }}><option value="auto">Auto</option><option value="chat">Chat</option><option value="research">Research</option><option value="coding">Coding</option><option value="browser">Browser</option></select></div>
                    <div><label>Coding provider</label><select value={providerOv} onChange={(e) => { setProviderOv(e.target.value as CodingProvider); setAuto(false); if (e.target.value !== 'auto') setHarnessOv('coding') }}><option value="auto">Auto</option><option value="opensaddle">OpenSaddle agent</option><option value="codex">Codex App Server</option><option value="claude">Claude Code</option><option value="cursor">Cursor Agent</option><option value="gemini">Gemini CLI</option><option value="opencode">OpenCode</option><option value="antigravity">Antigravity CLI</option></select></div>
                    <div><label>Runtime</label><select value={runtimeOv} onChange={(e) => { setRuntimeOv(e.target.value as RuntimeKind | 'auto'); setAuto(false); refreshRoute(text) }}><option value="auto">Auto routing</option>{runtimeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>
                    <p className="rp-hint">Provider default leaves model selection to Codex, Claude Code, Cursor, Antigravity, or the selected CLI. Choose a model here only when you want to override that provider router.</p>
                  </div>
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
              <strong>Run inspector</strong>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button className="tiny-btn" onClick={() => { const n = branchChat(chat.id); nav(`/chat/${n.id}`); toast('Chat forked', n.title) }}>Fork</button>
                <button className="icon-btn" onClick={() => setInspector(false)}><Icon name="x" className="icon sm" /></button>
              </div>
            </div>
            <div className="inspector-tabs">
              {['activity', 'files', 'sources', 'env', 'perms', 'run'].map((t) => (
                <button key={t} className={`itab ${itab === t ? 'active' : ''}`} onClick={() => setItab(t)}>{t[0]!.toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
            {itab === 'activity' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Permission & tool timeline</h4>
                <div className="timeline">
                  {(activity.length ? activity : [{ title: 'Session open', sub: project.name, kind: 'info', t: 'now' }]).map((a, i) => (
                    <div key={i} className="tl-item"><span className={`tl-dot ${a.kind ?? ''}`} /><div className="tl-body"><strong>{a.title}</strong><span>{a.sub}</span></div><span className="tl-time">{a.t}</span></div>
                  ))}
                </div>
              </div></div>
            )}
            {itab === 'files' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Files touched</h4>
                {messages.flatMap((m) => m.run?.artifacts?.flatMap((a) => a.diff ?? []) ?? []).map((f) => (
                  <div key={f.path} className="insp-file"><Icon name="file" className="icon sm" /><span className="if-path">{f.path}</span><span className="if-stat"><span style={{ color: '#7bd39a' }}>+{f.add}</span> <span style={{ color: '#e79393' }}>−{f.del}</span></span></div>
                )) || <p style={{ fontSize: 11, color: 'var(--dim)' }}>No file changes yet.</p>}
              </div></div>
            )}
            {itab === 'sources' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Retrieved sources</h4>
                {data.knowledge.filter((k) => k.projectId === project.id || k.projectId === 'proj-corp').slice(0, 4).map((k) => (
                  <div key={k.id} className="insp-file"><Icon name="db" className="icon sm" /><span className="if-path">{k.name}</span><span className="if-stat">{k.sensitivity}</span></div>
                ))}
              </div></div>
            )}
            {itab === 'env' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Active runtime</h4>
                <div className="scope-box"><strong>{RUNTIME_LABEL[route.runtimeKey]}</strong><p>Selected for this chat by Auto routing / override.</p></div>
                <div className="kv"><span>Model</span><span>{MODEL_LABEL[route.modelKey]}</span></div>
                <div className="kv"><span>Harness</span><span>{HARNESS_LABEL[route.harnessKey]}</span></div>
                <button className="secondary-btn" style={{ width: '100%', marginTop: 10 }} onClick={() => nav('/environments')}>Manage environments</button>
              </div></div>
            )}
            {itab === 'perms' && (
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
            {itab === 'run' && (
              <div className="ipanel active"><div className="inspector-section" style={{ borderTop: 0 }}>
                <h4>Last routing</h4>
                <div className="trace">{route.reasons.map((r, i) => <div key={r}><span className="t-arrow">{'→ '.repeat(Math.min(i, 1))}</span>{r}</div>)}</div>
                <div className="kv" style={{ marginTop: 12 }}><span>Est. cost</span><span>{route.cost}</span></div>
              </div></div>
            )}
            {!inspector ? null : (
              <div style={{ padding: 12 }}><button className="secondary-btn" style={{ width: '100%' }} onClick={() => nav(`/project/${project.id}`)}>Configure project</button></div>
            )}
          </div>
        </aside>
      </div>

      {!inspector && (
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

function MessageView({ m, onHunk, toast, files }: {
  m: Message
  onHunk: (filePath: string, hunkIndex: number, id: string, s: 'accepted' | 'rejected') => void
  toast: (t: string, m: string) => void
  files?: { write: (path: string, content: string) => Promise<void> } | null
}) {
  if (m.role === 'user') {
    return <div className="message user"><div className="message-body"><div className="message-text">{m.text}</div></div></div>
  }
  const run = m.run
  return (
    <div className="message assistant">
      {!run && (
        <div className="assistant-avatar" title={PROVIDER_NAME[providerFromLabel(m.routingNote)]}>
          <ProviderLogo label={m.routingNote} className="provider-logo" />
        </div>
      )}
      <div className="message-body" style={run ? { maxWidth: 760 } : undefined}>
        {m.lightHtml && <div className="message-text" dangerouslySetInnerHTML={{ __html: m.lightHtml }} />}
        {!m.lightHtml && m.text && <div className="message-text">{m.text}</div>}
        {!run && !m.lightHtml && !m.text && <div className="message-thinking stale"><strong>Run unavailable</strong><span>Configure OpenRouter or an OpenAI-compatible model endpoint in Settings.</span></div>}
        {run && (
          <div className="agent-run">
            <div className="run-top">
              <div className="run-avatar" title={PROVIDER_NAME[providerFromLabel(run.model)]}><ProviderLogo label={run.model} className="provider-logo sm" /></div>
              <div><div className="run-title">{run.title}</div><div className="run-sub">Auto · {run.model} · {run.harness} · {run.runtime}</div></div>
              <div className={`run-live ${run.done ? 'done' : ''}`}>{run.done ? 'Done' : <><span className="spinner" /> Working</>}</div>
            </div>
            <div className={`run-status ${run.done ? 'done' : ''}`}>
              {!run.done && <span className="spinner" />}
              <span>{run.statusText}</span>
              {run.done && run.cost && <span className="status-time">{run.tools.length} tools · {run.cost}</span>}
            </div>
            {!!run.plan.length && (
              <div className="plan">
                <div className="plan-head"><Icon name="review" className="icon sm" /> Task plan</div>
                {run.plan.map((p) => (
                  <div key={p.label} className={`plan-step ${p.status}`}><span className="pstate"><Icon name="check" className="icon sm" /></span>{p.label}</div>
                ))}
              </div>
            )}
            <div className="run-tools">
              {run.tools.map((t) => (
                <details key={t.id} className="tcall">
                  <summary className="tcall-head" style={{ listStyle: 'none' }}>
                    <span className="tcall-ico"><Icon name={t.icon} className="icon sm" /></span>
                    <span className="tcall-name"><strong>{t.name}</strong><span>{t.input}</span></span>
                    <span className="tcall-meta"><span>{t.duration}</span><span>{t.cost}</span></span>
                  </summary>
                  <div className="tcall-body"><div className="tcall-io"><div className="io-label">Input</div>{t.input}<div className="io-label">Output</div>{t.output}</div></div>
                </details>
              ))}
            </div>
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
                {a.reportHtml && <div style={{ padding: '13px 15px', fontSize: 12, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: a.reportHtml }} />}
                {a.table && (
                  <table className="table-artifact"><thead><tr>{a.table.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{a.table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table>
                )}
              </div>
            ))}
          </div>
        )}
        {m.routingNote && <div className="routing-note"><span className="pulse" />{m.routingNote}</div>}
      </div>
    </div>
  )
}
