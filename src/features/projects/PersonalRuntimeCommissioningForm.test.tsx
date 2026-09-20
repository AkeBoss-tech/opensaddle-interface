import assert from'node:assert/strict';import test from'node:test';import React from'react';import{act,create}from'react-test-renderer';import{PersonalRuntimeCommissioningForm}from'./PersonalRuntimeCommissioningForm';import type{HarnessCapability}from'../../services/contracts'
;(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true
const harness=(id:'codex'|'claude',ready=true)=>({id,label:id,description:id,kind:'native',availability:ready?'available':'missing',readiness:ready?'ready':'unavailable',resolvedPath:ready?`/opt/${id}`:undefined,auth:{state:'configured'},models:[],capabilities:{streaming:true,tools:true,mcp:true,skills:true,reasoningControls:true,contextMetadata:true,cancellation:true,policyControls:'native'}} as HarnessCapability)
test('mounted commissioning form exposes truthful empty and unavailable states',async()=>{let view:any;await act(async()=>{view=create(<PersonalRuntimeCommissioningForm projects={[]} harnesses={[]}/>)});assert.match(JSON.stringify(view.toJSON()),/Register a real local project/);await act(async()=>{view.update(<PersonalRuntimeCommissioningForm projects={[{projectId:'P',root:'/repo',createdAt:1}]} harnesses={[harness('codex'),harness('claude',false)]}/>) });const radios=view.root.findAllByProps({type:'radio'});assert.equal(radios[0].props.disabled,false);assert.equal(radios[1].props.disabled,true);assert.equal(view.root.findByProps({type:'submit'}).props.disabled,true)})
test('mounted form submits exact explicit request only after selection',async()=>{let request:unknown;let view:any;await act(async()=>{view=create(<PersonalRuntimeCommissioningForm projects={[{projectId:'P',root:'/repo',createdAt:1}]} harnesses={[harness('codex')]} onCommission={async value=>{request=value}}/>)});const select=view.root.findByType('select');await act(async()=>select.props.onChange({target:{value:'P'}}));await act(async()=>{await view.root.findByType('form').props.onSubmit({preventDefault(){}})});assert.deepEqual(request,{projectId:'P',workspace:'/repo',adapter:'codex',executable:'/opt/codex',cpuMillicores:2000,memoryMiB:4096,maxConcurrency:1})})
test('pending commission locks inputs and synchronously suppresses duplicate submit',async()=>{let calls=0,resolve!:()=>void;const pending=new Promise<void>(next=>{resolve=next});let view:any;await act(async()=>{view=create(<PersonalRuntimeCommissioningForm projects={[{projectId:'P',root:'/repo',createdAt:1}]} harnesses={[harness('codex')]} onCommission={async()=>{calls++;await pending}}/>)});await act(async()=>view.root.findByType('select').props.onChange({target:{value:'P'}}));const form=view.root.findByType('form');await act(async()=>{form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});await Promise.resolve()});assert.equal(calls,1);assert.equal(view.root.findByType('select').props.disabled,true);assert.match(JSON.stringify(view.toJSON()),/Commissioning/);await act(async()=>{resolve();await pending});assert.equal(view.root.findByType('select').props.disabled,false)})
test('first-run setup distinguishes provider login from missing CLI without rendering provider diagnostics',async()=>{
 let calls=0
 const project={projectId:'P',root:'/repo',createdAt:1}
 const codexNeedsLogin={...harness('codex'),readiness:'needs_auth',auth:{state:'not_detected',message:'private token: do not display',setupCommand:'secret-command'}} as HarnessCapability
 const claudeNeedsLogin={...harness('claude'),readiness:'needs_auth',auth:{state:'not_detected',message:'private token: do not display',setupCommand:'secret-command'}} as HarnessCapability
 let view:any
 await act(async()=>{view=create(<PersonalRuntimeCommissioningForm projects={[project]} harnesses={[codexNeedsLogin,harness('claude',false)]} onCommission={async()=>{calls++}}/>)})
 let displayed=JSON.stringify(view.toJSON())
 assert.match(displayed,/Codex needs login/)
 assert.match(displayed,/codex login/)
 assert.match(displayed,/Claude Code is not installed/)
 assert.doesNotMatch(displayed,/private token|secret-command/)
 assert.equal(view.root.findAllByProps({type:'radio'})[0].props.disabled,true)
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.equal(calls,0)
 await act(async()=>{view.update(<PersonalRuntimeCommissioningForm projects={[project]} harnesses={[harness('codex'),claudeNeedsLogin]} onCommission={async()=>{calls++}}/>)})
 displayed=JSON.stringify(view.toJSON())
 assert.match(displayed,/Claude Code needs login/)
 assert.match(displayed,/claude auth login/)
 assert.doesNotMatch(displayed,/Run claude login|private token|secret-command/)
 assert.equal(view.root.findAllByProps({type:'radio'})[1].props.disabled,true)
})

test('offline retained runtime requires explicit same-Project restart choices',async()=>{
 const projects=[{projectId:'P',root:'/repo',createdAt:1},{projectId:'other',root:'/other',createdAt:1}]
 let request:unknown
 let view:any
 await act(async()=>{view=create(React.createElement(PersonalRuntimeCommissioningForm,{projects,harnesses:[harness('codex')],resumeCandidate:{projectId:'P',installationId:'installation-1'},onCommission:async(value:unknown)=>{request=value}} as any))})
 assert.match(JSON.stringify(view.toJSON()),/Restart existing runtime/)
 assert.equal(view.root.findByType('select').props.value,'P')
 assert.equal(view.root.findByType('select').props.disabled,true)
 assert.equal(view.root.findByProps({type:'submit'}).props.disabled,true)
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.equal(request,undefined)
 await act(async()=>view.root.findByProps({type:'radio',value:'codex'}).props.onChange())
 const limits=view.root.findAllByProps({inputMode:'numeric'})
 await act(async()=>{limits[0].props.onChange({target:{value:'2000'}});limits[1].props.onChange({target:{value:'4096'}})})
 await act(async()=>view.root.findByType('form').props.onSubmit({preventDefault(){}}))
 assert.deepEqual(request,{projectId:'P',workspace:'/repo',adapter:'codex',executable:'/opt/codex',cpuMillicores:2000,memoryMiB:4096,maxConcurrency:1,restartExistingInstallationId:'installation-1'})
})
