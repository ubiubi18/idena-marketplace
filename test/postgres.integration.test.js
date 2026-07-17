import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import http from 'node:http'
import test from 'node:test'
import {keccak_256} from '@noble/hashes/sha3.js'
import activateHandler from '../pages/api/key/activate'
import buyHandler from '../pages/api/key/buy'
import {findAvailableKey} from '../shared/key-store'
import {Transaction} from '../shared/models/transaction'
import {DNA_BASE} from '../shared/security'
import {closePool, createPool} from '../shared/utils/pg'
import {publicKeyCreate} from '../shared/utils/secp256k1'

const hasDatabase = Boolean(process.env.DATABASE_URL)

function privateKey(seed) {
  const key = Buffer.alloc(32)
  key[31] = seed
  return key
}

function addressForKey(key) {
  const publicKey = publicKeyCreate(key, false).slice(1)
  return `0x${Buffer.from(keccak_256(publicKey).slice(12)).toString('hex')}`
}

function responseRecorder() {
  const result = {body: null, headers: {}, statusCode: 200}
  const response = {
    end() {
      return response
    },
    json(body) {
      result.body = body
      return response
    },
    send(body) {
      result.body = body
      return response
    },
    setHeader(name, value) {
      result.headers[name] = value
      return response
    },
    status(statusCode) {
      result.statusCode = statusCode
      return response
    },
  }
  return {response, result}
}

async function startRpcFixture() {
  const state = {
    identities: new Map(),
    rejectSends: false,
    sendCount: 0,
    sendHash: `0x${'11'.repeat(32)}`,
  }
  const server = http.createServer((request, response) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      let payload
      if (body.method === 'dna_epoch') {
        payload = {result: {epoch: 1}}
      } else if (body.method === 'dna_identity') {
        payload = {
          result: state.identities.get(String(body.params?.[0]).toLowerCase()) || {
            age: 10,
            state: 'Human',
          },
        }
      } else if (body.method === 'bcn_sendRawTx') {
        state.sendCount += 1
        payload = state.rejectSends
          ? {error: {message: 'transaction rejected'}}
          : {result: state.sendHash}
      } else {
        payload = {error: {message: 'method not available'}}
      }
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify(payload))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const {port} = server.address()
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    state,
    url: `http://127.0.0.1:${port}/`,
  }
}

test('database constraints and allocation handlers reject races and replay', {skip: !hasDatabase}, async () => {
  const pool = createPool()
  await pool.query('drop table if exists keys')
  await pool.query('drop table if exists providers')
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  await pool.query(schema)
  await pool.query(
    `insert into providers (id, url, address)
     values ('provider', 'https://example.com', '0x1111111111111111111111111111111111111111')`
  )
  await pool.query(`
    insert into keys (id, key, provider_id, epoch, free)
    values ('first', 'key-1', 'provider', 1, false),
           ('second', 'key-2', 'provider', 1, false)
  `)

  const firstClient = await pool.connect()
  const secondClient = await pool.connect()
  try {
    try {
      await firstClient.query('begin')
      await secondClient.query('begin')
      const first = await findAvailableKey(firstClient, 'provider', 1, false)
      const second = await findAvailableKey(secondClient, 'provider', 1, false)
      assert.notEqual(first.id, second.id)
    } finally {
      await firstClient.query('rollback')
      await secondClient.query('rollback')
      firstClient.release()
      secondClient.release()
    }

    await pool.query(
      `update keys set hash = $1 where id = $2`,
      [`0x${'ab'.repeat(32)}`, 'first']
    )
    await assert.rejects(
      () =>
        pool.query(
          `update keys set hash = $1 where id = $2`,
          [`0x${'AB'.repeat(32)}`, 'second']
        ),
      (error) => error.code === '23505'
    )

    await pool.query('truncate table keys, providers')
    const rpc = await startRpcFixture()
    const previousProxyUrl = process.env.PROXY_URL
    const previousProxyKey = process.env.PROXY_KEY
    const previousAllowPrivate = process.env.ALLOW_PRIVATE_RPC_URLS
    process.env.PROXY_URL = rpc.url
    process.env.PROXY_KEY = 'trusted-node-key'
    process.env.ALLOW_PRIVATE_RPC_URLS = 'true'
    try {
      const providerKey = privateKey(21)
      const providerAddress = addressForKey(providerKey)
      await pool.query(
        `insert into providers (id, url, address)
         values ('provider', $1, $2)`,
        [rpc.url, providerAddress]
      )
      await pool.query(
        `insert into keys (id, key, provider_id, epoch, free)
         values ('paid-first', 'provider-key-1', 'provider', 1, false),
                ('paid-second', 'provider-key-2', 'provider', 1, false),
                ('free-first', 'provider-key-3', 'provider', 1, true)`
      )

      const payerKey = privateKey(22)
      const payer = addressForKey(payerKey)
      const payment = new Transaction(
        1,
        1,
        0,
        providerAddress,
        5n * DNA_BASE
      ).sign(payerKey)
      const first = responseRecorder()
      await buyHandler(
        {
          body: {coinbase: payer, provider: 'provider', tx: payment.toHex()},
          method: 'POST',
        },
        first.response
      )
      assert.equal(first.result.statusCode, 200)
      assert.ok(['paid-first', 'paid-second'].includes(first.result.body.id))
      assert.equal(first.result.body.txHash, rpc.state.sendHash)
      const remainingPaidId =
        first.result.body.id === 'paid-first' ? 'paid-second' : 'paid-first'

      const replay = responseRecorder()
      await buyHandler(
        {
          body: {coinbase: payer, provider: 'provider', tx: payment.toHex()},
          method: 'POST',
        },
        replay.response
      )
      assert.equal(replay.result.statusCode, 409)
      assert.match(replay.result.body, /already been used/)
      assert.equal(rpc.state.sendCount, 2)
      assert.equal(
        (await pool.query('select coinbase from keys where id = $1', [remainingPaidId]))
          .rows[0].coinbase,
        null
      )

      const underpayerKey = privateKey(23)
      const underpayment = new Transaction(
        1,
        1,
        0,
        providerAddress,
        DNA_BASE
      ).sign(underpayerKey)
      const underpaid = responseRecorder()
      await buyHandler(
        {
          body: {
            coinbase: addressForKey(underpayerKey),
            provider: 'provider',
            tx: underpayment.toHex(),
          },
          method: 'POST',
        },
        underpaid.response
      )
      assert.equal(underpaid.result.statusCode, 400)
      assert.match(underpaid.result.body, /below the provider price/)
      assert.equal(rpc.state.sendCount, 2)

      const victim = addressForKey(privateKey(24))
      await pool.query(
        `insert into keys
           (id, key, provider_id, epoch, coinbase, free, mined, hash)
         values
           ('existing-victim', 'provider-key-4', 'provider', 1, $1, false, true, $2)`,
        [victim, `0x${'22'.repeat(32)}`]
      )
      const inviteKey = privateKey(25)
      const inviteSigner = addressForKey(inviteKey)
      rpc.state.identities.set(inviteSigner, {
        inviter: {address: addressForKey(privateKey(26))},
        state: 'Invite',
      })
      rpc.state.rejectSends = true
      const activation = new Transaction(1, 1, 1, victim, 0n).sign(inviteKey)
      const rejectedActivation = responseRecorder()
      await activateHandler(
        {
          body: {
            coinbase: victim,
            providers: ['provider'],
            tx: activation.toHex(),
          },
          method: 'POST',
        },
        rejectedActivation.response
      )
      assert.equal(rejectedActivation.result.statusCode, 502)
      assert.notEqual(rejectedActivation.result.body?.id, 'existing-victim')
      assert.equal(rpc.state.sendCount, 3)
      assert.equal(
        (await pool.query("select coinbase from keys where id = 'free-first'"))
          .rows[0].coinbase,
        null
      )
    } finally {
      if (previousProxyUrl === undefined) delete process.env.PROXY_URL
      else process.env.PROXY_URL = previousProxyUrl
      if (previousProxyKey === undefined) delete process.env.PROXY_KEY
      else process.env.PROXY_KEY = previousProxyKey
      if (previousAllowPrivate === undefined) {
        delete process.env.ALLOW_PRIVATE_RPC_URLS
      } else {
        process.env.ALLOW_PRIVATE_RPC_URLS = previousAllowPrivate
      }
      await rpc.close()
    }
  } finally {
    await pool.query('drop table keys')
    await pool.query('drop table providers')
    await closePool()
  }
})
