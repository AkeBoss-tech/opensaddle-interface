import React,{useEffect,useRef,useState} from 'react'
import {useLocation} from 'react-router-dom'
import {Icon} from '../common/Icon'
void React

/** A non-modal navigation drawer: ordinary page navigation remains available. */
export function MobileNavigation(){
 const [open,setOpen]=useState(false),button=useRef<HTMLButtonElement>(null)
 const location=useLocation(),previousPath=useRef(location.pathname)
 useEffect(()=>{
  if(previousPath.current!==location.pathname){
   previousPath.current=location.pathname
   if(open){setOpen(false);button.current?.focus()}
  }
 },[location.pathname,open])
 useEffect(()=>{
  const sidebar=document.getElementById('sidebar')
  sidebar?.classList.toggle('mobile-open',open)
  if(!open)return
  sidebar?.querySelector<HTMLElement>('a[href],button:not([disabled])')?.focus()
  const dismiss=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();setOpen(false);button.current?.focus()}}
  document.addEventListener('keydown',dismiss)
  return()=>{sidebar?.classList.remove('mobile-open');document.removeEventListener('keydown',dismiss)}
 },[open])
 return <button ref={button} className="icon-btn mobile-menu" aria-label={open?'Close workspace navigation':'Open workspace navigation'} aria-controls="sidebar" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Icon name="menu"/></button>
}
