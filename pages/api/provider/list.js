import {getEpoch} from '../../../shared/utils/node-api'
import {createPool} from '../../../shared/utils/pg'
import {prepareApi, sendApiError} from '../../../shared/api'
import {PROVIDER_PRICES} from '../../../shared/security'

export default async (req, res) => {
  if (!prepareApi(req, res, ['GET'])) return
  try {
    const {epoch} = await getEpoch()
    const pool = createPool()
    const result = await pool.query(
      `
with cte as (
		select provider_id,
          sum(case when free = false and coinbase is null then 1 else 0 end) as paid,
          sum(case when free = true and coinbase is null then 1 else 0 end) as free
	from keys
	where epoch = $1
	group by provider_id
)
select p.*, cte.paid, cte.free
from providers p inner join cte on cte.provider_id = p.id`,
      [epoch]
    )

    return res.json(
      result.rows.map(item => ({
        id: item.id,
        data: {
          url: item.url,
          ownerName: item.ownerName ?? item.ownername,
          price: item.price,
          location: item.location,
          address: item.address,
          prices: PROVIDER_PRICES,
        },
        slots: Number(item.paid),
        inviteSlots: Number(item.free),
      }))
    )
  } catch (error) {
    return sendApiError(res, error, 'failed to get a provider')
  }
}
