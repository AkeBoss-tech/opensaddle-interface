import React,{useCallback,useEffect,useMemo,useRef,useState}from'react'
import type{ApplicationEnvelope,ApplicationProjection,ExecutableRendererManifest,RendererState}from'./executableApplication'
import{reportAnnotatorV1,reportAnnotatorV2}from'./fixturePackages'
import{APPLICATION_PROTOCOL,acceptsApplicationMessage,compatibleApplicationState,readExactRenderer,sandboxDocument,validateRendererState}from'./executableApplication'
import{DesktopApplicationHost}from'./DesktopApplicationHost'
import type{MalleableShellClient}from'../services/contracts'
void React
type Ready={kind:'ready';identity:string;document:string;nonce:string;generation:number}
type Phase={kind:'loading';identity:string}|{kind:'error';identity:string;reason:string}|Ready
const packageKey=(m:ExecutableRendererManifest)=>`${m.package_ref.package_id}:${m.package_ref.version}:${m.package_ref.manifest_digest}:${m.content_digest}`
export function SandboxApplicationHost({manifest,contentUrl,connectionKey,projection,previousManifest,onState,readyTimeoutMs=3000,fetchRenderer=fetch}:{manifest:ExecutableRendererManifest;contentUrl:string;connectionKey:string;projection:ApplicationProjection;previousManifest?:ExecutableRendererManifest;onState?:(state:RendererState)=>void;readyTimeoutMs?:number;fetchRenderer?:typeof fetch}){
 const identity=useMemo(()=>[connectionKey,projection.resource.project_id,projection.resource.run_id,projection.resource.artifact_id,projection.resource.digest,manifest.instance_id,packageKey(manifest),contentUrl].join('\0'),[connectionKey,projection.resource.project_id,projection.resource.run_id,projection.resource.artifact_id,projection.resource.digest,manifest,contentUrl]);const authorityKey=[connectionKey,projection.resource.project_id,manifest.application_id,manifest.instance_id].join('\0')
 const[phase,setPhase]=useState<Phase>({kind:'loading',identity}),frame=useRef<HTMLIFrameElement>(null),generation=useRef(0),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),saved=useRef<{authorityKey:string;manifest:ExecutableRendererManifest;value?:RendererState}>({authorityKey,manifest}),readySeen=useRef(false),loads=useRef(0),messages=useRef({at:0,count:0})
 if(saved.current.authorityKey!==authorityKey)saved.current={authorityKey,manifest}
 useEffect(()=>{const current=++generation.current,nonce=crypto.randomUUID(),controller=new AbortController();readySeen.current=false;loads.current=0;messages.current={at:Date.now(),count:0};clearTimeout(timer.current);setPhase({kind:'loading',identity});const prior=saved.current;if(prior.authorityKey===authorityKey){const explicitlyCompatible=previousManifest&&packageKey(previousManifest)===packageKey(prior.manifest);saved.current={authorityKey,manifest,value:explicitlyCompatible?validateRendererState(compatibleApplicationState(previousManifest,manifest,prior.value),manifest.state_schema):packageKey(prior.manifest)===packageKey(manifest)?prior.value:undefined}}
  void fetchRenderer(contentUrl,{signal:controller.signal,credentials:'same-origin'}).then(response=>readExactRenderer(response,manifest)).then(document=>{if(current!==generation.current)return;setPhase({kind:'ready',identity,document:sandboxDocument(document),nonce,generation:current});timer.current=setTimeout(()=>{if(current===generation.current&&!readySeen.current)setPhase({kind:'error',identity,reason:'The application did not become ready. Host recovery remains available.'})},readyTimeoutMs)}).catch(reason=>{if(current===generation.current&&reason?.name!=='AbortError')setPhase({kind:'error',identity,reason:reason instanceof Error?reason.message:String(reason)})});return()=>{controller.abort();clearTimeout(timer.current);generation.current++}},[identity,manifest,contentUrl,authorityKey,previousManifest,readyTimeoutMs,fetchRenderer])
 useEffect(()=>{if(phase.kind!=='ready'||phase.identity!==identity)return;const active=phase;const listen=(event:MessageEvent)=>{const target=frame.current?.contentWindow??null,fence={source:target,nonce:active.nonce,generation:active.generation,instanceId:manifest.instance_id,connectionKey,packageRef:manifest.package_ref};if(!acceptsApplicationMessage(event,fence))return;const now=Date.now();if(now-messages.current.at>1000)messages.current={at:now,count:0};if(++messages.current.count>32)return;const message=event.data as ApplicationEnvelope;if(message.kind==='ready'){if(readySeen.current)return;readySeen.current=true;clearTimeout(timer.current)}else if(message.kind==='state'){const next=validateRendererState(message.state,manifest.state_schema);if(!next)return;saved.current={authorityKey,manifest,value:next};onState?.(next)}};addEventListener('message',listen);return()=>removeEventListener('message',listen)},[phase,identity,manifest,connectionKey,projection,authorityKey,onState])
 if(phase.identity!==identity||phase.kind==='loading')return <section className="cc-panel" aria-busy="true"><p role="status">Loading isolated application…</p></section>
 if(phase.kind==='error')return <section className="cc-unavailable" role="alert"><div><h2>Application unavailable</h2></div><p>{phase.reason}</p><a href="/home">Return to host recovery</a></section>
 const active=phase;return <iframe key={identity} ref={frame} title="Report annotator application" sandbox="allow-scripts" referrerPolicy="no-referrer" srcDoc={active.document} onLoad={()=>{if(active.identity!==identity||active.generation!==generation.current)return;if(++loads.current!==1){setPhase({kind:'error',identity,reason:'The application attempted unexpected navigation. Host recovery remains available.'});return}frame.current?.contentWindow?.postMessage({protocol:APPLICATION_PROTOCOL,kind:'init',nonce:active.nonce,generation:active.generation,instance_id:manifest.instance_id,connection_key:connectionKey,package_ref:manifest.package_ref,projection,state:saved.current.authorityKey===authorityKey?saved.current.value:undefined},'*')}} style={{width:'100%',minHeight:320,border:0}}/>
}

export function ExecutableApplicationFixturePage() {
 const [manifest, setManifest] = useState(reportAnnotatorV1)
 const fetchRenderer = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
  const raw = await fetch(input, init)
  return new Response(raw.body, { status: raw.status, headers: { 'Content-Type': manifest.media_type, 'Content-Length': String(manifest.size) } })
 }, [manifest])
 const desktopClient = useMemo(() => ({
  applicationRendererContent: async () => fetchRenderer(`${import.meta.env.BASE_URL}application-fixtures/${manifest.entry_file}`),
 }) as unknown as MalleableShellClient, [fetchRenderer, manifest.entry_file])
 if (!import.meta.env.DEV) return <main className="content-page"><h1>Unavailable</h1></main>
 const previous = manifest.package_ref.version === '1.0.0' ? reportAnnotatorV2 : reportAnnotatorV1
 const projection = {
  resource: { project_id: 'fixture-project', run_id: 'fixture-run', artifact_id: 'fixture-report', digest: 'a'.repeat(64) },
  text: '# Project review\nEvidence is loaded from the exact selected fixture resource.\nThe result remains unverified.',
  verified_bytes: true as const,
  fact_verification: 'not_verified' as const,
 }
 return <main className="content-page cc-page">
  <header className="cc-header"><div><span className="eyebrow">Development fixture</span><h1>Isolated report application</h1><p>Exercises signed declarative state migration and exact lifecycle fences.</p></div></header>
  <div className="page-actions"><button onClick={() => setManifest(current => current.package_ref.version === '1.0.0' ? reportAnnotatorV2 : reportAnnotatorV1)}>{manifest.package_ref.version === '1.0.0' ? 'Replace with v2' : 'Revert to v1'}</button></div>
  {window.opensaddleDesktop
   ? <DesktopApplicationHost client={desktopClient} projectId="fixture-project" manifest={manifest as never} connectionKey="development-fixture" projection={projection} allowStateTransfer />
   : <SandboxApplicationHost manifest={manifest} previousManifest={previous} contentUrl={`${import.meta.env.BASE_URL}application-fixtures/${manifest.entry_file}`} fetchRenderer={fetchRenderer} connectionKey="development-fixture" projection={projection} />}
 </main>
}
