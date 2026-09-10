import React from 'react'
import type {DeviceAssignment} from '../../services/personalDevices'
void React
export function ConsentDeadline({item}:{item:DeviceAssignment}){
 const expired=item.expired||(item.expires_at!=null&&Date.parse(item.expires_at)<=Date.now())
 return <p>{item.expires_at===undefined?'Consent deadline unavailable from this server.':item.expires_at===null?'Consent deadline: no expiry.':`Consent ${expired?'expired':'expires'}: ${item.expires_at}`}</p>
}
