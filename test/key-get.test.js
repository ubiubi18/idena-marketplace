import assert from 'node:assert/strict'
import test from 'node:test'
import {hasMinedBlock} from '../pages/api/key/get'

test('only treats a concrete non-mempool block hash as mined', () => {
  assert.equal(hasMinedBlock(null), false)
  assert.equal(hasMinedBlock({}), false)
  assert.equal(hasMinedBlock({blockHash: ''}), false)
  assert.equal(
    hasMinedBlock({
      blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    }),
    false
  )
  assert.equal(hasMinedBlock({blockHash: '0xabc'}), true)
})
