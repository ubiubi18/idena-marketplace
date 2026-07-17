function isHexPrefixed(str) {
  return str.slice(0, 2) === '0x'
}

function stripHexPrefix(str) {
  if (typeof str !== 'string') {
    return str
  }
  return isHexPrefixed(str) ? str.slice(2) : str
}

function intToHex(integer) {
  if (integer < 0) {
    throw new Error('Invalid integer as argument, must be unsigned!')
  }
  const hex = integer.toString(16)
  return hex.length % 2 ? `0${hex}` : hex
}

function padToEven(a) {
  return a.length % 2 ? `0${a}` : a
}

export function bufferToBigInt(buf) {
  if (!buf || !buf.length) return 0n
  return BigInt(`0x${Buffer.from(buf).toString('hex')}`)
}

function intToBuffer(integer) {
  const hex = intToHex(integer)
  return Buffer.from(hex, 'hex')
}

export function toBuffer(v) {
  if (!Buffer.isBuffer(v)) {
    if (typeof v === 'string') {
      if (isHexPrefixed(v)) {
        const hex = stripHexPrefix(v)
        if (!/^[0-9a-fA-F]*$/.test(hex)) throw new Error('invalid hex value')
        return Buffer.from(padToEven(hex), 'hex')
      }
      return Buffer.from(v)
    }
    if (typeof v === 'number') {
      if (!Number.isSafeInteger(v) || v < 0) {
        throw new Error('invalid unsigned integer')
      }
      if (!v) {
        return Buffer.from([])
      }
      return intToBuffer(v)
    }
    if (typeof v === 'bigint') {
      if (v < 0n) throw new Error('invalid negative integer')
      if (v === 0n) return Buffer.from([])
      return Buffer.from(padToEven(v.toString(16)), 'hex')
    }
    if (v === null || v === undefined) {
      return Buffer.from([])
    }
    if (v instanceof Uint8Array) {
      return Buffer.from(v)
    }
    throw new Error('invalid type')
  }
  return v
}

export function hexToUint8Array(hexString) {
  if (typeof hexString !== 'string') throw new Error('invalid hex value')
  const str = stripHexPrefix(hexString)

  if (str.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(str)) {
    throw new Error('invalid hex value')
  }

  const arrayBuffer = new Uint8Array(str.length / 2)

  for (let i = 0; i < str.length; i += 2) {
    const byteValue = parseInt(str.substr(i, 2), 16)
    arrayBuffer[i / 2] = byteValue
  }

  return arrayBuffer
}

export function toHexString(byteArray, withPrefix) {
  return (
    (withPrefix ? '0x' : '') +
    Array.from(byteArray, function(byte) {
      return `0${(byte & 0xff).toString(16)}`.slice(-2)
    }).join('')
  )
}
