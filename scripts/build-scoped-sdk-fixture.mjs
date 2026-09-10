/** Build self-contained fragments for Core's disposable signed fixture. */
import {build} from 'esbuild'
import {mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const destination=process.argv[2]
if(!destination)throw Error('Usage: node scripts/build-scoped-sdk-fixture.mjs OUTPUT_DIRECTORY')
await mkdir(destination,{recursive:true})
for(const scope of ['user','team']){
 const result=await build({stdin:{contents:`
import {connectScopedView} from './packages/scoped-view-sdk/index.js';
let count=0;
const byId=id=>document.getElementById(id);
const view=connectScopedView({scope:${JSON.stringify(scope)},onInit(value){
 count=Number(value.state?.filter)||0;
 byId('scope').textContent=value.scope.kind+': '+value.scope.id;
 byId('count').textContent='Count: '+count;
 byId('settings').hidden=!value.capabilities.includes('view.settings.read');
 byId('devices').hidden=!value.capabilities.includes('owner.devices.read');
}});
byId('count').onclick=()=>{byId('count').textContent='Count: '+(++count);view.saveState({filter:String(count)});};
byId('refresh').onclick=async()=>{try{const page=await view.readDevices();byId('result').textContent='Devices: '+page.items.length+'; authority: '+page.task_authority;}catch(error){byId('result').textContent=error.message;}};
byId('read-settings').onclick=async()=>{try{const value=await view.readSettings();byId('settings-result').textContent=value.scope.kind+': '+value.values.density+' (revision '+value.revision+')';}catch(error){byId('settings-result').textContent=error.message;}};
addEventListener('pagehide',()=>view.dispose(),{once:true});
`,resolveDir:fileURLToPath(new URL('..',import.meta.url)),sourcefile:'scoped-sdk-fixture.js'},bundle:true,write:false,format:'iife',platform:'browser',target:'es2022'})
 const js=result.outputFiles[0].text.replaceAll('</script','<\\/script')
 const html=`<style>body{font:16px system-ui;background:#17191c;color:#f1f2f4;padding:24px}button{font:inherit;padding:10px;margin:8px 0}output{display:block}</style><h1>Bundled scoped SDK</h1><p id="scope">Waiting for initialization…</p><button id="count">Count: 0</button><section id="devices" hidden><h2>Owner devices</h2><button id="refresh">Read devices</button><output id="result">Not requested</output></section><section id="settings" hidden><button id="read-settings">Read view settings</button><output id="settings-result">Not requested</output></section><script>${js}</script>`
 await writeFile(resolve(destination,`scoped-${scope}.html`),html)
}
console.log('Built user and Team SDK fragments')
