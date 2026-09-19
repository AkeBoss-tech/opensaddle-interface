export type SignedPackageUpload={manifest:{package_id:string;version:string;publisher_id:string;display_name:string;[key:string]:unknown};key_id:string;signature_base64:string;files_base64:Record<string,string>}
export type PublisherKey={publisher_id:string;key_id:string;fingerprint:string;revoked_at:string|null}
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9._~-]{1,200}$/.test(value)
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value)
export function parseSignedPackage(text:string):SignedPackageUpload{
 if(new TextEncoder().encode(text).length>262144)throw Error('This desktop preview accepts package files up to 256 KiB, including encoded content.')
 const value:unknown=JSON.parse(text)
 if(!object(value)||Object.keys(value).sort().join(',')!=='files_base64,key_id,manifest,signature_base64'||!object(value.manifest)||!identifier(value.manifest.package_id)||!identifier(value.manifest.version)||!identifier(value.manifest.publisher_id)||typeof value.manifest.display_name!=='string'||value.manifest.display_name.length>200||!identifier(value.key_id)||typeof value.signature_base64!=='string'||value.signature_base64.length>1000||!object(value.files_base64)||Object.keys(value.files_base64).length>256||Object.values(value.files_base64).some(v=>typeof v!=='string'))throw Error('Choose a signed package JSON file containing manifest, key_id, signature_base64 and files_base64.')
 return value as SignedPackageUpload
}
export async function publisherFingerprint(key:string){
 let bytes:Uint8Array<ArrayBuffer>
 try{bytes=Uint8Array.from(atob(key),c=>c.charCodeAt(0))}catch{throw Error('Enter a base64 Ed25519 public key.')}
 if(bytes.length!==32)throw Error('The public key must contain 32 bytes.')
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
}
export class PersonalCatalogClient{
 private base:string;private user:()=>string;private token?:string
 constructor(base:string,user:()=>string,token?:string){this.base=base;this.user=user;this.token=token}
 identity(){return this.user()}
 private async request(path:string,body?:unknown){
  const actor=this.identity(),encoded=body===undefined?undefined:JSON.stringify(body)
  if(encoded&&new TextEncoder().encode(encoded).length>262144)throw Error('Package exceeds the desktop upload limit.')
  const response=await fetch(this.base.replace(/\/$/,'')+'/api/v2/personal-runtime/catalog'+path,{method:body===undefined?'GET':'POST',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'X-OpenSaddle-User':actor,...(this.token?{Authorization:'Bearer '+this.token}:{}),...(encoded?{'Content-Type':'application/json'}:{})},body:encoded})
  const result=await response.json()
  if(actor!==this.identity())throw Error('Account changed. Reload the catalog before continuing.')
  if(!response.ok){if(response.status===404)return null;throw Error(response.status===403?'The installation owner must authorize this operation, and the package must have a valid trusted signature.':response.status===409?'Publisher or package identity conflicts with existing catalog state.':'The catalog operation could not be confirmed. Check the runtime and reload before retrying.')}
  return result
 }
 async publisher(publisher:string,key:string):Promise<PublisherKey|null>{
  if(!identifier(publisher)||!identifier(key))throw Error('Invalid publisher identity.')
  const result=await this.request(`/publishers/${publisher}/keys/${key}`)
  if(result===null)return null
  if(result.publisher_id!==publisher||result.key_id!==key||!/^[a-f0-9]{64}$/.test(result.fingerprint)||!(result.revoked_at===null||typeof result.revoked_at==='string'))throw Error('Publisher identity could not be confirmed.')
  return result
 }
 async trust(publisher:string,key:string,publicKey:string){
  if(!identifier(publisher)||!identifier(key))throw Error('Invalid publisher identity.')
  const actor=this.identity(),fingerprint=await publisherFingerprint(publicKey)
  if(actor!==this.identity())throw Error('Account changed. Reload the catalog before continuing.')
  const result=await this.request('/publishers',{publisher_id:publisher,key_id:key,public_key_base64:publicKey})
  if(!result||result.publisher_id!==publisher||result.key_id!==key||result.fingerprint!==fingerprint||result.revoked_at!==null)throw Error('Publisher trust could not be confirmed.')
  return result as PublisherKey
 }
 async install(value:SignedPackageUpload){
  const upload=parseSignedPackage(JSON.stringify(value)),result=await this.request('/packages',upload),item=result?.package
  if(result?.code_loaded!==false||item?.package_id!==upload.manifest.package_id||item?.version!==upload.manifest.version||item?.publisher_id!==upload.manifest.publisher_id||item?.key_id!==upload.key_id||!/^[a-f0-9]{64}$/.test(item?.manifest_digest))throw Error('Exact package installation could not be confirmed. Reload before retrying.')
  return item as {package_id:string;version:string;manifest_digest:string}
 }
}
