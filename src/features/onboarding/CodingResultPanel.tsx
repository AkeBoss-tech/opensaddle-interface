import React, { useEffect, useRef, useState } from 'react'
void React
import type { CodingResult, CodingResultAuthority } from '../../services/codingResultReview'
export function CodingResultPanel({ authority, projectId, runId }: { authority: CodingResultAuthority; projectId: string; runId: string }) {
  const [state,setState] = useState<{authority:CodingResultAuthority;projectId:string;runId:string;result?:CodingResult;error?:string}>()
  const [busy,setBusy] = useState(false), generation=useRef(0), operation=useRef<symbol | undefined>(undefined), intents=useRef(new Map<string,string>())
  const refresh = async () => {
    const current=++generation.current;setState({authority,projectId,runId})
    try { const result=await authority.read(projectId,runId);if(current===generation.current)setState({authority,projectId,runId,result}) }
    catch(reason){if(current===generation.current)setState({authority,projectId,runId,error:reason instanceof Error?reason.message:String(reason)})}
  }
  useEffect(()=>{operation.current=undefined;setBusy(false);void refresh();return()=>{generation.current++;operation.current=undefined}},[authority,projectId,runId])
  const owned=state?.authority===authority&&state.projectId===projectId&&state.runId===runId?state:undefined,result=owned?.result
  const decide=async(decision:'accepted'|'rejected')=>{
    if(!result||operation.current)return
    const token=Symbol();operation.current=token;setBusy(true)
    const current=generation.current,key=JSON.stringify([projectId,runId,result.artifactId,result.artifactDigest,decision]);let intent=intents.current.get(key);if(!intent){intent=crypto.randomUUID();intents.current.set(key,intent)}
    try {await authority.decide(result,decision,intent);if(current===generation.current)await refresh()}
    catch(reason){if(current===generation.current)setState({authority,projectId,runId,error:reason instanceof Error?reason.message:String(reason)})}
    finally{if(operation.current===token){operation.current=undefined;setBusy(false)}}
  }
  return <section className="cc-panel" aria-label="Coding task result"><h2>Coding task result</h2><button disabled={busy} onClick={()=>void refresh()}>Refresh exact result</button>
    {owned?.error?<p role="alert">{owned.error}</p>:!result?<p role="status">Loading worker evidence and human review…</p>:<>
      <dl><dt>Agent execution</dt><dd>{result.executionStatus} · execution ending does not mean this task is verified or accepted</dd><dt>Worker verification</dt><dd>{result.checksStatus==='passed'?'Checks passed':result.checksStatus==='failed'?'Checks failed':'Checks not run'}</dd><dt>Human decision</dt><dd>{result.review?`${result.review.decision} by ${result.review.reviewedBy} at ${result.review.reviewedAt}`:'Not decided'}</dd><dt>Source revision</dt><dd><code>{result.sourceRevision}</code></dd></dl>
      <p>The patch is relative to the working bytes captured at launch, including any preexisting edits; the Git revision alone is not its baseline.</p>{result.baseline ? <p>Launch workspace digest <code>{result.baseline.workspaceDigest}</code></p> : <p>Launch workspace digest is unavailable.</p>}{result.observationScope && <p>{result.observationScope}</p>}<h3>Allowed files</h3><ul>{result.allowedPaths.map(path=><li key={path}><code>{path}</code></li>)}</ul><h3>Worker-captured patch</h3>{result.patch?<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:'28rem',overflow:'auto'}}>{result.patch}</pre>:<p>No file changes were captured.</p>}
      <h3>Executed checks</h3>{result.checks.length?result.checks.map((check,index)=><article key={index}><code>{JSON.stringify(check.argv)}</code><p>{check.timed_out?'Timed out':check.exit_code===null?'No exit result':`Exit ${check.exit_code}`}</p><details><summary>Check output</summary><p>{check.output_truncated === undefined ? 'Output completeness was not reported.' : check.output_truncated.some(item=>item!=='descendant_cleanup') ? `Output truncated: ${check.output_truncated.filter(item=>item!=='descendant_cleanup').join(', ')}. The displayed output is partial.` : 'No output truncation reported.'}</p>{check.output_truncated?.includes('descendant_cleanup') && <p>Remaining verification processes required cleanup.</p>}<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{check.stdout}</pre><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{check.stderr}</pre></details></article>):<p>No verification check was executed.</p>}
      {result.limitations.length>0&&<><h3>Limitations</h3><ul>{result.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul></>}
      <details><summary>Exact reviewed evidence</summary><p>Artifact <code>{result.artifactId}</code> · <code>{result.artifactDigest}</code></p>{result.baseline && <><p>Launch index <code>{result.baseline.indexDigest}</code></p>{result.baseline.files.map(file=><p key={file.path}><code>{file.path}</code> · {file.digest ?? 'File absent at launch'}</p>)}</>}{result.verificationBeforeDigest && <p>Before verification <code>{result.verificationBeforeDigest}</code></p>}{result.verificationAfterDigest && <p>After verification <code>{result.verificationAfterDigest}</code></p>}<p>Task specification <code>{result.taskSpecDigest}</code></p><p>Patch <code>{result.patchDigest}</code></p></details>
      <p>Accepting or rejecting records your judgment of these exact bytes. It does not commit, apply, push, or deploy a change.</p>
      {!result.review&&<div className="page-actions"><button disabled={busy} onClick={()=>void decide('accepted')}>Accept this exact result</button><button disabled={busy} onClick={()=>void decide('rejected')}>Reject this exact result</button></div>}
    </>}
  </section>
}
