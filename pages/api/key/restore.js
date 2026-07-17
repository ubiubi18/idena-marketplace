import {getEpoch} from '../../../shared/utils/node-api'
import {createPool} from '../../../shared/utils/pg'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {assertCoinbaseSignature} from '../../../shared/security'

export default async (req, res) => {
  if (!prepareApi(req, res, ['POST'])) return
  try {
    const coinbase = assertCoinbaseSignature(req.body?.coinbase, req.body?.signature)
    const pool = createPool()
    const {epoch} = await getEpoch()

    const keysQuery = await pool.query(
      `
select id, provider_id, epoch from keys
where coinbase = $1 and epoch = $2 
order by updated_at desc 
limit 1`,
      [coinbase, epoch]
    )

    if (!keysQuery.rowCount) {
      throw new ApiError(404, 'key not found')
    }

    const providerQuery = await pool.query('select id, url from providers where id = $1', [
      keysQuery.rows[0].provider_id,
    ])

    const key = keysQuery.rows[0]
    const provider = providerQuery.rows[0]
    if (!provider) throw new ApiError(404, 'provider not found')

    return res.status(200).json({
      key: key.id,
      url: provider.url,
      epoch: key.epoch,
      provider: provider.id,
    })
  } catch (error) {
    return sendApiError(res, error, 'failed to restore API key')
  }
}
