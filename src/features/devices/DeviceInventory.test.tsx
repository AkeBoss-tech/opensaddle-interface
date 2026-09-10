import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { DeviceInventory } from './DeviceInventory'
import { PersonalDevicesClient } from '../../services/personalDevices'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT = true
const row = (name: string, owner = 'owner') => ({device_id:'device_'+name, owner_subject:owner, display_name:name, platform:'macos', pairing_state:'unpaired', connection_state:'unknown', task_execution_available:false})
const reply = (items: unknown[]) => Response.json({items,next_cursor:null})
const flush = () => new Promise(resolve => setImmediate(resolve))

// PERSONAL-DEVICE-INVENTORY-UI-1: real client, controlled HTTP transport; no Core policy mocked.
test('registration retries retain one intent and inventory never claims pairing or task access', async t => {
  let saves = 0
  const bodies: unknown[] = []
  t.mock.method(globalThis, 'fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      bodies.push(JSON.parse(String(init.body))); saves++
      if (saves === 1) throw Error('Response lost')
      return Response.json(row('Laptop'))
    }
    return reply(saves ? [row('Laptop')] : [])
  })
  const authority = new PersonalDevicesClient('http://localhost', () => 'owner')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<DeviceInventory authority={authority} identity="owner"/>); await flush() })
  assert.match(JSON.stringify(view.toJSON()), /No devices yet/)
  await act(async () => { view.root.findByType('input').props.onChange({target:{value:'Laptop'}}) })
  const submit = async () => act(async () => { view.root.findByType('form').props.onSubmit({preventDefault(){}}); await flush() })
  await submit()
  assert.match(JSON.stringify(view.toJSON()), /Response lost/)
  assert.equal(view.root.findByType('input').props.disabled, true)
  await submit()
  assert.deepEqual(bodies[0], bodies[1])
  assert.deepEqual(Object.keys(bodies[0] as object).sort(), ['display_name','platform','registration_key'])
  const content = JSON.stringify(view.toJSON())
  assert.match(content, /Not paired/)
  assert.match(content, /Connection not verified/)
  assert.doesNotMatch(content, /Ready to run/)
  await act(async () => view.unmount())
})

test('replaced connection clears inventory and ignores a late response', async t => {
  let resolve!: (response: Response) => void
  t.mock.method(globalThis, 'fetch', async (url: string) => url.startsWith('http://old') ? new Promise<Response>(done => {resolve = done}) : reply([row('Current')]))
  const old = new PersonalDevicesClient('http://old', () => 'owner')
  const current = new PersonalDevicesClient('http://new', () => 'owner')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<DeviceInventory authority={old} identity="owner"/>); await flush() })
  await act(async () => { view.update(<DeviceInventory authority={current} identity="owner"/>); await flush() })
  await act(async () => { resolve(reply([row('Private-old')])); await flush() })
  assert.match(JSON.stringify(view.toJSON()), /Current/)
  assert.doesNotMatch(JSON.stringify(view.toJSON()), /Private-old/)
  await act(async () => view.unmount())
})

test('client rejects account changes during response parsing and mixed-owner pages', async t => {
  let user = 'owner'
  let resolve!: (response: Response) => void
  t.mock.method(globalThis, 'fetch', async () => new Promise<Response>(done => {resolve = done}))
  const authority = new PersonalDevicesClient('http://localhost', () => user)
  const pending = authority.list()
  user = 'different'
  resolve(reply([row('Old')]))
  await assert.rejects(pending, /account changed/)
  t.mock.method(globalThis, 'fetch', async () => reply([row('A','one'), row('B','two')]))
  await assert.rejects(authority.list(), /Invalid device inventory/)
})
