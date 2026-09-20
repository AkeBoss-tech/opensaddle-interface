import React, { useRef, useState } from 'react'
import type { HarnessCapability, RegisteredLocalProject } from '../../services/contracts'
import {
  createPersonalRuntimeCommissionRequest,
  type PersonalRuntimeCommissionRequest,
} from '../../services/personalRuntimeCommissioning'

function agentStatus(id: 'codex' | 'claude', harnesses: HarnessCapability[]): string {
  const name = id === 'codex' ? 'Codex' : 'Claude Code'
  const harness = harnesses.find(row => row.id === id)
  if (!harness || harness.availability === 'missing')
    return `${name} is not installed. Install it, then reopen Settings.`
  if (harness.availability !== 'available')
    return `${name} is unavailable. Enable it, then reopen Settings.`
  if (harness.readiness === 'needs_auth' || harness.auth.state === 'not_detected')
    return `${name} needs login. Run ${id === 'codex' ? 'codex login' : 'claude auth login'} in Terminal, then reopen Settings.`
  if (harness.readiness !== 'ready')
    return `${name} readiness could not be verified. Check its login in Terminal, then reopen Settings.`
  if (!harness.resolvedPath)
    return `${name} executable could not be found. Reinstall it, then reopen Settings.`
  return `${name} is ready.`
}

type ResumeCandidate = { projectId: string; installationId: string }

export function PersonalRuntimeCommissioningForm({
  projects,
  harnesses,
  onCommission,
  resumeCandidate,
}: {
  projects: RegisteredLocalProject[]
  harnesses: HarnessCapability[]
  onCommission?: (request: PersonalRuntimeCommissionRequest) => Promise<void>
  resumeCandidate?: ResumeCandidate
}) {
  const restarting = Boolean(resumeCandidate)
  const [projectId, setProjectId] = useState(resumeCandidate?.projectId ?? '')
  const [provider, setProvider] = useState<'codex' | 'claude' | ''>(restarting ? '' : 'codex')
  const [cpu, setCpu] = useState(restarting ? '' : '2000')
  const [memory, setMemory] = useState(restarting ? '' : '4096')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const selectedProject = projects.find(project => project.projectId === resumeCandidate?.projectId)
  const available = (id: 'codex' | 'claude') => harnesses.some(harness =>
    harness.id === id && harness.availability === 'available' &&
    harness.readiness === 'ready' && harness.auth.state !== 'not_detected' &&
    Boolean(harness.resolvedPath))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    setMessage('')
    try {
      if (resumeCandidate &&
          (projectId !== resumeCandidate.projectId || !provider || !cpu || !memory))
        throw Error('Choose the existing Project, coding agent, and resource limits before restarting')
      const request = createPersonalRuntimeCommissionRequest(
        { projectId, provider: provider as 'codex' | 'claude', cpu, memory, concurrency: '1' },
        projects,
        harnesses,
      )
      if (!onCommission)
        throw Error('Personal runtime commissioning is unavailable in this desktop build')
      await onCommission(resumeCandidate
        ? { ...request, restartExistingInstallationId: resumeCandidate.installationId }
        : request)
      setMessage(restarting
        ? 'Existing runtime restarted. Connecting to its authenticated endpoint…'
        : 'Personal runtime commissioned. Connecting to its authenticated endpoint…')
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }

  return <section className="settings-card">
    <h2>{restarting ? 'Restart existing runtime' : 'Set up personal runtime'}</h2>
    <p>{restarting
      ? 'The previously commissioned runtime is offline. Choose its coding agent and resource limits again; prior launch choices were not saved. Core will check the same Project and repository before starting. Restart creates no new task; the recovered worker may claim already admitted queued tasks after Core checks.'
      : 'Choose a registered repository and an installed coding agent. Your runtime runs one task at a time on this Mac. CPU and memory values control task admission; they are not operating-system limits.'}</p>
    {resumeCandidate && !selectedProject &&
      <p role="alert">The existing Project is no longer registered here. Restart is unavailable.</p>}
    {projects.length ? <form onSubmit={event => void submit(event)}>
      <label>Project
        <select disabled={pending || restarting} value={projectId} onChange={event => setProjectId(event.target.value)}>
          <option value="">Choose a registered project</option>
          {projects.map(project => <option key={project.projectId} value={project.projectId}>{project.projectId}</option>)}
        </select>
      </label>
      {selectedProject && <p>Registered repository: <code>{selectedProject.root}</code></p>}
      <fieldset>
        <legend>Coding agent</legend>
        <label><input type="radio" name="provider" value="codex" checked={provider === 'codex'}
          disabled={pending || !available('codex')} onChange={() => setProvider('codex')}/>
          Codex {!available('codex') && '(unavailable)'}
        </label>
        <label><input type="radio" name="provider" value="claude" checked={provider === 'claude'}
          disabled={pending || !available('claude')} onChange={() => setProvider('claude')}/>
          Claude Code {!available('claude') && '(unavailable)'}
        </label>
        <p role="status">{agentStatus('codex', harnesses)}</p>
        <p role="status">{agentStatus('claude', harnesses)}</p>
      </fieldset>
      <label>CPU millicores
        <input disabled={pending} inputMode="numeric" value={cpu} onChange={event => setCpu(event.target.value)}/>
      </label>
      <label>Memory MiB
        <input disabled={pending} inputMode="numeric" value={memory} onChange={event => setMemory(event.target.value)}/>
      </label>
      <p>Maximum concurrent tasks: 1</p>
      <button className="btn btn--primary" type="submit" disabled={!onCommission || pending ||
        (restarting && (!selectedProject || !provider || !cpu || !memory))}>
        {pending ? (restarting ? 'Restarting…' : 'Commissioning…')
          : (restarting ? 'Restart existing runtime' : 'Set up runtime')}
      </button>
    </form> : <p role="status">Register a real local project before commissioning a runtime.</p>}
    {message && <p role="alert">{message}</p>}
  </section>
}
