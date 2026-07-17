import pg from 'pg'

const {Pool} = pg

const POOL_KEY = Symbol.for('idena-marketplace.pg-pool')

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function createPool() {
  if (!globalThis[POOL_KEY]) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL is not configured')
    }
    globalThis[POOL_KEY] = new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: positiveInteger(
        process.env.PG_CONNECTION_TIMEOUT_MS,
        5000
      ),
      idleTimeoutMillis: positiveInteger(process.env.PG_IDLE_TIMEOUT_MS, 30000),
      idle_in_transaction_session_timeout: positiveInteger(
        process.env.PG_IDLE_TRANSACTION_TIMEOUT_MS,
        15000
      ),
      lock_timeout: positiveInteger(process.env.PG_LOCK_TIMEOUT_MS, 5000),
      max: positiveInteger(process.env.PG_POOL_MAX, 10),
      query_timeout: positiveInteger(process.env.PG_QUERY_TIMEOUT_MS, 12000),
      statement_timeout: positiveInteger(
        process.env.PG_STATEMENT_TIMEOUT_MS,
        10000
      ),
    })
  }
  return globalThis[POOL_KEY]
}

export async function withTransaction(callback) {
  const client = await createPool().connect()
  let releaseError
  try {
    await client.query('begin')
    const result = await callback(client)
    await client.query('commit')
    return result
  } catch (error) {
    try {
      await client.query('rollback')
    } catch (rollbackError) {
      releaseError = rollbackError
    }
    throw error
  } finally {
    client.release(releaseError)
  }
}

export async function closePool() {
  if (!globalThis[POOL_KEY]) return
  const pool = globalThis[POOL_KEY]
  delete globalThis[POOL_KEY]
  await pool.end()
}
