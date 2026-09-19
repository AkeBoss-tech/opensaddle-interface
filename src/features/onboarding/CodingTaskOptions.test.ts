import assert from 'node:assert/strict'
import test from 'node:test'
import { codingTaskSpec, emptyCodingTaskDraft } from './CodingTaskOptions'
test('coding task scope is explicit and verification preserves literal argv', () => {
  assert.equal(codingTaskSpec(emptyCodingTaskDraft), undefined)
  assert.deepEqual(codingTaskSpec({ enabled:true,paths:'src/example.py\ntests/test_example.py',checks:'["python","-m","pytest","tests/test_example.py"]\n["printf","$(touch nope)"]' }), {
    schema_version:'opensaddle.coding-task.v1',allowed_paths:['src/example.py','tests/test_example.py'],verification_commands:[['python','-m','pytest','tests/test_example.py'],['printf','$(touch nope)']],
  })
})
test('coding task validation rejects missing bounds traversal duplicates and shell command strings', () => {
  for (const paths of ['', '../outside', '/absolute', 'file\nfile', './file', 'a/../b']) assert.throws(()=>codingTaskSpec({enabled:true,paths,checks:'["python","-m","pytest"]'}))
  for (const checks of ['', 'python -m pytest', '"python -m pytest"', '[]', '[42]', '["python",null]']) assert.throws(()=>codingTaskSpec({enabled:true,paths:'file',checks}))
})
