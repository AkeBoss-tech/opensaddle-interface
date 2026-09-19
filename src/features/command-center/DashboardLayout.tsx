import React,{useEffect,useRef,useState,type ReactNode} from 'react'
import {DEFAULT_DASHBOARD_WIDGETS,type DashboardSettings,type DashboardLayout as SavedLayout} from '../../services/dashboardSettings'
void React
export interface DashboardWidget {id:string;title:string;content:ReactNode}
export function DashboardLayout({client,identity,widgets,onLayoutChange}:{onLayoutChange?:(ids:string[])=>void;client?:DashboardSettings;identity:unknown;widgets:DashboardWidget[]}){
 const [saved,setSaved]=useState<{client:DashboardSettings;identity:unknown;layout:SavedLayout}>(),[draft,setDraft]=useState<string[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0)
 const epoch=useRef(0),locked=useRef(false)
 const current=saved?.client===client&&saved?.identity===identity?saved:undefined
 useEffect(()=>{const generation=++epoch.current;setSaved(undefined);setDraft([]);setError('');setBusy(Boolean(client));locked.current=Boolean(client)
  if(client)void client.read().then(layout=>{if(generation===epoch.current){setSaved({client,identity,layout});setDraft(layout.widgets)}}).catch(()=>{if(generation===epoch.current)setError('Saved dashboard unavailable. Showing the default layout.')}).finally(()=>{if(generation===epoch.current){setBusy(false);locked.current=false}})
  return()=>{epoch.current++}
 },[client,identity,reload])
 async function save(){if(!client||!current||locked.current)return;const generation=epoch.current;locked.current=true;setBusy(true);setError('');try{const layout=await client.replace(current.layout.revision,draft);if(generation===epoch.current){setSaved({client,identity,layout});setDraft(layout.widgets)}}catch(reason){if(generation===epoch.current)setError(reason instanceof Error?reason.message:'Dashboard could not be saved. Your draft is preserved.')}finally{if(generation===epoch.current){locked.current=false;setBusy(false)}}}
 useEffect(()=>{onLayoutChange?.(current?.layout.widgets??[])},[current,onLayoutChange])
 const title=(id:string)=>widgets.find(widget=>widget.id===id)?.title??`Unavailable widget: ${id}`
 const selected=current?draft:DEFAULT_DASHBOARD_WIDGETS
 const move=(id:string,offset:number)=>setDraft(previous=>{const next=[...previous],index=next.indexOf(id),target=index+offset;if(index>=0&&target>=0&&target<next.length)[next[index],next[target]]=[next[target],next[index]];return next})
 return <section className="dashboard-layout" aria-label="Your dashboard">
  {client&&<details className="cc-panel"><summary>Customize dashboard</summary><p>Choose what appears and its order. Changes apply after saving.</p>{error&&<p role="alert">{error}</p>}{busy&&!current&&<p role="status">Loading saved layout…</p>}{current&&<><ol>{[...draft,...widgets.map(widget=>widget.id).filter(id=>!draft.includes(id))].map(id=><li key={id}><label><input type="checkbox" checked={draft.includes(id)} disabled={busy||(!draft.includes(id)&&draft.length>=32)} onChange={event=>setDraft(previous=>event.target.checked?[...previous,id]:previous.filter(value=>value!==id))}/>{title(id)}</label><button disabled={busy||draft.indexOf(id)<=0} aria-label={`Move ${title(id)} up`} onClick={()=>move(id,-1)}>↑</button><button disabled={busy||!draft.includes(id)||draft.indexOf(id)===draft.length-1} aria-label={`Move ${title(id)} down`} onClick={()=>move(id,1)}>↓</button></li>)}</ol><button disabled={busy||JSON.stringify(draft)===JSON.stringify(current.layout.widgets)} onClick={()=>void save()}>Save dashboard</button><button disabled={busy} onClick={()=>setDraft([...DEFAULT_DASHBOARD_WIDGETS])}>Use default layout</button></>}<button disabled={busy} onClick={()=>setReload(value=>value+1)}>Reload saved layout</button></details>}
  <div className="dashboard-widgets">{(current?current.layout.widgets:selected).map(id=><React.Fragment key={id}>{widgets.find(widget=>widget.id===id)?.content??<section className="cc-panel"><h2>{title(id)}</h2><p>This widget is not available in the current dashboard.</p></section>}</React.Fragment>)}{current?.layout.widgets.length===0&&<p>Your dashboard is empty. Choose widgets in Customize dashboard.</p>}</div>
 </section>
}
