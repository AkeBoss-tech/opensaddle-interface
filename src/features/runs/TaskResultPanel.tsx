import {SafeMarkdown} from '../../ui/SafeMarkdown'
import React,{useEffect,useState} from 'react'
void React
export type TaskResult = {runId:string;resource:{artifact_id:string;digest:string};text:string;codingTask?:boolean}
export interface TaskResultAuthority {review(projectId:string,runId:string):Promise<TaskResult>}

/** Published artifact text, not a fabricated conversation or success judgment. */
export function TaskResultPanel({authority,projectId,runId}:{authority:TaskResultAuthority;projectId:string;runId:string}){
 const [state,setState]=useState<{authority:TaskResultAuthority;projectId:string;runId:string;result:TaskResult}>(),[error,setError]=useState(''),[reload,setReload]=useState(0)
 useEffect(()=>{
  let stopped=false,next:ReturnType<typeof setTimeout>|undefined,deadline:ReturnType<typeof setTimeout>|undefined
  setState(undefined);setError('')
  async function read(){
   let expired=false
   deadline=setTimeout(()=>{if(!stopped){expired=true;setState(undefined);setError('Result access check timed out.')}},15000)
   try{
    const result=await authority.review(projectId,runId)
    if(result.runId!==runId||result.codingTask||typeof result.text!=='string'||!result.resource.artifact_id||!/^([a-f0-9]{64}|sha256:[a-f0-9]{64})$/i.test(result.resource.digest))throw Error('Result identity is unavailable.')
    if(!stopped&&!expired){setState({authority,projectId,runId,result});setError('')}
   }catch{if(!stopped){setState(undefined);setError('The result is unavailable. Check your connection and project access.')}}
   finally{clearTimeout(deadline);if(!stopped)next=setTimeout(()=>void read(),5000)}
  }
  void read();return()=>{stopped=true;clearTimeout(next);clearTimeout(deadline)}
 },[authority,projectId,runId,reload])
 const result=state?.authority===authority&&state.projectId===projectId&&state.runId===runId?state.result:undefined
 return <section className="cc-panel task-result-panel" aria-label="Published task result"><h2>Result</h2><p>These are published artifact bytes. Execution ending and matching bytes do not establish correctness or human acceptance.</p><button className="secondary-btn" onClick={()=>setReload(value=>value+1)}>Reload result</button>{error?<p role="alert">{error}</p>:!result?<p role="status">Loading the published result…</p>:<><div className="task-result-reading"><SafeMarkdown text={result.text}/></div><details><summary>Original text</summary><pre className="task-result-source">{result.text}</pre></details><details><summary>Exact artifact</summary><p>{result.resource.artifact_id}</p><code>{result.resource.digest}</code></details></>}</section>
}
