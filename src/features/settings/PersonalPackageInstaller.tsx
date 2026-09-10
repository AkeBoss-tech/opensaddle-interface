import React,{useEffect,useRef,useState} from 'react'
import {parseSignedPackage,publisherFingerprint,type PersonalCatalogClient,type PublisherKey,type SignedPackageUpload} from '../../services/personalCatalog'
void React
export function PersonalPackageInstaller({client,onInstalled}:{client:PersonalCatalogClient;onInstalled:()=>void}){
 const [upload,setUpload]=useState<SignedPackageUpload>(),[publisher,setPublisher]=useState<PublisherKey|null>(),[key,setKey]=useState(''),[fingerprint,setFingerprint]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const active=useRef(true),lock=useRef(false)
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');try{await action()}catch(reason){if(active.current)setError(reason instanceof Error?reason.message:'Operation could not be confirmed.')}finally{lock.current=false;if(active.current)setBusy(false)}}
 async function load(file:File){
  setUpload(undefined);setPublisher(undefined);setKey('');setFingerprint('');setMessage('')
  if(file.size>262144)throw Error('Choose a signed package JSON file no larger than 256 KiB.')
  const candidate=parseSignedPackage(await file.text())
  if(!active.current)return
  const trusted=await client.publisher(candidate.manifest.publisher_id,candidate.key_id)
  if(active.current){setUpload(candidate);setPublisher(trusted)}
 }
 return <details className="personal-package-installer"><summary>Install a signed plug-in</summary>
  <p>Choose a package supplied by its publisher. Installation adds it to this runtime; select a view separately afterward. Only the installation owner can manage publisher trust.</p>
  <label>Signed package JSON<input aria-label="Signed package JSON" type="file" accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void run(()=>load(file))}}/></label>
  {upload&&<><h3>{upload.manifest.display_name}</h3><p>{upload.manifest.package_id} · {upload.manifest.version}</p><p>Publisher: {upload.manifest.publisher_id} · Key: {upload.key_id}</p>
   {publisher?<><p>{publisher.revoked_at?'This publisher key is revoked.':'Trusted publisher key'}</p><code style={{overflowWrap:'anywhere'}}>{publisher.fingerprint}</code></>:<><p>This publisher key is not trusted yet. Trust permits its signed packages on this installation.</p><label>Publisher public key<input aria-label="Publisher public key" value={key} maxLength={1000} disabled={busy} onChange={event=>{setKey(event.target.value.trim());setFingerprint('')}}/></label>
   <button className="secondary-btn" disabled={busy||!key} onClick={()=>void run(async()=>{const value=await publisherFingerprint(key);if(active.current)setFingerprint(value)})}>Inspect key</button>
   {fingerprint&&<><p>Confirm this fingerprint against the publisher’s source:</p><code style={{overflowWrap:'anywhere'}}>{fingerprint}</code><button className="secondary-btn" disabled={busy} onClick={()=>void run(async()=>{const value=await client.trust(upload.manifest.publisher_id,upload.key_id,key);if(active.current)setPublisher(value)})}>Trust publisher key</button></>}</>}
   <button className="secondary-btn" disabled={busy||!publisher||Boolean(publisher.revoked_at)} onClick={()=>void run(async()=>{await client.install(upload);if(active.current){setMessage('Package installed. Choose its view from the catalog.');onInstalled()}})}>Install package</button>
  </>}
  {busy&&<p role="status">Checking catalog…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 </details>
}
