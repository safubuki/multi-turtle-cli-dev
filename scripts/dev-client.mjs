import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const host = process.env.TAKO_SERVER_HOST ?? '127.0.0.1'
const port = Number(process.env.TAKO_SERVER_PORT ?? '3001')
const timeoutMs = Number(process.env.TAKO_SERVER_TIMEOUT_MS ?? '30000')
const retryIntervalMs = Number(process.env.TAKO_SERVER_RETRY_INTERVAL_MS ?? '250')

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })

    const finish = (connected) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(connected)
    }

    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(500, () => finish(false))
  })
}

async function waitForServer() {
  const deadline = Date.now() + timeoutMs

  process.stdout.write(`Waiting for TAKO server on ${host}:${port}...\n`)
  while (Date.now() < deadline) {
    if (await tryConnect()) {
      process.stdout.write('TAKO server is ready. Starting Vite...\n')
      return
    }

    await delay(retryIntervalMs)
  }

  throw new Error(`Timed out waiting for TAKO server on ${host}:${port}`)
}

await waitForServer()

const viteBinPath = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const child = spawn(process.execPath, [viteBinPath], {
  stdio: 'inherit'
})

const forwardSignal = (signal) => {
  if (!child.killed) {
    child.kill(signal)
  }
}

process.on('SIGINT', () => forwardSignal('SIGINT'))
process.on('SIGTERM', () => forwardSignal('SIGTERM'))

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 0)
})
