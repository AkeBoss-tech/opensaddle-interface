import {useEffect,useState} from 'react'
import {useParams} from 'react-router-dom'
import {useStore} from '../../data/store'
import type {HistoryDetail,HistoryHit,HistoryItem} from '../../services/historySync'
import './project-history.css'

export function ProjectHistoryPage(){
  const {projectId=''}=useParams()
  const {data,services}=useStore()
  const client=services?.historySync
  const name=data.projects.find(project=>project.id===projectId)?.name??projectId
  const [items,setItems]=useState<HistoryItem[]>([])
  const [selected,setSelected]=useState('')
  const [detail,setDetail]=useState<HistoryDetail|null>(null)
  const [query,setQuery]=useState('')
  const [hits,setHits]=useState<HistoryHit[]|null>(null)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)

  useEffect(()=>{
    let active=true
    setItems([]);setSelected('');setDetail(null);setHits(null);setError('')
    if(!client)return
    client.list(projectId).then(value=>{if(active)setItems(value)}).catch(reason=>{if(active)setError(String(reason))})
    return()=>{active=false}
  },[client,projectId])
  useEffect(()=>{
    let active=true
    setDetail(null)
    if(!client||!selected)return
    client.open(projectId,selected).then(value=>{if(active)setDetail(value)}).catch(reason=>{if(active)setError(String(reason))})
    return()=>{active=false}
  },[client,projectId,selected])
  async function search(event:React.FormEvent){
    event.preventDefault()
    if(!client||query.trim().length<2)return
    setError('')
    try{setHits(await client.search(projectId,query.trim()))}
    catch(reason){setError(String(reason))}
  }
  async function setVisibility(item:HistoryItem){
    if(!client)return
    setBusy(true);setError('')
    try{
      const updated=await client.visibility(projectId,item,item.visibility==='private'?'project':'private')
      setItems(current=>current.map(value=>value.session_id===updated.session_id?updated:value))
      setDetail(current=>current?.session_id===updated.session_id?{...current,...updated}:current)
    }catch(reason){setError(String(reason))}
    finally{setBusy(false)}
  }
  const shown=hits?hits.map(hit=>({id:hit.session_id,title:hit.title,provider:hit.provider,subtitle:hit.snippet})):items.map(item=>({id:item.session_id,title:item.title,provider:item.provider,subtitle:item.visibility==='project'?'Shared with Project':'Private'}))
  return <section className="content-page project-history" key={projectId}>
    <header><span>{name}</span><h1>Agent history</h1><p>Conversations synced from your coding agents. Search here or through the Project history API.</p></header>
    {!client?<div className="settings-card"><h2>History sync is unavailable</h2><p>Connect to an OpenSaddle server with Project history sync enabled.</p></div>:<>
      <form className="history-search" onSubmit={search}><label htmlFor="history-query">Search synced conversations</label><div><input id="history-query" value={query} onChange={event=>{setQuery(event.target.value);if(!event.target.value)setHits(null)}} placeholder="Find a decision, file, or topic" minLength={2}/><button type="submit">Search</button>{hits&&<button type="button" onClick={()=>{setHits(null);setQuery('')}}>Clear</button>}</div></form>
      {error&&<p role="alert">{error}</p>}
      <div className="history-layout"><aside aria-label="Agent conversations"><h2>{hits?'Search results':'Conversations'}</h2>{shown.length===0?<p>{hits?'No matching conversations.':'No conversations have been synced to this Project yet.'}</p>:<ul>{shown.map((item,index)=><li key={item.id+':'+index}><button className={selected===item.id?'selected':''} onClick={()=>setSelected(item.id)}><strong>{item.title}</strong><small>{item.provider==='claude'?'Claude Code':item.provider==='codex'?'Codex':'Cursor'} · {item.subtitle}</small></button></li>)}</ul>}</aside>
      <section className="history-detail" aria-label="Selected agent conversation">{detail?<><div className="history-detail-heading"><div><h2>{detail.title}</h2><p>{detail.provider==='claude'?'Claude Code':detail.provider==='codex'?'Codex':'Cursor'} · {detail.message_count} messages · {detail.visibility==='project'?'Shared with Project':'Private'}</p></div>{client.isMine(detail)&&<button disabled={busy} onClick={()=>setVisibility(detail)}>{detail.visibility==='private'?'Share with Project':'Make private'}</button>}</div><p className="history-source-note">Read-only copy. Continue native execution in the original agent.</p>{detail.truncated&&<p role="status">This copy was truncated by the collector’s size limit.</p>}<ol>{detail.messages.map(message=><li key={message.ordinal}><strong>{message.role==='user'?'You':'Agent'}</strong><p>{message.text}</p></li>)}</ol></>:selected?<p role="status">Loading conversation…</p>:<p>Select a conversation to read it.</p>}</section></div>
    </>}
  </section>
}
