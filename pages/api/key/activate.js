import {checkInvitationLimit} from '../../../shared/check'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {
  findAvailableKey,
  getAvailableProviderIds,
  assertUnusedTransactionHash,
  reserveKey,
  withCoinbaseLock,
} from '../../../shared/key-store'
import {Transaction} from '../../../shared/models/transaction'
import {
  assertActivationTransaction,
  normalizeProviders,
} from '../../../shared/security'
import {TxType} from '../../../shared/types'
import {
  checkApiKey,
  getEpoch,
  getIdentity,
  sendRawTx,
} from '../../../shared/utils/node-api'
import {shuffle} from '../../../shared/utils/utils'

function parseActivationTransaction(hex) {
  if (typeof hex !== 'string' || hex.length > 64 * 1024) {
    throw new ApiError(400, 'transaction is invalid')
  }
  let transaction
  try {
    transaction = new Transaction().fromHex(hex)
  } catch {
    throw new ApiError(400, 'transaction is invalid')
  }
  if (transaction.type !== TxType.Activate) {
    throw new ApiError(400, 'transaction has invalid type')
  }
  return transaction
}

export default async function handler(req, res) {
  if (!prepareApi(req, res, ['POST'])) return

  try {
    const transaction = parseActivationTransaction(req.body?.tx)
    const {coinbase, signer} = assertActivationTransaction(
      transaction,
      req.body?.coinbase
    )
    const clientProviders = normalizeProviders(req.body?.providers)
    const {epoch} = await getEpoch()
    const inviter = (await getIdentity(signer))?.inviter?.address

    let providerIds = await getAvailableProviderIds(epoch, true)
    if (clientProviders) {
      providerIds = providerIds.filter((id) => clientProviders.includes(id))
    }
    shuffle(providerIds)

    const booked = await withCoinbaseLock(coinbase, epoch, async (client) => {
      await checkInvitationLimit(inviter, epoch, client)
      for (const providerId of providerIds) {
        const candidate = await findAvailableKey(client, providerId, epoch, true)
        if (!candidate) continue
        try {
          await checkApiKey(candidate.url, candidate.key)
        } catch {
          continue
        }

        const hash = await assertUnusedTransactionHash(
          client,
          await sendRawTx(req.body.tx)
        )
        const reserved = await reserveKey(client, candidate, {
          coinbase,
          hash,
          inviter,
        })
        if (reserved) return reserved
      }
      throw new ApiError(409, 'no usable keys are available')
    })

    return res.status(200).json({
      id: booked.id,
      provider: booked.provider_id,
      txHash: booked.hash || null,
    })
  } catch (error) {
    return sendApiError(res, error, 'failed to activate API key')
  }
}
