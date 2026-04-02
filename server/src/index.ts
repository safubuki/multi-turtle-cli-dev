import cors from 'cors'
import express from 'express'
import { startCliRun } from './cliRunner.js'
import { pickFolderDialog } from './nativeDialog.js'
import { getProviderCatalogs } from './providerCatalog.js'
import {
  browseRemoteDirectory,
  createRemoteDirectory,
  discoverSshHosts,
  getRemoteWorkspaceRoots,
  inspectRemoteHost,
  listRemoteWorkspaces
} from './ssh.js'
import { specSections } from './spec.js'
import type { ActiveCliRun, AutonomyMode, RunRequestBody, RunStreamEvent } from './types.js'
import { openInVsCode } from './vscode.js'
import { browseLocalDirectory, discoverLocalWorkspaces } from './workspaces.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const activeRuns = new Map<string, ActiveCliRun>()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

function normalizeAutonomyMode(value: unknown): AutonomyMode {
  return value === 'max' ? 'max' : 'balanced'
}

function buildCombinedPrompt(body: RunRequestBody): string {
  const sections = [
    body.target.kind === 'local'
      ? `Workspace: ${body.target.path}`
      : `SSH host: ${body.target.host}\nWorkspace: ${body.target.path}`
  ]

  if (body.sharedContext.length > 0) {
    sections.push(
      [
        'Shared Context',
        ...body.sharedContext.map(
          (item, index) =>
            `Context ${index + 1}\nSource: ${item.sourcePaneTitle}\nWorkspace: ${item.workspaceLabel}\nSummary: ${item.summary}\nDetails:\n${item.detail}`
        )
      ].join('\n')
    )
  }

  sections.push(body.prompt)
  return sections.join('\n\n')
}

function isValidRunRequest(body: Partial<RunRequestBody> | null | undefined): body is RunRequestBody {
  return Boolean(body?.paneId && body.provider && body.model && body.target && body.prompt?.trim())
}

function writeStreamEvent(res: express.Response, event: RunStreamEvent): void {
  if (res.writableEnded || res.destroyed) {
    return
  }

  res.write(`${JSON.stringify(event)}\n`)
}

function clearActiveRun(paneId: string, run: ActiveCliRun): void {
  if (activeRuns.get(paneId) === run) {
    activeRuns.delete(paneId)
  }
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok'
  })
})

app.get('/api/bootstrap', async (_req, res) => {
  try {
    const [providers, localWorkspaces, sshHosts] = await Promise.all([
      getProviderCatalogs(),
      discoverLocalWorkspaces(),
      discoverSshHosts()
    ])

    res.json({
      success: true,
      providers,
      localWorkspaces,
      sshHosts,
      remoteRoots: getRemoteWorkspaceRoots(),
      features: {
        vscode: true,
        ssh: true,
        remoteDiscovery: true,
        remoteBrowser: true
      },
      spec: specSections
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'bootstrap failed',
      details: String(error)
    })
  }
})

app.post('/api/system/pick-folder', async (_req, res) => {
  try {
    const paths = await pickFolderDialog()
    res.json({
      success: true,
      paths
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'folder picker failed',
      details: String(error)
    })
  }
})

app.post('/api/system/browse-local', async (req, res) => {
  try {
    const { path } = req.body as { path?: string }
    if (!path?.trim()) {
      res.status(400).json({
        success: false,
        error: 'path required'
      })
      return
    }

    const entries = await browseLocalDirectory(path.trim())
    res.json({
      success: true,
      path: path.trim(),
      entries
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'local browse failed',
      details: String(error)
    })
  }
})

app.post('/api/system/open-vscode', async (req, res) => {
  try {
    const { target } = req.body as { target?: RunRequestBody['target'] }
    if (!target) {
      res.status(400).json({
        success: false,
        error: 'target required'
      })
      return
    }

    await openInVsCode(target)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'vscode open failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/workspaces', async (req, res) => {
  try {
    const { host } = req.body as { host?: string }
    if (!host?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host required'
      })
      return
    }

    const workspaces = await listRemoteWorkspaces(host.trim())
    res.json({
      success: true,
      host: host.trim(),
      workspaces
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'remote workspace discovery failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/inspect', async (req, res) => {
  try {
    const { host } = req.body as { host?: string }
    if (!host?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host required'
      })
      return
    }

    const inspection = await inspectRemoteHost(host.trim())
    res.json({
      success: true,
      host: host.trim(),
      ...inspection
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'remote host inspection failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/browse', async (req, res) => {
  try {
    const { host, path } = req.body as { host?: string; path?: string }
    if (!host?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host required'
      })
      return
    }

    const payload = await browseRemoteDirectory(host.trim(), path)
    res.json({
      success: true,
      host: host.trim(),
      ...payload
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'remote browse failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/mkdir', async (req, res) => {
  try {
    const { host, parentPath, directoryName } = req.body as {
      host?: string
      parentPath?: string
      directoryName?: string
    }

    if (!host?.trim() || !parentPath?.trim() || !directoryName?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host, parentPath and directoryName are required'
      })
      return
    }

    const createdPath = await createRemoteDirectory(host.trim(), parentPath.trim(), directoryName.trim())
    res.json({
      success: true,
      host: host.trim(),
      path: createdPath,
      created: true
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'remote directory creation failed',
      details: String(error)
    })
  }
})

app.post('/api/run', async (req, res) => {
  const rawBody = req.body as Partial<RunRequestBody>
  if (!isValidRunRequest(rawBody)) {
    res.status(400).json({
      success: false,
      error: 'invalid run request'
    })
    return
  }

  const body: RunRequestBody = {
    ...rawBody,
    autonomyMode: normalizeAutonomyMode(rawBody.autonomyMode),
    sessionId: rawBody.sessionId ?? null
  }

  if (activeRuns.has(body.paneId)) {
    res.status(409).json({
      success: false,
      error: 'pane is already running'
    })
    return
  }

  try {
    const run = await startCliRun({
      provider: body.provider,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      autonomyMode: body.autonomyMode,
      prompt: buildCombinedPrompt(body),
      sessionId: body.sessionId,
      target: body.target
    })

    activeRuns.set(body.paneId, run)
    req.on('close', () => {
      if (!res.writableEnded) {
        run.stop()
        clearActiveRun(body.paneId, run)
      }
    })

    const result = await run.promise
    clearActiveRun(body.paneId, run)

    res.json({
      success: true,
      ...result
    })
  } catch (error) {
    activeRuns.delete(rawBody.paneId ?? '')
    res.status(500).json({
      success: false,
      error: 'run failed',
      details: String(error)
    })
  }
})

app.post('/api/run/stream', async (req, res) => {
  const rawBody = req.body as Partial<RunRequestBody>
  if (!isValidRunRequest(rawBody)) {
    res.status(400).json({
      success: false,
      error: 'invalid run request'
    })
    return
  }

  const body: RunRequestBody = {
    ...rawBody,
    autonomyMode: normalizeAutonomyMode(rawBody.autonomyMode),
    sessionId: rawBody.sessionId ?? null
  }

  if (activeRuns.has(body.paneId)) {
    res.status(409).json({
      success: false,
      error: 'pane is already running'
    })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let run: ActiveCliRun | null = null

  req.on('close', () => {
    if (!res.writableEnded && run) {
      run.stop()
      clearActiveRun(body.paneId, run)
    }
  })

  try {
    run = await startCliRun({
      provider: body.provider,
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      autonomyMode: body.autonomyMode,
      prompt: buildCombinedPrompt(body),
      sessionId: body.sessionId,
      target: body.target,
      onEvent: (event) => writeStreamEvent(res, event)
    })

    activeRuns.set(body.paneId, run)

    const result = await run.promise
    clearActiveRun(body.paneId, run)
    writeStreamEvent(res, {
      type: 'final',
      response: result.response,
      statusHint: result.statusHint,
      sessionId: result.sessionId
    })
    res.end()
  } catch (error) {
    if (run) {
      clearActiveRun(body.paneId, run)
    }

    writeStreamEvent(res, {
      type: 'error',
      message: String(error)
    })

    if (!res.writableEnded) {
      res.end()
    }
  }
})

app.post('/api/run/stop', (req, res) => {
  const { paneId } = req.body as { paneId?: string }
  if (!paneId) {
    res.status(400).json({
      success: false,
      error: 'paneId required'
    })
    return
  }

  const run = activeRuns.get(paneId)
  if (run) {
    run.stop()
    activeRuns.delete(paneId)
  }

  res.json({
    success: true,
    stopped: Boolean(run)
  })
})

app.listen(port, () => {
  console.log(`Multi Turtle CLI Deck server listening on http://localhost:${port}`)
})
