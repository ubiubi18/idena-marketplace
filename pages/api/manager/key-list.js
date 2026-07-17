import {getEpoch} from '../../../shared/utils/node-api'
import {createPool} from '../../../shared/utils/pg'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {normalizeProviders, safeTokenEqual} from '../../../shared/security'

function parseHeader(req) {
  const auth = req.headers.authorization
  if (!auth) return null
  const match = /^Bearer\s+(.+)$/i.exec(auth)
  return match?.[1] || null
}

const ONE_DAY = 1000 * 60 * 60 * 24

export default async (req, res) => {
  if (!prepareApi(req, res, ['GET'])) return
  try {
    const [provider] = normalizeProviders([req.query.provider])
    const token = parseHeader(req)
    if (!safeTokenEqual(token, process.env.MANAGER_TOKEN)) {
      throw new ApiError(403, 'access denied')
    }

    const {epoch, nextValidation} = await getEpoch()

    const pool = createPool()
    const nextValidationDt = new Date(nextValidation)
    const current = new Date()

    const startEpochRange = nextValidationDt - current > ONE_DAY * 7 ? epoch - 1 : epoch
    const finishEpochRange = epoch + 1
    const keysQuery = await pool.query(
      `
select distinct key
from keys
where provider_id = $1 and epoch between $2 and $3
      `,
      [provider, startEpochRange, finishEpochRange]
    )

    return res.status(200).json(keysQuery.rows.map(x => x.key))
  } catch (error) {
    return sendApiError(res, error, 'internal error')
  }
}
