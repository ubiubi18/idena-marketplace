import {createPool} from '../../../shared/utils/pg'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'

export default async (req, res) => {
  if (!prepareApi(req, res, ['GET', 'POST'])) return
  try {
    const key = req.method === 'POST' ? req.body?.key : req.query.key
    if (typeof key !== 'string' || key.length < 8 || key.length > 512) {
      throw new ApiError(400, 'API key is invalid')
    }
    const pool = createPool()
    const result = await pool.query(
      'select key, provider_id, epoch from keys where key = $1',
      [key]
    )

    const row = result.rows[0]
    if (!row) throw new ApiError(404, 'API key not found')

    return res.json({
      provider: row.provider_id,
      key,
      epoch: row.epoch,
    })
  } catch (error) {
    return sendApiError(res, error, 'failed to retrieve API key')
  }
}
