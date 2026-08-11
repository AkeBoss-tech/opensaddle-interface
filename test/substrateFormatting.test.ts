import assert from 'node:assert/strict'
import test from 'node:test'
import { STATE_BADGE_TONE, formatRelativeTime } from '../src/ui/substrateFormatting.ts'

test('maps every actionability state to a semantic tone', () => {
  assert.deepEqual(STATE_BADGE_TONE, {
    blocked: 'danger',
    actionable: 'accent',
    claimed: 'warning',
    'in-progress': 'info',
    done: 'success',
  })
})

test('covers the vocabulary without methodology-specific states', () => {
  // The five-state vocabulary is the shared contract across every methodology
  // surface. A word like "frontier" or "sprint" here would leak a view concept
  // into the substrate.
  assert.deepEqual(Object.keys(STATE_BADGE_TONE).sort(), [
    'actionable', 'blocked', 'claimed', 'done', 'in-progress',
  ])
})

test('formats relative time across minute, hour, and day boundaries', () => {
  const now = 1_000_000_000_000
  assert.equal(formatRelativeTime(now - 30_000, now), 'as of just now')
  assert.equal(formatRelativeTime(now - 2 * 60_000, now), 'as of 2m ago')
  assert.equal(formatRelativeTime(now - 59 * 60_000, now), 'as of 59m ago')
  assert.equal(formatRelativeTime(now - 3 * 3_600_000, now), 'as of 3h ago')
  assert.equal(formatRelativeTime(now - 26 * 3_600_000, now), 'as of 1d ago')
})

test('clamps a future timestamp rather than rendering negative elapsed time', () => {
  const now = 1_000_000_000_000
  assert.equal(formatRelativeTime(now + 60_000, now), 'as of just now')
})
