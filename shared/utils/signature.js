import {keccak_256} from '@noble/hashes/sha3.js'
import {hexToUint8Array, toHexString} from './buffers'
import {recoverPublicKey} from './secp256k1'

function signatureBytes(value) {
  let bytes = value
  if (typeof value === 'string') bytes = hexToUint8Array(value)
  if (value?.type === 'Buffer' && Array.isArray(value.data)) bytes = value.data
  if (Array.isArray(value)) bytes = value

  const normalized = new Uint8Array(bytes)
  if (normalized.length !== 65) throw new Error('invalid signature length')
  return normalized
}

export function getAddrFromSignature(data, signature) {
  const hash = keccak_256(Buffer.from(data))
  const publicKey = recoverPublicKey(hash, signatureBytes(signature), false)
  return toHexString(keccak_256(publicKey.slice(1)).slice(12), true)
}
