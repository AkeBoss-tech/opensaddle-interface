import assert from 'node:assert/strict'
import test from 'node:test'
import { selectEvidenceRun } from '../src/features/evidence/runSelection.ts'

test('selects the clicked historical run rather than the latest run', () => {
  const historical = { id: 'run-historical', digest: 'sha256:historical' }
  const latest = { id: 'run-latest', digest: 'sha256:latest' }

  assert.equal(selectEvidenceRun([historical, latest], historical.id), historical)
})

test('returns no evidence run when the selected run disappears', () => {
  const remaining = { id: 'run-latest', digest: 'sha256:latest' }

  assert.equal(selectEvidenceRun([remaining], 'run-removed'), undefined)
  assert.equal(selectEvidenceRun([remaining], null), undefined)
})
