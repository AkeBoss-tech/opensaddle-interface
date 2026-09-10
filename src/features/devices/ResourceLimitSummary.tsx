import React from 'react'
import type {DeviceAssignment} from '../../services/personalDevices'
void React
export function ResourceLimitSummary({item}:{item:DeviceAssignment}){
 const limits=item.resource_limits
 return <div>{limits===undefined?<p>Resource limits unavailable from this server.</p>:limits===null?<p>No owner resource limits set.</p>:<><p>Shared allowance for this project across this device’s workers:</p><dl><dt>CPU (millicores)</dt><dd>{limits.cpu_millicores}</dd><dt>Memory (MiB)</dt><dd>{limits.memory_mib}</dd><dt>Concurrent demand</dt><dd>{limits.max_concurrency}</dd></dl><p>Limits apply to declared task demand at admission. They are not operating-system CPU or memory caps.</p></>}</div>
}
