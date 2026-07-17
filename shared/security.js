import crypto from 'node:crypto'
import {ApiError} from './api'
import {hexToUint8Array} from './utils/buffers'
import {getAddrFromSignature} from './utils/signature'

export const DNA_BASE = 10n ** 18n
export const PROVIDER_PRICES = Object.freeze([1, 3, 5])

export function normalizeAddress(value, field = 'address') {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ApiError(400, `${field} is invalid`)
  }
  return value.toLowerCase()
}

export function normalizeProviders(value) {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) {
    throw new ApiError(400, 'providers must contain between 1 and 20 ids')
  }

  if (value.some((id) => {
    if (typeof id === 'number') return !Number.isSafeInteger(id) || id < 0
    return typeof id !== 'string' || id.length === 0
  })) {
    throw new ApiError(400, 'provider id is invalid')
  }
  const providers = [...new Set(value.map(String))]
  if (providers.some((id) => !/^[A-Za-z0-9._:-]{1,128}$/.test(id))) {
    throw new ApiError(400, 'provider id is invalid')
  }
  return providers
}

export function assertCoinbaseSignature(coinbase, signature) {
  const normalizedCoinbase = normalizeAddress(coinbase, 'coinbase')
  let recovered
  try {
    recovered = getAddrFromSignature(
      hexToUint8Array(normalizedCoinbase),
      signature
    )
  } catch {
    throw new ApiError(400, 'signature is invalid')
  }

  if (normalizeAddress(recovered) !== normalizedCoinbase) {
    throw new ApiError(400, 'signature is invalid')
  }
  return normalizedCoinbase
}

export function priceForIdentity(identity) {
  if (identity?.state === 'Human') return PROVIDER_PRICES[2]
  if (['Verified', 'Suspended', 'Zombie'].includes(identity?.state)) {
    return PROVIDER_PRICES[1]
  }
  if (identity?.state === 'Newbie' && Number(identity?.age) === 1) return 0.01
  return PROVIDER_PRICES[0]
}

export function dnaToAtomic(value) {
  const text = String(value)
  if (!/^\d+(\.\d{1,18})?$/.test(text)) {
    throw new ApiError(500, 'provider price is invalid')
  }
  const [whole, fraction = ''] = text.split('.')
  return BigInt(whole) * DNA_BASE + BigInt(fraction.padEnd(18, '0'))
}

export function assertPaymentTransaction(transaction, coinbase, provider, identity) {
  const normalizedCoinbase = normalizeAddress(coinbase, 'coinbase')
  const signer = assertTransactionSigner(transaction)
  const recipient = normalizeAddress(transaction.to, 'transaction recipient')
  const providerAddress = normalizeAddress(provider.address, 'provider address')

  if (signer !== normalizedCoinbase) {
    throw new ApiError(400, 'transaction signer does not match coinbase')
  }
  if (recipient !== providerAddress) {
    throw new ApiError(400, 'transaction recipient does not match provider')
  }

  const requiredAmount = dnaToAtomic(priceForIdentity(identity))
  if (BigInt(transaction.amount) < requiredAmount) {
    throw new ApiError(400, 'transaction amount is below the provider price')
  }
  return normalizedCoinbase
}

export function assertTransactionSigner(transaction) {
  try {
    return normalizeAddress(transaction.from, 'transaction signer')
  } catch {
    throw new ApiError(400, 'transaction signature is invalid')
  }
}

export function assertActivationTransaction(transaction, coinbase) {
  const normalizedCoinbase = normalizeAddress(coinbase, 'coinbase')
  const signer = assertTransactionSigner(transaction)
  if (normalizeAddress(transaction.to, 'activation recipient') !== normalizedCoinbase) {
    throw new ApiError(400, 'activation recipient does not match coinbase')
  }
  return {coinbase: normalizedCoinbase, signer}
}

export function normalizeTransactionHash(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new ApiError(502, 'node returned an invalid transaction hash')
  }
  return value.toLowerCase()
}

export function parseBearerToken(value) {
  if (typeof value !== 'string' || value.length > 8192) return null
  const prefix = 'bearer '
  if (value.slice(0, prefix.length).toLowerCase() !== prefix) return null

  const token = value.slice(prefix.length)
  if (token.length === 0) return null
  for (let index = 0; index < token.length; index += 1) {
    const code = token.charCodeAt(index)
    if (code <= 0x20 || code === 0x7f) return null
  }
  return token
}

export function safeTokenEqual(actual, expected) {
  if (!actual || !expected) return false
  const actualHash = crypto.createHash('sha256').update(String(actual)).digest()
  const expectedHash = crypto.createHash('sha256').update(String(expected)).digest()
  return crypto.timingSafeEqual(actualHash, expectedHash)
}
