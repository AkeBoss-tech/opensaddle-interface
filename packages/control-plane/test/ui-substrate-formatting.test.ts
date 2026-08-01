import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { STATE_BADGE_TONE, formatRelativeTime } from '../../../src/ui/substrateFormatting.ts'

describe('Tier 1 substrate formatting', () => {
  it('maps each actionability state to its semantic badge tone', () => {
    assert.deepEqual(STATE_BADGE_TONE, {
      blocked: 'danger',
      actionable: 'accent',
      claimed: 'warning',
      'in-progress': 'info',
      done: 'success',
    })
  })

  it('formats staleness as a compact relative time', () => {
    const now = Date.UTC(2026, 7, 1, 12)
    assert.equal(formatRelativeTime(now - 20_000, now), 'as of just now')
    assert.equal(formatRelativeTime(now - 2 * 60_000, now), 'as of 2m ago')
    assert.equal(formatRelativeTime(now - 3 * 60 * 60_000, now), 'as of 3h ago')
    assert.equal(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now), 'as of 2d ago')
  })
})
