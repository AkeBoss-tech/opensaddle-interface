import React, {useEffect,useState} from 'react'
import type {DeviceAssignment} from '../../services/personalDevices'
void React
export function consentExpired(item:DeviceAssignment|undefined){
 return Boolean(item&&(item.expired||(item.expires_at!=null&&Date.parse(item.expires_at)<=Date.now())))
}
/** Refresh idle controls at their next deadline, including dates beyond the timer limit. */
export function useConsentClock(items:(DeviceAssignment|undefined)[]){
 const [,tick]=useState(0)
 const deadlines=items.map(item=>item?.expires_at??'').join('|')
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined
  const schedule=()=>{
   const now=Date.now(),next=deadlines.split('|').map(Date.parse).filter(value=>Number.isFinite(value)&&value>now).sort((a,b)=>a-b)[0]
   if(next!==undefined)timer=setTimeout(()=>{tick(value=>value+1);schedule()},Math.min(next-now,2147483647))
  }
  schedule()
  return()=>{if(timer!==undefined)clearTimeout(timer)}
 },[deadlines])
}
export function ConsentDeadline({item}:{item:DeviceAssignment}){
 const expired=consentExpired(item)
 return <p>{item.expires_at===undefined?'Consent deadline unavailable from this server.':item.expires_at===null?'Consent deadline: no expiry.':`Consent ${expired?'expired':'expires'}: ${item.expires_at}`}</p>
}
