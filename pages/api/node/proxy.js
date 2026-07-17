import {prepareApi, sendApiError, ApiError} from '../../../shared/api'
import {callNodeRpc} from '../../../shared/utils/rpc'

const AVAILABLE_METHODS = new Set([
  'dna_identity',
  'dna_epoch',
  'bcn_getRawTx',
  'bcn_sendRawTx',
  'bcn_transaction',
  'dna_getBalance',
])

export default async function handler(req, res) {
  if (!prepareApi(req, res, ['POST'])) return

  try {
    const {id = 1, method, params = []} = req.body || {}
    if (!AVAILABLE_METHODS.has(method) || !Array.isArray(params)) {
      throw new ApiError(403, 'method not available')
    }
    const response = await callNodeRpc(method, params)
    return res.status(200).json({...response, id})
  } catch (error) {
    return sendApiError(res, error)
  }
}
