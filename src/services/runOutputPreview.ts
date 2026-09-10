/** Core Run text previews; final artifacts remain the durable output. */
export async function readRunOutputPreview({url,headers,signal,runId,current,onText}:{url:string;headers:Record<string,string>;signal:AbortSignal;runId:string;current:()=>boolean;onText:(text:string)=>void}){
 const response=await fetch(url,{headers,signal,cache:'no-store'})
 if(!response.ok||!response.body)throw Error('Live preview unavailable')
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true})
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true})
 let worker='',buffer='',text='',eventSequence=0,epoch=0,outputSequence=0,bytes=0
 function frame(value:string){
  const data=value.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n')
  if(!data)return
  if(signal.aborted||!current())throw Error('Preview account changed')
  const event=JSON.parse(data)
  if(event.run_id!==runId||!Number.isSafeInteger(event.sequence)||event.sequence<=eventSequence||typeof event.type!=='string')throw Error('Invalid Run preview event')
  eventSequence=event.sequence
  if(event.type!=='worker.output.delta')return
  const chunk=event.payload
  if(!chunk||!Number.isSafeInteger(chunk.lease_epoch)||chunk.lease_epoch<1||!Number.isSafeInteger(chunk.output_sequence)||chunk.output_sequence<1||chunk.output_sequence>2048||typeof chunk.text!=='string'||!chunk.text||Array.from(chunk.text).length>8192||typeof chunk.worker_id!=='string'||!chunk.worker_id||chunk.verification!=='not_assessed')throw Error('Invalid Run preview chunk')
  if(chunk.lease_epoch!==epoch){if(chunk.lease_epoch<=epoch||chunk.output_sequence!==1)throw Error('Invalid preview attempt');epoch=chunk.lease_epoch;outputSequence=0;text='';worker=chunk.worker_id}
  if(chunk.worker_id!==worker)throw Error('Preview worker changed')
  if(chunk.output_sequence!==outputSequence+1)throw Error('Preview sequence gap')
  bytes+=new TextEncoder().encode(chunk.text).byteLength
  if(bytes>512000)throw Error('Preview exceeds supported size')
  outputSequence=chunk.output_sequence;text+=chunk.text;onText(text)
 }
 try{
  while(true){
   const part=await reader.read()
   if(part.done)break
   if(signal.aborted||!current())throw Error('Preview account changed')
   buffer+=decoder.decode(part.value,{stream:true})
   // Core emits LF; normalize CRLF without corrupting a split CRLF pair.
   buffer=buffer.replace(/\r\n/g,'\n')
   let end:number
   while((end=buffer.indexOf('\n\n'))>=0){const value=buffer.slice(0,end);buffer=buffer.slice(end+2);if(value.length>65536)throw Error('Preview frame too large');frame(value)}
   if(buffer.length>65536)throw Error('Preview frame too large')
  }
  decoder.decode()
  throw Error('Live preview ended')
 }finally{signal.removeEventListener('abort',cancel);await reader.cancel().catch(()=>{});reader.releaseLock()}
}
