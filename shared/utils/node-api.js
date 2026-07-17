import {ApiError} from '../api'
import {callNodeRpc, postJsonRpc} from './rpc'

export async function getTx(hash) {
  return (await callNodeRpc('bcn_transaction', [hash])).result
}

export async function sendRawTx(hex) {
  return (await callNodeRpc('bcn_sendRawTx', [hex])).result
}

export async function getEpoch() {
  return (await callNodeRpc('dna_epoch', [])).result
}

export async function getIdentity(addr) {
  return (await callNodeRpc('dna_identity', [addr])).result
}

export async function checkApiKey(url, key) {
  const response = await postJsonRpc(url, {
    id: 1,
    key,
    method: 'dna_epoch',
    params: [],
  })
  if (response.error) throw new ApiError(502, 'provider rejected API key')
  return response.result
}
