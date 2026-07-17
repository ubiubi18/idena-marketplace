import {getEpoch} from '../../../shared/utils/node-api'
import {createPool} from '../../../shared/utils/pg'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {PROVIDER_PRICES} from '../../../shared/security'

export default async (req, res) => {
  if (!prepareApi(req, res, ['GET'])) return
  try {
    const {id} = req.query
    if (typeof id !== 'string' || id.length > 128) {
      throw new ApiError(400, 'provider id is invalid')
    }
    const {epoch} = await getEpoch()
    const pool = createPool()
    const result = await pool.query(
      'select id, url, ownername, price, location, address from providers where id = $1',
      [id]
    )

    const counter = await pool.query(
      'select count(*) from keys where provider_id = $1 and epoch = $2 and free = false and coinbase is null',
      [id, epoch]
    )

    const row = result.rows[0]
    if (!row) throw new ApiError(404, 'provider not found')

    const counterRow = counter.rows[0]
    return res.json({
      id,
      data: {
        address: row.address,
        location: row.location,
        ownerName: row.ownerName ?? row.ownername,
        price: row.price,
        prices: PROVIDER_PRICES,
        url: row.url,
      },
      slots: Number(counterRow.count),
    })
  } catch (error) {
    return sendApiError(res, error, 'failed to get a provider')
  }
}
