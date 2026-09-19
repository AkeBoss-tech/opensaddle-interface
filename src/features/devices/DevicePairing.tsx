import React, { useEffect, useRef, useState } from 'react'
import type { PersonalDevice, PersonalDevicesClient } from '../../services/personalDevices'

export function DevicePairing({authority, device, onChanged}: {authority:PersonalDevicesClient;device:PersonalDevice;onChanged:()=>void}) {
  const [challenge,setChallenge] = useState<{pairingId:string;code:string;expiresAt:string}>()
  const [fingerprint,setFingerprint] = useState<string>()
  const [matches,setMatches] = useState(false)
  const [busy,setBusy] = useState(false)
  const [message,setMessage] = useState('')
  const [revoking,setRevoking] = useState(false)
  const epoch = useRef(0)
  const locked = useRef(false)
  useEffect(() => {epoch.current++; return () => {epoch.current++}}, [])
  useEffect(() => {
    if (!challenge) return
    const timer = setTimeout(() => {setChallenge(undefined);setFingerprint(undefined);setMatches(false);setMessage('Pairing code expired. Start again to get a new code.')}, Math.max(0,Date.parse(challenge.expiresAt)-Date.now()))
    return () => clearTimeout(timer)
  },[challenge])
  async function perform(operation:()=>Promise<void>) {
    if (locked.current) return
    locked.current=true;setBusy(true);setMessage('')
    const version=epoch.current
    try {await operation()} catch {if (version===epoch.current) setMessage('Pairing request failed. Check the connection and refresh before trying again.')}
    finally {if (version===epoch.current) {locked.current=false;setBusy(false)}}
  }
  function start() {
    const version=epoch.current
    setChallenge(undefined);setFingerprint(undefined);setMatches(false)
    void perform(async()=>{const result=await authority.beginPairing(device.deviceId);if(version===epoch.current)setChallenge(result)})
  }
  function inspect() {
    if (!challenge) return
    const version=epoch.current, id=challenge.pairingId
    setFingerprint(undefined);setMatches(false)
    void perform(async()=>{
      const result=await authority.inspectPairing(id,device.deviceId)
      if(version!==epoch.current)return
      if(result.state==='claimed' && result.fingerprint) {setFingerprint(result.fingerprint);setChallenge(current=>current?.pairingId===id?{...current,code:''}:current)}
      else if(result.state==='issued') setMessage('Waiting for the device to enter its pairing code.')
      else {setChallenge(undefined);setMessage('This pairing is no longer pending. Refresh the device status.');onChanged()}
    })
  }
  function confirm() {
    if(!challenge || !fingerprint || !matches || Date.parse(challenge.expiresAt)<=Date.now())return
    const version=epoch.current
    void perform(async()=>{await authority.confirmPairing(challenge.pairingId,device.deviceId,fingerprint);if(version===epoch.current){setChallenge(undefined);setFingerprint(undefined);onChanged()}})
  }
  if(!authority.pairingAvailable)return null
  return <React.Fragment>
    <div className="device-pairing">
      {device.pairingState==='paired' ? <>
        {!revoking ? <button disabled={busy || !device.enrollmentRevision} onClick={()=>setRevoking(true)}>Unpair device</button> : <div><p>Revoke this device’s pairing and prevent further authorized task operations?</p><button disabled={busy} onClick={()=>{const version=epoch.current;void perform(async()=>{await authority.unpair(device.deviceId,device.enrollmentRevision!);if(version===epoch.current)onChanged()})}}>Revoke pairing</button><button disabled={busy} onClick={()=>setRevoking(false)}>Cancel</button></div>}
      </> : !challenge ? <button disabled={busy} onClick={start}>Start pairing</button> : <div>
        {challenge.code && <><p>On the device, run <code>opensaddle device pair --server SERVER_URL</code> using the address of this OpenSaddle server. Paste this code at the hidden prompt. Another machine needs a reachable HTTPS address.</p><label>Pairing code<input readOnly value={challenge.code} autoComplete="off" spellCheck={false}/></label><p>This code expires in five minutes. Share it only with the device you are pairing.</p></>}
        {!fingerprint ? <button disabled={busy} onClick={inspect}>Check device</button> : <><p>Compare this fingerprint with the one shown on the device:</p><code className="device-fingerprint">{fingerprint}</code><label><input type="checkbox" checked={matches} disabled={busy} onChange={event=>setMatches(event.target.checked)}/>The fingerprints match</label><button disabled={busy || !matches} onClick={confirm}>Confirm pairing</button></>}
        <button disabled={busy} onClick={start}>Generate new code</button>
      </div>}
      {message && <p role="status">{message}</p>}
    </div>
  </React.Fragment>
}
