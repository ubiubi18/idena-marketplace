import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import {ApiError} from '../api'

const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 5000

function parseBoolean(value) {
  return /^(1|true|yes)$/i.test(value || '')
}

function classifyIpv4(address) {
  const parts = address.split('.').map(Number)
  const [a, b] = parts
  const loopback = a === 127
  const privateAddress =
    loopback ||
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  return {loopback, privateAddress}
}

function classifyAddress(address) {
  if (net.isIP(address) === 4) return classifyIpv4(address)

  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length)
    if (net.isIP(mapped) === 4) return classifyIpv4(mapped)
  }

  const loopback = normalized === '::1'
  const firstGroup = Number.parseInt(normalized.split(':')[0] || '0', 16)
  const globallyRoutable =
    firstGroup >= 0x2000 &&
    firstGroup <= 0x3fff &&
    !normalized.startsWith('2001:db8:')
  return {loopback, privateAddress: loopback || !globallyRoutable}
}

async function resolveTarget(url) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const family = net.isIP(hostname)
  if (family) return [{address: hostname, family}]
  return dns.lookup(hostname, {all: true, verbatim: true})
}

async function validateTarget(rawUrl, options) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    throw new ApiError(500, 'RPC URL is invalid')
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new ApiError(500, 'RPC URL is invalid')
  }

  const addresses = await resolveTarget(url)
  if (addresses.length === 0) throw new ApiError(502, 'RPC host did not resolve')

  const classifications = addresses.map(({address}) => classifyAddress(address))
  const allLoopback = classifications.every(({loopback}) => loopback)
  const hasPrivateAddress = classifications.some(
    ({privateAddress}) => privateAddress
  )

  if (
    hasPrivateAddress &&
    !(allLoopback && options.allowLoopback) &&
    !options.allowPrivate
  ) {
    throw new ApiError(502, 'RPC host resolves to a private address')
  }
  if (url.protocol === 'http:' && !allLoopback && !options.allowInsecure) {
    throw new ApiError(502, 'remote RPC URL must use HTTPS')
  }

  return {addresses, url}
}

export async function postJsonRpc(rawUrl, payload, overrides = {}) {
  const options = {
    allowInsecure:
      overrides.allowInsecure ?? parseBoolean(process.env.ALLOW_INSECURE_RPC_URLS),
    allowLoopback: overrides.allowLoopback ?? false,
    allowPrivate:
      overrides.allowPrivate ?? parseBoolean(process.env.ALLOW_PRIVATE_RPC_URLS),
    maxResponseBytes:
      overrides.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
  const body = Buffer.from(JSON.stringify(payload))
  if (body.length > 64 * 1024) throw new ApiError(400, 'RPC request is too large')

  const {addresses, url} = await validateTarget(rawUrl, options)
  const transport = url.protocol === 'https:' ? https : http
  const selected = addresses[0]

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        headers: {
          Accept: 'application/json',
          'Content-Length': body.length,
          'Content-Type': 'application/json',
        },
        lookup(_hostname, lookupOptions, callback) {
          if (lookupOptions?.all) {
            callback(null, addresses)
          } else {
            callback(null, selected.address, selected.family)
          }
        },
        method: 'POST',
      },
      (response) => {
        const chunks = []
        let bytes = 0
        response.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > options.maxResponseBytes) {
            response.destroy(new Error('RPC response is too large'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => {
          if (
            response.statusCode === undefined ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(new ApiError(502, 'RPC request failed'))
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            reject(new ApiError(502, 'RPC returned invalid JSON'))
          }
        })
        response.on('error', reject)
      }
    )

    request.setTimeout(options.timeoutMs, () => {
      request.destroy(new Error('RPC request timed out'))
    })
    request.on('error', (error) => {
      reject(error instanceof ApiError ? error : new ApiError(502, 'RPC request failed'))
    })
    request.end(body)
  })
}

export async function callNodeRpc(method, params) {
  if (!process.env.PROXY_URL) throw new ApiError(500, 'PROXY_URL is not configured')
  const response = await postJsonRpc(
    process.env.PROXY_URL,
    {id: 1, key: process.env.PROXY_KEY, method, params},
    {allowLoopback: true}
  )
  if (response.error) {
    throw new ApiError(502, 'node RPC returned an error')
  }
  return response
}
