import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {
  assertUnusedTransactionHash,
  assertKeyLimit,
  findAvailableKey,
  reserveKey,
  withCoinbaseLock,
} from '../../../shared/key-store'
import {Transaction} from '../../../shared/models/transaction'
import {
  assertPaymentTransaction,
  normalizeAddress,
  normalizeProviders,
} from '../../../shared/security'
import {TxType} from '../../../shared/types'
import {
  checkApiKey,
  getEpoch,
  getIdentity,
  sendRawTx,
} from '../../../shared/utils/node-api'
import {createPool} from '../../../shared/utils/pg'

function parsePaymentTransaction(hex) {
  if (typeof hex !== 'string' || hex.length > 64 * 1024) {
    throw new ApiError(400, 'transaction is invalid')
  }
  let transaction
  try {
    transaction = new Transaction().fromHex(hex)
  } catch {
    throw new ApiError(400, 'transaction is invalid')
  }
  if (transaction.type !== TxType.Send) {
    throw new ApiError(400, 'transaction has invalid type')
  }
  return transaction
}

export default async function handler(req, res) {
  if (!prepareApi(req, res, ['POST'])) return

  try {
    const [providerId] = normalizeProviders([req.body?.provider])
    const transaction = parsePaymentTransaction(req.body?.tx)
    const requestedCoinbase = normalizeAddress(req.body?.coinbase, 'coinbase')
    const {epoch} = await getEpoch()
    const identity = await getIdentity(requestedCoinbase)
    const providerResult = await createPool().query(
      'select id, address from providers where id = $1',
      [providerId]
    )
    const provider = providerResult.rows[0]
    if (!provider) throw new ApiError(404, 'provider not found')

    const coinbase = assertPaymentTransaction(
      transaction,
      requestedCoinbase,
      provider,
      identity
    )

    const booked = await withCoinbaseLock(coinbase, epoch, async (client) => {
      await assertKeyLimit(client, coinbase, epoch)
      const candidate = await findAvailableKey(client, providerId, epoch, false)
      if (!candidate) throw new ApiError(409, 'no keys are available')
      try {
        await checkApiKey(candidate.url, candidate.key)
      } catch {
        throw new ApiError(409, 'provider is unavailable')
      }

      const hash = await assertUnusedTransactionHash(
        client,
        await sendRawTx(req.body.tx)
      )
      const reserved = await reserveKey(client, candidate, {coinbase, hash})
      if (!reserved) throw new ApiError(409, 'key was reserved by another request')
      return reserved
    })

    return res.status(200).json({id: booked.id, txHash: booked.hash})
  } catch (error) {
    return sendApiError(res, error, 'failed to purchase API key')
  }
}
