import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../../data/store'
import { CodingTaskOptions, codingTaskSpec, type CodingTaskDraft } from '../onboarding/CodingTaskOptions'
import type { FactoryBlueprint, FactoryCodingClient, FactoryDefinition, FactoryPlan, FactoryPreparation } from '../../services/factoryCoding'
import type { JourneyAuthority } from '../onboarding/ConnectedJourneySurface'
void React

const fields = (blueprint: FactoryBlueprint): string[] => {
  const found = [...blueprint.goalTemplate.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g), ...blueprint.acceptanceTemplate.flatMap(item => [...item.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)])].map(match => match[1])
  return [...new Set(found)]
}

export function FactoryStartPage() {
  const { projectId = '' } = useParams(), navigate = useNavigate(), { services } = useStore()
  const [executionId,setExecutionId] = useState('')
  return <><FactoryStartSurface key={`${projectId}:${services?.factoryCoding?.identity()??''}`} projectId={projectId} client={services?.factoryCoding} journey={services?.journey} onLaunched={runId=>navigate(`/project/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(runId)}`)}/>
    {services?.factoryExecution && <section className="content-page cc-page cc-panel" aria-label="Open existing Factory execution"><h2>Open an existing two-step execution</h2><label>Execution ID<input value={executionId} onChange={event=>setExecutionId(event.target.value.trim())} placeholder="fexec_…"/></label><button disabled={!/^fexec_[0-9a-f]{32}$/.test(executionId)} onClick={()=>navigate(`/project/${encodeURIComponent(projectId)}/factory-executions/${encodeURIComponent(executionId)}`)}>Inspect execution</button></section>}</>
}

export function FactoryStartSurface({projectId,client,journey,onLaunched}:{projectId:string;client?:FactoryCodingClient;journey?:JourneyAuthority;onLaunched:(runId:string)=>void}) {
  const generation = useRef(0), action = useRef(false)
  const [state, setState] = useState<{blueprints:FactoryBlueprint[];definitions:FactoryDefinition[];sources:Array<{sourceId:string;label:string}>;canManage:boolean;readiness:Array<{workerId:string;adapterId:string;sourceId:string;ready:boolean}>} | null>(null)
  const [error, setError] = useState(''), [busy,setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState(''), [sourceId,setSourceId] = useState('')
  const [name,setName] = useState(''), [blueprintId,setBlueprintId] = useState('')
  const [defaults,setDefaults] = useState<Record<string,string>>({})
  const [draft,setDraft] = useState<CodingTaskDraft>({enabled:true,paths:'',checks:''})
  const [values,setValues] = useState<Record<string,string>>({})
  const [preview,setPreview] = useState<FactoryPlan | null>(null)
  const [prepared,setPrepared] = useState<FactoryPreparation | null>(null)

  const reload = async () => {
    if (!client || !journey) return
    const current = ++generation.current
    setError(''); setState(null); setPreview(null); setPrepared(null)
    try {
      const [blueprints,definitions,snapshot] = await Promise.all([client.blueprints(projectId),client.definitions(projectId),journey.snapshot(projectId)])
      if (generation.current === current) setState({blueprints,definitions,sources:snapshot.sources??[],canManage:snapshot.canManage===true,readiness:snapshot.nativeAdapters??[]})
    } catch (reason) { if (generation.current === current) setError(reason instanceof Error?reason.message:String(reason)) }
  }
  useEffect(()=>{void reload();return()=>{generation.current++}},[client,journey,projectId]) // eslint-disable-line react-hooks/exhaustive-deps
  const invalidate = () => { generation.current++;setPreview(null);setPrepared(null) }
  const selected = state?.definitions.find(item => `${item.factoryId}@${item.version}` === selectedId)
  const blueprint = state?.blueprints.find(item => item.contributionId === blueprintId)
  const selectedBlueprint = selected?.blueprintCurrentlyEnabled ? state?.blueprints.find(item => item.contributionId === selected.blueprintId && item.packageId === selected.packageId && item.packageVersion === selected.packageVersion && item.manifestDigest === selected.manifestDigest) : undefined
  const selectedSource = state?.sources.some(item => item.sourceId === sourceId) ? sourceId : state?.sources[0]?.sourceId ?? ''
  const parameterFields = selectedBlueprint ? fields(selectedBlueprint) : []
  const selectedValues = Object.fromEntries(parameterFields.map(key => [key, values[key] ?? selected?.parameterDefaults[key] ?? '']))
  const codexReady = state?.readiness.some(item => item.workerId === client?.configuredWorkerId && item.sourceId === selectedSource && item.adapterId === 'codex-app-server' && item.ready)
  const mutate = async (operation: (current:()=>boolean) => Promise<void>) => {
    if (action.current) return
    action.current=true;setBusy(true);setError('')
    const at=generation.current,actor=client?.identity()
    const current=()=>generation.current===at&&client?.identity()===actor
    try { await operation(current) } catch(reason) { if(current())setError(reason instanceof Error?reason.message:String(reason)) }
    finally { action.current=false;setBusy(false) }
  }
  if (!client || !journey) return <main className="content-page cc-page"><h1>Reviewed Factory</h1><p>This personal Core does not advertise the supported single coding Run Factory.</p><Link to={`/project/${encodeURIComponent(projectId)}/new-task`}>New ordinary task</Link></main>
  return <main className="content-page cc-page"><header className="page-header"><div><span className="eyebrow">Project task</span><h1>Run a reviewed Factory</h1><p>A signed blueprint defines the Goal; Core pins the source, coding scope, adapter, worker, and exact preview before launch.</p></div></header>
    <Link to={`/project/${encodeURIComponent(projectId)}/new-task`}>New ordinary task</Link>
    {error && <p role="alert">{error}</p>}{!state ? <p role="status">Loading enabled blueprints, definitions, and Project sources…</p> : <>
      <section className="cc-panel"><h2>Choose a Factory</h2><label>Reviewed definition<select value={selectedId} disabled={busy} onChange={event=>{setSelectedId(event.target.value);setValues({});invalidate()}}><option value="">Choose an existing definition</option>{state.definitions.map(item=><option key={`${item.factoryId}@${item.version}`} value={`${item.factoryId}@${item.version}`}>{item.name} · version {item.version}</option>)}</select></label>
        {!state.definitions.length && <p>No single coding Run Factory is defined for this Project yet.</p>}
        {state.canManage && <details><summary>Create a reviewed definition</summary>{state.blueprints.length ? <><label>Enabled signed blueprint<select value={blueprintId} onChange={event=>{setBlueprintId(event.target.value);setDefaults({});invalidate()}}><option value="">Choose a blueprint</option>{state.blueprints.map(item=><option key={item.contributionId} value={item.contributionId}>{item.contributionId} · {item.packageVersion}</option>)}</select></label>{blueprint && <><p>Goal template: {blueprint.goalTemplate}</p><ul>{blueprint.acceptanceTemplate.map((item,index)=><li key={index}>{item}</li>)}</ul><p>Package {blueprint.packageId}@{blueprint.packageVersion} · manifest <code>{blueprint.manifestDigest}</code></p>{fields(blueprint).map(key=><label key={key}>{key}<input value={defaults[key]??''} onChange={event=>{setDefaults(current=>({...current,[key]:event.target.value}));invalidate()}}/></label>)}<label>Definition name<input value={name} maxLength={200} onChange={event=>{setName(event.target.value);invalidate()}}/></label><CodingTaskOptions available value={draft} onChange={setDraft} disabled={busy}/><button disabled={busy||!name.trim()||fields(blueprint).some(key=>!defaults[key]?.trim())} onClick={()=>void mutate(async(current)=>{const spec=codingTaskSpec(draft);if(!spec)throw Error('Enable and review a bounded coding scope');const created=await client.create(projectId,name.trim(),blueprint.contributionId,defaults,spec,client.adapterBinding);if(!current())return;const definitions=await client.definitions(projectId);if(!current())return;setState(previous=>previous?{...previous,definitions}:previous);setSelectedId(`${created.factoryId}@${created.version}`);setValues({});invalidate()})}>Save versioned definition</button></>}</> : <p>No enabled signed Factory blueprint is available. Install and enable one before creating a definition.</p>}</details>}
      </section>
      {selected && <section className="cc-panel"><h2>Choose source and parameters</h2><p>{selected.name} · Factory {selected.factoryId}@{selected.version} · blueprint {selected.blueprintId}</p><p>Package {selected.packageId}@{selected.packageVersion} · manifest <code>{selected.manifestDigest}</code></p><label>Project source<select value={selectedSource} disabled={busy} onChange={event=>{setSourceId(event.target.value);invalidate()}}>{state.sources.map(item=><option key={item.sourceId} value={item.sourceId}>{item.label}</option>)}</select></label>{parameterFields.map(key=><label key={key}>{key}<input value={selectedValues[key]??''} onChange={event=>{setValues(current=>({...current,[key]:event.target.value}));invalidate()}}/></label>)}<h3>Reviewed coding scope</h3><ul>{selected.codingTask.allowed_paths.map(path=><li key={path}><code>{path}</code></li>)}</ul><p>Verification: {selected.codingTask.verification_commands.map(argv=>argv.join(' ')).join(' · ')}</p>{!selectedBlueprint && <p role="alert">The definition’s signed blueprint version is no longer enabled. It cannot be launched.</p>}{selectedBlueprint && <p>Goal template: {selectedBlueprint.goalTemplate}</p>}<p>Configured Codex worker: {client.configuredWorkerId}. {codexReady?'Readiness reported for this source.':'No current readiness report for this source; Core will recheck at launch.'}</p><button disabled={busy||!selectedSource||!selectedBlueprint||parameterFields.some(key=>!selectedValues[key]?.trim())} onClick={()=>void mutate(async(current)=>{const value=await client.preview(projectId,selected.factoryId,selected.version,selectedSource,selectedValues);if(!current())return;setPreview(value);setPrepared(null)})}>Compile exact preview</button></section>}
      {preview && <section className="cc-panel"><h2>Review exact Factory plan</h2><p>Goal: {preview.objective}</p><h3>Acceptance criteria</h3><ol>{preview.criteria.map(item=><li key={item.criterionId}>{item.criterion}</li>)}</ol><p>Source {preview.source.sourceId} · revision <code>{preview.source.revision}</code> · digest <code>{preview.source.digest}</code></p><p>Codex adapter {preview.adapterVersion} · configuration <code>{preview.adapterConfigDigest}</code> · worker {client.configuredWorkerId}</p><p>Allowed paths: {preview.codingTask.allowed_paths.join(', ')}</p><p>Checks: {preview.codingTask.verification_commands.map(argv=>JSON.stringify(argv)).join(' · ')}</p><p>Requested scopes: {preview.scopes.join(', ')}</p><p>Compile digest <code>{preview.compileDigest}</code></p><p>Compilation is a preview. Preparing the Goal records it but does not launch an agent. An existing different Project Goal remains unchanged.</p>{!prepared?<button disabled={busy||!state.canManage} onClick={()=>void mutate(async(current)=>{const value=await client.prepare(preview);if(current())setPrepared(value)})}>Prepare this exact Goal</button>:<><p>Prepared Goal {prepared.goalId} · version {prepared.goalVersion} · revision {prepared.goalRevision}</p><button className="primary-btn" disabled={busy} onClick={()=>void mutate(async(current)=>{const runId=await client.launch(preview,prepared);if(current())onLaunched(runId)})}>Launch this reviewed Run once</button></>}</section>}
      <button className="secondary-btn" disabled={busy} onClick={()=>void reload()}>Refresh Project Factory state</button>
    </>}
  </main>
}
