import React from 'react'
import assert from 'node:assert/strict'
import test from 'node:test'
import {renderToStaticMarkup} from 'react-dom/server'
import {MemoryRouter} from 'react-router-dom'
import {CommandPalette,usePaletteItems} from './CommandPalette'

// The standalone tsx runner uses classic JSX; Vite uses the automatic runtime.
;(globalThis as any).React=React

// PALETTE-SAFE-ACTIONS-1: accessible choices do not introduce destructive defaults.
test('palette exposes semantic choices and its default actions preserve user data',()=>{
 let labels:string[]=[],danger:string[]=[],calls:string[]=[]
 function View(){
  const items=usePaletteItems({go:()=>{},newChat:()=>calls.push('chat'),createProject:()=>calls.push('project'),toggleTheme:()=>calls.push('theme')})
  labels=items.map(item=>item.label)
  danger=items.filter(item=>item.tone==='danger').map(item=>item.id)
  return <CommandPalette open onClose={()=>{}} items={items}/>
 }
 const markup=renderToStaticMarkup(<MemoryRouter><View/></MemoryRouter>)
 assert.match(markup,/role="combobox"/)
 assert.match(markup,/role="listbox"/)
 assert.match(markup,/role="option"/)
 assert.match(markup,/aria-selected="true"/)
 assert.match(markup,/aria-activedescendant="palette-item-chat"/)
 assert.ok(labels.includes('Settings'))
 assert.ok(labels.includes('New chat'))
 assert.deepEqual(danger,[])
 assert.deepEqual(calls,[],'rendering the palette must not run actions')
 assert.doesNotMatch(labels.join(' '),/delete|reset|erase|clear data/i)
})
