import {checkInvitationLimit} from '../../../shared/check'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {
  findAvailableKey,
  getAvailableProviderIds,
  getExistingKey,
  reserveKey,
  withCoinbaseLock,
} from '../../../shared/key-store'
import {assertCoinbaseSignature, normalizeProviders} from '../../../shared/security'
import {getEpoch, getIdentity, checkApiKey} from '../../../shared/utils/node-api'
import {shuffle} from '../../../shared/utils/utils'

export default async function handler(req, res) {
  if (!prepareApi(req, res, ['POST'])) return

  try {
    const coinbase = assertCoinbaseSignature(req.body?.coinbase, req.body?.signature)
    const clientProviders = normalizeProviders(req.body?.providers)
    const {epoch} = await getEpoch()
    const {state, inviter} = await getIdentity(coinbase)
    if (state !== 'Candidate') {
      throw new ApiError(400, 'identity is not a candidate')
    }

    let providerIds = await getAvailableProviderIds(epoch, true)
    if (clientProviders) {
      providerIds = providerIds.filter((id) => clientProviders.includes(id))
    }
    shuffle(providerIds)

    const booked = await withCoinbaseLock(coinbase, epoch, async (client) => {
      const existing = await getExistingKey(client, coinbase, epoch)
      if (existing) return existing

      await checkInvitationLimit(inviter?.address, epoch, client)
      for (const providerId of providerIds) {
        const candidate = await findAvailableKey(client, providerId, epoch, true)
        if (!candidate) continue
        try {
          await checkApiKey(candidate.url, candidate.key)
        } catch {
          continue
        }
        const reserved = await reserveKey(client, candidate, {
          coinbase,
          inviter: inviter?.address || null,
          mined: true,
        })
        if (reserved) return reserved
      }
      throw new ApiError(409, 'no usable keys are available')
    })

    return res.status(200).json({id: booked.id, provider: booked.provider_id})
  } catch (error) {
    return sendApiError(res, error, 'failed to reserve API key')
  }
}
