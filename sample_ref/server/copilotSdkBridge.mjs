import { pathToFileURL } from 'node:url'

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => {
      data += chunk
    })
    process.stdin.on('end', () => resolve(data))
    process.stdin.on('error', reject)
  })
}

async function main() {
  const raw = await readStdin()
  const request = JSON.parse(raw)
  const sdk = await import(pathToFileURL(request.sdkModulePath).href)

  const client = new sdk.CopilotClient({
    autoStart: false,
    useStdio: true,
    cwd: request.workspaceRoot,
    logLevel: 'error',
    cliArgs: ['--no-color']
  })

  try {
    await client.start()

    const sessionConfig = {
      onPermissionRequest: sdk.approveAll,
      model: request.model,
      streaming: false,
      workingDirectory: request.workspaceRoot,
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {})
    }

    let session
    if (request.sessionId) {
      try {
        session = await client.resumeSession(request.sessionId, sessionConfig)
      } catch {
        session = await client.createSession(sessionConfig)
      }
    } else {
      session = await client.createSession(sessionConfig)
    }

    const event = await session.sendAndWait({ prompt: request.prompt }, 120000)
    const response = event?.data?.content ?? event?.content ?? ''

    if (!String(response).trim()) {
      throw new Error('GitHub Copilot SDK bridge returned an empty assistant response.')
    }

    process.stdout.write(
      JSON.stringify({
        response: String(response).trim(),
        sessionId: session.sessionId ?? request.sessionId ?? null,
        rateLimits: null
      })
    )
  } finally {
    await client.stop().catch(() => {})
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exit(1)
})
