import assert from 'node:assert/strict'
import test from 'node:test'
import {keccak_256} from '@noble/hashes/sha3.js'
import {ApiError} from '../shared/api'
import {Transaction} from '../shared/models/transaction'
import {
  assertActivationTransaction,
  assertCoinbaseSignature,
  assertPaymentTransaction,
  DNA_BASE,
  dnaToAtomic,
  normalizeProviders,
  normalizeTransactionHash,
  parseBearerToken,
  priceForIdentity,
  safeTokenEqual,
} from '../shared/security'
import {hexToUint8Array, toBuffer} from '../shared/utils/buffers'
import {publicKeyCreate, signHash} from '../shared/utils/secp256k1'

function testKey(seed) {
  const key = Buffer.alloc(32)
  key[31] = seed
  return key
}

function addressForKey(key) {
  const publicKey = publicKeyCreate(key, false).slice(1)
  return `0x${Buffer.from(keccak_256(publicKey).slice(12)).toString('hex')}`
}

function signatureForAddress(address, key) {
  const hash = keccak_256(hexToUint8Array(address))
  const {signature, recid} = signHash(hash, key)
  return Buffer.from([...signature, recid]).toString('hex')
}

test('validates signed coinbase ownership', () => {
  const key = testKey(1)
  const address = addressForKey(key)
  assert.equal(assertCoinbaseSignature(address, signatureForAddress(address, key)), address)
  assert.throws(
    () => assertCoinbaseSignature(address, signatureForAddress(address, testKey(2))),
    ApiError
  )
})

test('enforces payment signer, recipient, and identity price', () => {
  const signerKey = testKey(3)
  const signer = addressForKey(signerKey)
  const providerAddress = addressForKey(testKey(4))
  const transaction = new Transaction(
    1,
    1,
    0,
    providerAddress,
    5n * DNA_BASE
  ).sign(signerKey)

  assert.equal(
    transaction.toHex(),
    '0a240801100122141eff47bc3a10a45d4b230b5d10e37751fe6aa7182a084563918244f4000012413b1714e5af5da98d37150f4938c06d160fd654de095c8593220088d9a07d22e437b09305de34512d5dbddf4173577b173ec21a9a9b652beab065499b022416ad00'
  )

  assert.equal(
    assertPaymentTransaction(
      transaction,
      signer,
      {address: providerAddress},
      {state: 'Human'}
    ),
    signer
  )

  const underpaid = new Transaction(
    1,
    1,
    0,
    providerAddress,
    DNA_BASE
  ).sign(signerKey)
  assert.throws(
    () =>
      assertPaymentTransaction(
        underpaid,
        signer,
        {address: providerAddress},
        {state: 'Human'}
      ),
    /below the provider price/
  )
  assert.throws(
    () =>
      assertPaymentTransaction(
        transaction,
        addressForKey(testKey(5)),
        {address: providerAddress},
        {state: 'Newbie', age: 1}
      ),
    /signer does not match/
  )
})

test('binds activation transactions to their requested coinbase', () => {
  const key = testKey(6)
  const coinbase = addressForKey(testKey(7))
  const transaction = new Transaction(1, 1, 1, coinbase, 0n).sign(key)
  assert.deepEqual(assertActivationTransaction(transaction, coinbase), {
    coinbase,
    signer: addressForKey(key),
  })
  assert.throws(
    () => assertActivationTransaction(transaction, addressForKey(testKey(8))),
    /recipient does not match/
  )
  transaction.signature = null
  assert.throws(
    () => assertActivationTransaction(transaction, coinbase),
    /signature is invalid/
  )
})

test('normalizes provider lists and exact DNA prices', () => {
  assert.deepEqual(normalizeProviders(['one', 'one', 2]), ['one', '2'])
  assert.throws(() => normalizeProviders([]), ApiError)
  assert.throws(() => normalizeProviders([undefined]), ApiError)
  assert.throws(() => normalizeProviders([Number.NaN]), ApiError)
  assert.throws(() => normalizeProviders([Number.POSITIVE_INFINITY]), ApiError)
  assert.equal(priceForIdentity({state: 'Human'}), 5)
  assert.equal(priceForIdentity({state: 'Newbie', age: 1}), 0.01)
  assert.equal(dnaToAtomic('0.01'), DNA_BASE / 100n)
})

test('normalizes only full transaction hashes', () => {
  const hash = `0x${'AB'.repeat(32)}`
  assert.equal(normalizeTransactionHash(hash), hash.toLowerCase())
  assert.throws(() => normalizeTransactionHash('0x1234'), ApiError)
})

test('preserves zero-amount transaction tips and rejects unsafe integers', () => {
  const key = testKey(9)
  const transaction = new Transaction(
    1,
    1,
    0,
    addressForKey(testKey(10)),
    0n,
    0n,
    1n
  ).sign(key)
  const parsed = new Transaction().fromHex(transaction.toHex())
  assert.equal(parsed.amount, 0n)
  assert.equal(parsed.tips, 1n)
  assert.throws(() => toBuffer(Number.MAX_SAFE_INTEGER + 1), /unsigned integer/)
  assert.throws(() => toBuffer('0xnot-hex'), /invalid hex/)
})

test('compares manager tokens without accepting missing values', () => {
  assert.equal(parseBearerToken('Bearer manager-token'), 'manager-token')
  assert.equal(parseBearerToken('bearer manager-token'), 'manager-token')
  assert.equal(parseBearerToken('Bearer  manager-token'), null)
  assert.equal(parseBearerToken(`Bearer ${' '.repeat(10000)}`), null)
  assert.equal(safeTokenEqual('token', 'token'), true)
  assert.equal(safeTokenEqual('token', 'other'), false)
  assert.equal(safeTokenEqual(undefined, undefined), false)
})
