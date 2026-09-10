import {useEffect,useState} from 'react'
import {useLocation} from 'react-router-dom'
import {useStore} from '../../data/store'
export function PresentationAppearance(){const {services,data,connection}=useStore();const location=useLocation();const client=services?.presentationSettings;const identity=client?.identity();const [revision,setRevision]=useState(0)
 // A failed connection may replace clients. Keep its last rendered appearance;
 // changing account, endpoint, or location still clears the previous scope.
 useEffect(()=>{const reset=()=>{delete document.body.dataset.presentationDensity;if(data.settings.theme==='dark')document.body.removeAttribute('data-theme');else document.body.dataset.theme=data.settings.theme};reset();return reset},[connection.id,connection.baseUrl,data.currentUserId,location.pathname,data.settings.theme])
 useEffect(()=>client?.subscribe(()=>setRevision(value=>value+1)),[client])
 useEffect(()=>{let active=true;const media=window.matchMedia('(prefers-color-scheme: dark)');const project=location.pathname.match(/^\/project\/([^/]+)/)?.[1];let resolvedTheme:string|undefined
 const apply=()=>{if(!active||!resolvedTheme)return;const theme=resolvedTheme==='system'?(media.matches?'dark':'light'):resolvedTheme;if(theme==='dark')document.body.removeAttribute('data-theme');else document.body.dataset.theme=theme}
 client?.effective(project?decodeURIComponent(project):undefined).then(result=>{if(!active)return;resolvedTheme=result.values.theme;apply();document.body.dataset.presentationDensity=result.values.density??'comfortable'}).catch(()=>{})
 media.addEventListener('change',apply)
 return()=>{active=false;media.removeEventListener('change',apply)}
 },[client,identity,connection.id,connection.baseUrl,data.currentUserId,location.pathname,revision,data.settings.theme]);return null}
