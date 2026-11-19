/**
 * Test support: a raw MCP client over the per-user socket (task 2.2).
 *
 * There is no MCP client SDK here on purpose: the tests write and read the
 * JSON-RPC frames themselves, which is what the socket carries. Messages are
 * newline-delimited, as the SDK's stdio framing defines.
 */
import net from 'node:net'

/** Connect and return a small line-wise request/response helper. */
export async function connectSocket(socketPath) {
  const socket = net.connect(socketPath)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  let buffer = ''
  const queued = []
  const waiters = []
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline === -1) break
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim().length === 0) continue
      const message = JSON.parse(line)
      const waiter = waiters.shift()
      if (waiter) {
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      } else {
        queued.push(message)
      }
    }
  })
  socket.on('error', () => undefined)
  return {
    send(message) {
      socket.write(`${JSON.stringify(message)}\n`)
    },
    receive(timeoutMs = 5000) {
      if (queued.length > 0) return Promise.resolve(queued.shift())
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`no message within ${timeoutMs} ms`))
        }, timeoutMs)
        waiters.push({ resolve, reject, timer })
      })
    },
    close() {
      socket.destroy()
    },
  }
}
