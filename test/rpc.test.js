import assert from 'node:assert/strict'
import http from 'node:http'
import test from 'node:test'
import {postJsonRpc} from '../shared/utils/rpc'

async function listen(handler) {
  const server = http.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const {port} = server.address()
  return {
    close: () => new Promise((resolve) => server.close(resolve)),
    url: `http://127.0.0.1:${port}/`,
  }
}

test('pins and bounds an explicitly allowed loopback RPC request', async (t) => {
  let requestBody
  const fixture = await listen((req, res) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks))
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({result: {epoch: 1}}))
    })
  })
  t.after(fixture.close)

  const response = await postJsonRpc(
    fixture.url,
    {id: 1, method: 'dna_epoch', params: []},
    {allowLoopback: true}
  )
  assert.deepEqual(response, {result: {epoch: 1}})
  assert.equal(requestBody.method, 'dna_epoch')
})

test('rejects private RPC targets by default', async (t) => {
  const fixture = await listen((_req, res) => res.end('{}'))
  t.after(fixture.close)
  await assert.rejects(() => postJsonRpc(fixture.url, {}), /private address/)
})

test('rejects oversized RPC responses', async (t) => {
  const fixture = await listen((_req, res) => {
    res.end(JSON.stringify({result: 'x'.repeat(100)}))
  })
  t.after(fixture.close)
  await assert.rejects(
    () =>
      postJsonRpc(fixture.url, {}, {allowLoopback: true, maxResponseBytes: 16}),
    /too large|request failed/
  )
})
