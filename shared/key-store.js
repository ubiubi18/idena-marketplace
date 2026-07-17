import {ApiError} from './api'
import {normalizeTransactionHash} from './security'
import {createPool, withTransaction} from './utils/pg'

export async function withCoinbaseLock(coinbase, epoch, callback) {
  return withTransaction(async (client) => {
    await client.query('select pg_advisory_xact_lock(hashtext($1))', [
      `${epoch}:${coinbase}`,
    ])
    return callback(client)
  })
}

export async function findAvailableKey(client, providerId, epoch, free) {
  const result = await client.query(
    `
select k.id, k.key, k.provider_id, p.url
from keys k
inner join providers p on p.id = k.provider_id
where k.provider_id = $1
  and k.epoch = $2
  and k.coinbase is null
  and k.free = $3
for update of k skip locked
limit 1`,
    [providerId, epoch, free]
  )
  return result.rows[0] || null
}

export async function getAvailableProviderIds(epoch, free) {
  const result = await createPool().query(
    `
select provider_id
from keys
where epoch = $1
group by provider_id
having sum(case when free = $2 and coinbase is null then 1 else 0 end) > 0`,
    [epoch, free]
  )
  return result.rows.map((row) => String(row.provider_id))
}

export async function getExistingKey(client, coinbase, epoch) {
  const result = await client.query(
    `
select id, key, provider_id, hash, mined
from keys
where epoch = $1 and coinbase = $2
order by updated_at desc
limit 1`,
    [epoch, coinbase]
  )
  return result.rows[0] || null
}

export async function assertKeyLimit(client, coinbase, epoch, limit = 4) {
  const result = await client.query(
    'select count(*)::int as count from keys where coinbase = $1 and epoch = $2',
    [coinbase, epoch]
  )
  if (Number(result.rows[0]?.count || 0) >= limit) {
    throw new ApiError(400, `address has reached the limit of ${limit} API keys`)
  }
}

export async function assertUnusedTransactionHash(client, value) {
  const hash = normalizeTransactionHash(value)
  const result = await client.query(
    'select 1 from keys where lower(hash) = $1 limit 1',
    [hash]
  )
  if (result.rows.length > 0) {
    throw new ApiError(409, 'transaction has already been used')
  }
  return hash
}

export async function reserveKey(
  client,
  key,
  {coinbase, inviter = null, mined = false, hash = null}
) {
  let result
  try {
    result = await client.query(
      `
update keys
set coinbase = $2,
    inviter = $3,
    mined = $4,
    hash = $5,
    updated_at = now()
where id = $1 and coinbase is null
returning id, key, provider_id, hash, mined`,
      [key.id, coinbase, inviter, mined, hash]
    )
  } catch (error) {
    if (error?.code === '23505' && hash) {
      throw new ApiError(409, 'transaction has already been used')
    }
    throw error
  }
  return result.rows[0] || null
}
