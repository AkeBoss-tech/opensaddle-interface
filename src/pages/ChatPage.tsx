import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../data/store'
import { Icon } from '../components/common/Icon'
import {
  DEMO_FLOWS, deriveRoute, HARNESS_LABEL, MODEL_LABEL, needsPermission, RUNTIME_LABEL, simulateAgentRun,
  type RouteDecision,
} from '../lib/simulation'
import type { AgentRunBlock, Harness, Message, ModelKey, RuntimeKind } from '../types'

export function ChatPage() {
  const { chatId } = useParams()
  const nav = useNavigate()
  const store = useStore()
  const { data, appendMessage, updateMessage, createChat, setActiveChat, setActiveProject, setChatVisibility, branchChat, renameChat, deleteChat, updateHunk, toast } = store
  const project = data.projects.find((p) => p.id === data.activeProjectId) ?? data.projects[0]
  const chat = data.chats.find((c) => c.id === (chatId ?? data.activeChatId))
  const messages = useMemo(() => data.messages.filter((m) => m.chatId === chat?.id).sort((a, b) => a.createdAt - b.createdAt), [data.messages, chat?.id])

  const [text, setText] = useState('')
  const [inspector, setInspector] = useState(true)
  const [itab, setItab] = useState('activity')
  const [routeOpen, setRouteOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tools, setTools] = useState(new Set(['Chrome', 'Files', 'API']))
  const [auto, setAuto] = useState(true)
  const [modelOv, setModelOv] = useState<ModelKey | 'auto'>('auto')
  const [harnessOv, setHarnessOv] = useState<Harness | 'auto'>('auto')
  const [runtimeOv, setRuntimeOv] = useState<RuntimeKind | 'auto'>('auto')
  const [route, setRoute] = useState<RouteDecision>(() => deriveRoute('', data.settings.routingPref))
  const [perm, setPerm] = useState<ReturnType<typeof needsPermission>>(null)
  const [pending, setPending] = useState('')
  const [permScope, setPermScope] = useState('once')
  const [activity, setActivity] = useState<Array<{ title: string; sub: string; kind?: string; t: string }>>([])
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const refreshRoute = (prompt: string) => {
    const r = deriveRoute(prompt, data.settings.routingPref, {
      model: modelOv === 'auto' ? undefined : modelOv,
      harness: harnessOv === 'auto' ? undefined : harnessOv,
      runtime: runtimeOv === 'auto' ? undefined : runtimeOv,
    })
    setRoute(r)
    return r
  }

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

  const runAgent = async (prompt: string, r: RouteDecision, cid: string) => {
    setActivity([{ title: 'Run started', sub: `${project.name} · ${RUNTIME_LABEL[r.runtimeKey]}`, kind: 'info', t: '0.0s' }])
    setInspector(true)
    setItab('activity')

    if (r.klass === 'chat') {
      appendMessage({
        chatId: cid, role: 'assistant', text: '',
        lightHtml: `<p>Handled directly via <strong>${MODEL_LABEL[r.modelKey]}</strong> — lightweight answer, no side effects.</p><p>Ask me to build, research, or operate on a system for a full agent run.</p>`,
        routingNote: `Auto · ${MODEL_LABEL[r.modelKey]} · ${HARNESS_LABEL[r.harnessKey]} · ${RUNTIME_LABEL[r.runtimeKey]}`,
      })
      return
    }

    const placeholder = appendMessage({
      chatId: cid, role: 'assistant', text: '',
      routingNote: `Auto · ${MODEL_LABEL[r.modelKey]} · ${HARNESS_LABEL[r.harnessKey]} · ${RUNTIME_LABEL[r.runtimeKey]}`,
      run: {
        id: 'pending', kind: r.klass === 'ops' ? 'ops' : r.klass === 'browser' ? 'browser' : r.klass === 'research' ? 'research' : 'coding',
        title: 'Agent run', model: MODEL_LABEL[r.modelKey], harness: HARNESS_LABEL[r.harnessKey], runtime: RUNTIME_LABEL[r.runtimeKey],
        statusText: 'Planning', done: false, tools: [], plan: [], artifacts: [],
      },
    })

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
    toast('Access granted', `Scope: ${permScope}`)
    setActivity((a) => [...a, { title: 'Permission granted', sub: perm?.resource ?? '', kind: 'info', t: 'now' }])
    if (chat) {
      const r = refreshRoute(pending)
      await runAgent(pending, r, chat.id)
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
                <div className="welcome-logo"><Icon name="spark" className="icon xl" /></div>
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
                <MessageView key={m.id} m={m} onHunk={(hid, st) => updateHunk(m.id, hid, st)} toast={toast} />
              ))}
            </div>
          </div>

          <div className="composer-wrap">
            <div className="composer" id="composer">
              <div className="composer-context">
                <span className="context-chip"><Icon name="folder" className="icon sm" />{project.name}</span>
                <span className="context-chip branch"><Icon name="vm" className="icon sm" />{RUNTIME_LABEL[route.runtimeKey].split(' ')[0]}</span>
                <span className="context-chip branch"><Icon name="branch" className="icon sm" />{chat.visibility}</span>
                <span className="context-chip runtime">{route.runtimeKey === 'local' ? 'No cloud runtime allocated' : RUNTIME_LABEL[route.runtimeKey]}</span>
              </div>
              <textarea
                value={text}
                onChange={(e) => { setText(e.target.value); refreshRoute(e.target.value) }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
                placeholder="Do anything"
                rows={1}
              />
              <div className="composer-bottom">
                <button className="composer-btn" onClick={() => toast('Attach files', 'Mock file picker.')}><Icon name="plus" className="icon sm" /></button>
                <button className="composer-btn" onClick={() => { setRouteOpen(false); setToolsOpen((v) => !v) }}><Icon name="tools" className="icon sm" />Tools</button>
                <button className="composer-btn access" onClick={() => toast('Scoped access', `${project.name} boundary enforced.`)}><Icon name="shield" className="icon sm" />Scoped access</button>
                <span className="composer-spacer" />
                <button className={`route-pill ${auto ? '' : 'manual'}`} onClick={() => { setToolsOpen(false); setRouteOpen((v) => !v); refreshRoute(text || pending || 'build a feature') }}>
                  {auto && <span className="pulse" />}
                  <span className="route-seg">{auto ? 'Auto' : 'Manual'}</span><span className="sep">·</span>
                  <span className="route-seg">{MODEL_LABEL[route.modelKey].split(' ')[0]} {MODEL_LABEL[route.modelKey].split(' ')[1] ?? ''}</span><span className="sep">·</span>
                  <span className="route-seg">{HARNESS_LABEL[route.harnessKey]}</span><span className="sep">·</span>
                  <span className="route-seg">{RUNTIME_LABEL[route.runtimeKey].split(' ')[0]}</span>
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
                  <div className="rp-head"><strong>Auto routing decision</strong><p>Why this model, harness, and runtime were selected.</p></div>
                  <div className="rp-reasons">{route.reasons.map((r) => <div key={r} className="rp-reason"><Icon name="check" className="icon sm" /><span>{r}</span></div>)}</div>
                  <div className="rp-cost">Estimated cost for this run<strong>{route.cost}</strong></div>
                  <div className="rp-prefs">
                    <div className="popover-title" style={{ paddingLeft: 0 }}>Routing preferences</div>
                    {([['quality', 'Prefer highest quality'], ['fast', 'Prefer fastest'], ['cost', 'Prefer lowest cost'], ['local', 'Keep data local'], ['enterprise', 'Approved enterprise models only']] as const).map(([k, label]) => (
                      <div key={k} className={`rp-pref ${data.settings.routingPref === k ? 'active' : ''}`} onClick={() => { store.updateSettings({ routingPref: k }); setTimeout(() => refreshRoute(text || 'build'), 0); toast('Preference set', label) }}>
                        <span>{label}</span><span className="check"><Icon name="check" className="icon sm" /></span>
                      </div>
                    ))}
                  </div>
                  <div className="rp-selectors">
                    <div className="popover-title" style={{ paddingLeft: 0 }}>Override manually</div>
                    <div><label>Model</label><select value={modelOv} onChange={(e) => { setModelOv(e.target.value as ModelKey | 'auto'); setAuto(e.target.value === 'auto' && harnessOv === 'auto'); refreshRoute(text) }}><option value="auto">Auto</option><option value="gpt">GPT-5.6</option><option value="claude">Claude Opus</option><option value="sonnet">Claude Sonnet</option><option value="gemini">Gemini</option><option value="llama">Llama</option></select></div>
                    <div><label>Harness</label><select value={harnessOv} onChange={(e) => { setHarnessOv(e.target.value as Harness | 'auto'); setAuto(false); refreshRoute(text) }}><option value="auto">Auto</option><option value="chat">Chat</option><option value="research">Research</option><option value="coding">Coding</option><option value="browser">Browser</option></select></div>
                    <div><label>Runtime</label><select value={runtimeOv} onChange={(e) => { setRuntimeOv(e.target.value as RuntimeKind | 'auto'); setAuto(false); refreshRoute(text) }}><option value="auto">Auto</option><option value="local">Local</option><option value="browser">Browser</option><option value="sandbox">Cloud VM</option><option value="gpu">GPU</option></select></div>
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

function MessageView({ m, onHunk, toast }: { m: Message; onHunk: (id: string, s: 'accepted' | 'rejected') => void; toast: (t: string, m: string) => void }) {
  if (m.role === 'user') {
    return <div className="message user"><div className="message-body"><div className="message-text">{m.text}</div></div></div>
  }
  const run = m.run
  return (
    <div className="message assistant">
      {!run && <div className="assistant-avatar"><Icon name="spark" /></div>}
      <div className="message-body" style={run ? { maxWidth: 760 } : undefined}>
        {m.lightHtml && <div className="message-text" dangerouslySetInnerHTML={{ __html: m.lightHtml }} />}
        {run && (
          <div className="agent-run">
            <div className="run-top">
              <div className="run-avatar"><Icon name="spark" className="icon sm" /></div>
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
                    {a.type === 'diff' && <button className="secondary-btn" style={{ minHeight: 27 }} onClick={() => toast('Pull request created', 'PR #1933 opened (simulated).')}>Create pull request</button>}
                    {a.type === 'report' && <button className="tiny-btn" onClick={() => toast('Saved', 'Report saved to project.')}>Save to project</button>}
                  </span>
                </div>
                {a.diff?.map((f) => (
                  <details key={f.path} className="diff-file" open>
                    <summary className="diff-file-head"><span className="df-path">{f.path}</span><span className="df-right"><span className="diff-stat"><span className="add">+{f.add}</span> <span className="del">−{f.del}</span></span></span></summary>
                    <div className="diff-hunks">
                      {f.hunks.map((h) => (
                        <div key={h.id} className={`hunk ${h.status === 'rejected' ? 'rejected' : ''}`}>
                          <div className="hunk-bar"><span>{h.range}</span><span className="hunk-actions">
                            {h.status === 'accepted' ? <span className="accepted-pill">Accepted</span> : (
                              <><button className="tiny-btn" onClick={() => onHunk(h.id, 'rejected')}>Reject</button><button className="tiny-btn" onClick={() => onHunk(h.id, 'accepted')}>Accept</button></>
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
