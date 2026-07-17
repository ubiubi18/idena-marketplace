export class ApiError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function prepareApi(req, res, methods) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return false
  }

  if (!methods.includes(req.method)) {
    res.setHeader('Allow', [...methods, 'OPTIONS'].join(', '))
    res.status(405).send('method not allowed')
    return false
  }

  return true
}

export function sendApiError(res, error, fallback = 'request failed') {
  if (error instanceof ApiError) {
    return res.status(error.status).send(error.message)
  }

  return res.status(500).send(fallback)
}
