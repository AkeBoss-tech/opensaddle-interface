import {connectScopedView, type OwnerDevicePage} from '@opensaddle/scoped-view-sdk'

const user=connectScopedView({scope:'user',onInit(value){
  const scope:'user'=value.scope.kind
  void scope
  // @ts-expect-error Restored state requires the author's schema validation.
  value.state.filter.toLowerCase()
}})
const page:OwnerDevicePage=await user.readDevices()
const permission:'not_evaluated'=page.task_authority
void permission
if(page.next_cursor)await user.readDevices(page.next_cursor)
if(page.items[0]){
  const activity=await user.readDeviceActivity(page.items[0].device_id)
  const termination:'not_observed'=activity.process_termination
  void termination
  // @ts-expect-error Device observations do not carry execution credentials.
  page.items[0].bearer_token
}
user.saveState({filter:'active',count:1})
const team=connectScopedView({scope:'team',onInit:async(value)=>{
  const scope:'team'=value.scope.kind
  void scope
}})
const settings=await team.readSettings()
const teamScope:'team'=settings.scope.kind
void teamScope
// @ts-expect-error Team views cannot read private owner inventory.
team.readDevices()
// @ts-expect-error Team views cannot read private owner activity.
team.readDeviceActivity('device_example')
// @ts-expect-error This SDK does not execute tasks.
user.runTask({prompt:'hello'})
// @ts-expect-error Project views use the Project SDK.
connectScopedView({scope:'project',onInit(){}})
// @ts-expect-error State proposals must be JSON values.
team.saveState({handler:()=>{}})
team.dispose();user.dispose()
