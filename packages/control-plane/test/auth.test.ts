import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DemoSessionManager } from '../src/auth.js'

describe('local demo sessions', () => {
  it('issues opaque, revocable account sessions', () => {
    const sessions = new DemoSessionManager()
    const session = sessions.issue({ userId: 'user-ad', displayName: 'Akash Dubey' })
    assert.equal(sessions.get(session.token)?.userId, 'user-ad')
    assert.notEqual(session.token, 'user-ad')
    sessions.revoke(session.token)
    assert.equal(sessions.get(session.token), undefined)
  })
})
