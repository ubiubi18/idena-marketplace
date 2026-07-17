import * as secp256k1 from '@noble/secp256k1'
import {hmac} from '@noble/hashes/hmac.js'
import {sha256} from '@noble/hashes/sha2.js'
import {hexToUint8Array} from './buffers'

secp256k1.hashes.hmacSha256 = (key, message) => hmac(sha256, key, message)
secp256k1.hashes.sha256 = sha256

function privateKeyBytes(key) {
  return typeof key === 'string' ? hexToUint8Array(key) : new Uint8Array(key)
}

export function publicKeyCreate(key, compressed = true) {
  return secp256k1.getPublicKey(privateKeyBytes(key), compressed)
}

export function signHash(hash, key) {
  const signature = secp256k1.sign(new Uint8Array(hash), privateKeyBytes(key), {
    format: 'recovered',
    prehash: false,
  })
  return {recid: signature[0], signature: signature.slice(1)}
}

export function recoverPublicKey(hash, signature, compressed = false) {
  const bytes = new Uint8Array(signature)
  if (bytes.length !== 65 || bytes[64] > 3) {
    throw new Error('invalid recoverable signature')
  }
  const recovered = secp256k1.recoverPublicKey(
    new Uint8Array([bytes[64], ...bytes.slice(0, 64)]),
    new Uint8Array(hash),
    {prehash: false}
  )
  return secp256k1.Point.fromBytes(recovered).toBytes(compressed)
}
