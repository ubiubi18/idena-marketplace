import {getTx} from '../../../shared/utils/node-api'
import {createPool} from '../../../shared/utils/pg'
import {prepareApi, sendApiError, ApiError} from '../../../shared/api'

const HASH_IN_MEMPOOL = '0x0000000000000000000000000000000000000000000000000000000000000000'

export function hasMinedBlock(transaction) {
  return Boolean(
    transaction &&
      typeof transaction.blockHash === 'string' &&
      transaction.blockHash.length > 0 &&
      transaction.blockHash !== HASH_IN_MEMPOOL
  )
}

export default async (req, res) => {
  if (!prepareApi(req, res, ['GET'])) return
  const {id} = req.query
  if (typeof id !== 'string' || id.length === 0 || id.length > 256) {
    return res.status(400).send('key id is invalid')
  }
  const pool = createPool()
  try {
    const result = await pool.query(
      'select id, key, epoch, hash, mined from keys where id = $1',
      [id]
    )

    if (!result.rowCount) {
      throw new ApiError(404, 'key not found')
    }

    const key = result.rows[0]

    let {mined} = key

    if (!mined && key.hash) {
      const tx = await getTx(key.hash)

      if (hasMinedBlock(tx)) {
        // set mined
        await pool.query('update keys set mined = true where id = $1', [id])
        mined = true
      }
    }

    if (mined) {
      return res.status(200).json({key: key.key, epoch: key.epoch})
    }

    return res.status(400).send('tx is not mined')
  } catch (error) {
    return sendApiError(res, error, 'failed to retrieve API key')
  }
}
