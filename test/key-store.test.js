import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertKeyLimit,
  assertUnusedTransactionHash,
  findAvailableKey,
  reserveKey,
} from '../shared/key-store'

test('rejects the fifth API key for an address', async () => {
  const atLimit = {query: async () => ({rows: [{count: 4}]})}
  await assert.rejects(() => assertKeyLimit(atLimit, 'coinbase', 1), /limit of 4/)

  const belowLimit = {query: async () => ({rows: [{count: 3}]})}
  await assert.doesNotReject(() => assertKeyLimit(belowLimit, 'coinbase', 1))
})

test('locks candidate rows without waiting behind another reservation', async () => {
  let statement
  let values
  const client = {
    async query(nextStatement, nextValues) {
      statement = nextStatement
      values = nextValues
      return {rows: [{id: 'key-id'}]}
    },
  }
  const key = await findAvailableKey(client, 'provider', 10, false)
  assert.equal(key.id, 'key-id')
  assert.match(statement, /for update of k skip locked/i)
  assert.deepEqual(values, ['provider', 10, false])
})

test('reservation update cannot overwrite an allocated key', async () => {
  let statement
  const client = {
    async query(nextStatement) {
      statement = nextStatement
      return {rows: [{id: 'key-id'}]}
    },
  }
  await reserveKey(client, {id: 'key-id'}, {coinbase: 'coinbase'})
  assert.match(statement, /where id = \$1 and coinbase is null/i)
})

test('rejects a transaction hash that already allocated a key', async () => {
  const hash = `0x${'ab'.repeat(32)}`
  const duplicate = {query: async () => ({rows: [{exists: 1}]})}
  await assert.rejects(
    () => assertUnusedTransactionHash(duplicate, hash),
    /already been used/
  )

  const unused = {query: async () => ({rows: []})}
  assert.equal(await assertUnusedTransactionHash(unused, hash), hash)
})
