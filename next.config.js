const securityHeaders = [
  {key: 'Referrer-Policy', value: 'no-referrer'},
  {key: 'X-Content-Type-Options', value: 'nosniff'},
  {key: 'X-Frame-Options', value: 'DENY'},
]

module.exports = {
  poweredByHeader: false,
  turbopack: {
    root: __dirname,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/api/:path*',
        headers: [
          {key: 'Access-Control-Allow-Origin', value: '*'},
          {key: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS, POST'},
          {
            key: 'Access-Control-Allow-Headers',
            value: 'Accept, Authorization, Content-Type',
          },
          {key: 'Access-Control-Max-Age', value: '86400'},
          {key: 'Cache-Control', value: 'no-store'},
        ],
      },
    ]
  },
}
