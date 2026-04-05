import cors from 'cors'
import nodePath from 'path'
import express from 'express'
import { startCliRun } from './cliRunner.js'
import { startShellRun } from './shellRunner.js'
import { pickFolderDialog, pickSaveFileDialog } from './nativeDialog.js'
import { getProviderCatalogs, updateProviderCli } from './providerCatalog.js'
import {
  browseRemoteDirectory,
  createRemoteDirectory,
  discoverSshHosts,
  generateSshKeyPair,
  getRemoteWorkspaceRoots,
  inspectRemoteHost,
  installSshPublicKey,
  listRemoteWorkspaces,
  scpTransfer
} from './ssh.js'
import { specSections } from './spec.js'
import type { ActiveCliRun, ActiveShellRun, AutonomyMode, RunRequestBody, RunStreamEvent, ShellRunEvent, ShellRunRequestBody, SshConnectionOptions } from './types.js'
import { openInCommandPrompt, openInVsCode } from './vscode.js'
import { browseLocalDirectory, discoverLocalWorkspaces, listLocalBrowseRoots } from './workspaces.js'

const app = express()
const port = Number(process.env.PORT || 3001)
const activeRuns = new Map<string, ActiveCliRun>()
const activeShellRuns = new Map<string, ActiveShellRun>()

app.use(cors())
app.use(express.json({ limit: '10mb' }))

function normalizeAutonomyMode(value: unknown): AutonomyMode {
  return value === 'max' ? 'max' : 'balanced'
}

function normalizeCodexFastMode(value: unknown): 'off' | 'fast' {
  return value === 'fast' ? 'fast' : 'off'
}

function detectHostPlatform(): 'windows' | 'linux' | 'macos' | 'unknown' {
  if (process.platform === 'win32') {
    return 'windows'
  }
  if (process.platform === 'linux') {
    return 'linux'
  }
  if (process.platform === 'darwin') {
    return 'macos'
  }
  return 'unknown'
}

function normalizeConnection(value: unknown): SshConnectionOptions | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const raw = value as Record<string, unknown>
  const normalizeString = (key: string): string | undefined => {
    const found = raw[key]
    return typeof found === 'string' && found.trim() ? found.trim() : undefined
  }

  return {
    username: normalizeString('username'),
    port: normalizeString('port'),
    password: normalizeString('password'),
    identityFile: normalizeString('identityFile'),
    proxyJump: normalizeString('proxyJump'),
    proxyCommand: normalizeString('proxyCommand'),
    extraArgs: normalizeString('extraArgs')
  }
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

function clearActiveShellRun(paneId: string, run: ActiveShellRun): void {
  if (activeShellRuns.get(paneId) === run) {
    activeShellRuns.delete(paneId)
  }
}

function isValidShellRunRequest(body: Partial<ShellRunRequestBody> | null | undefined): body is ShellRunRequestBody {
  return Boolean(body?.paneId && body.target && body.command?.trim())
}

function writeShellStreamEvent(res: express.Response, event: ShellRunEvent): void {
  if (res.writableEnded || res.destroyed) {
    return
  }

  res.write(`${JSON.stringify(event)}\n`)
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
      hostPlatform: detectHostPlatform(),
      features: {
        vscode: true,
        ssh: true,
        remoteDiscovery: true,
        remoteBrowser: true,
        shell: true
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

app.get('/api/system/local-roots', (_req, res) => {
  try {
    res.json({
      success: true,
      roots: listLocalBrowseRoots()
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'local roots failed',
      details: String(error)
    })
  }
})

app.post('/api/system/pick-folder', async (req, res) => {
  try {
    const { startPath } = req.body as { startPath?: string }
    const paths = await pickFolderDialog(startPath)
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
    const { path: requestedPath } = req.body as { path?: string }
    if (!requestedPath?.trim()) {
      res.status(400).json({
        success: false,
        error: 'path required'
      })
      return
    }

    const normalizedPath = nodePath.resolve(requestedPath.trim())
    const entries = await browseLocalDirectory(normalizedPath)
    res.json({
      success: true,
      path: normalizedPath,
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

app.post('/api/system/pick-save-file', async (req, res) => {
  try {
    const { defaultName } = req.body as { defaultName?: string }
    const selectedPath = await pickSaveFileDialog(defaultName ?? 'download.txt')
    res.json({
      success: true,
      path: selectedPath
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'save file picker failed',
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

app.post('/api/system/open-cmd', async (req, res) => {
  try {
    const { target } = req.body as { target?: RunRequestBody['target'] }
    if (!target) {
      res.status(400).json({
        success: false,
        error: 'target required'
      })
      return
    }

    await openInCommandPrompt(target)
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'command prompt open failed',
      details: String(error)
    })
  }
})

app.post('/api/provider/update', async (req, res) => {
  try {
    const { provider } = req.body as { provider?: RunRequestBody['provider'] }
    if (provider !== 'codex' && provider !== 'gemini' && provider !== 'copilot') {
      res.status(400).json({
        success: false,
        error: 'provider required'
      })
      return
    }

    const result = await updateProviderCli(provider)
    await getProviderCatalogs(true)
    res.json({
      success: true,
      provider: result.provider,
      stdout: result.stdout,
      stderr: result.stderr
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'provider update failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/workspaces', async (req, res) => {
  try {
    const { host, connection } = req.body as { host?: string; connection?: unknown }
    if (!host?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host required'
      })
      return
    }

    const workspaces = await listRemoteWorkspaces(host.trim(), normalizeConnection(connection))
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
    const { host, connection } = req.body as { host?: string; connection?: unknown }
    if (!host?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host required'
      })
      return
    }

    const inspection = await inspectRemoteHost(host.trim(), normalizeConnection(connection))
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
    const { host, path, connection } = req.body as { host?: string; path?: string; connection?: unknown }
    if (!host?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host required'
      })
      return
    }

    const payload = await browseRemoteDirectory(host.trim(), normalizeConnection(connection), path)
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
    const { host, parentPath, directoryName, connection } = req.body as {
      host?: string
      parentPath?: string
      directoryName?: string
      connection?: unknown
    }

    if (!host?.trim() || !parentPath?.trim() || !directoryName?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host, parentPath and directoryName are required'
      })
      return
    }

    const createdPath = await createRemoteDirectory(host.trim(), normalizeConnection(connection), parentPath.trim(), directoryName.trim())
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

app.post('/api/ssh/keygen', async (req, res) => {
  try {
    const { keyName, comment, passphrase } = req.body as {
      keyName?: string
      comment?: string
      passphrase?: string
    }

    const key = await generateSshKeyPair(keyName ?? 'id_ed25519', comment ?? '', passphrase ?? '')
    res.json({
      success: true,
      key
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ssh key generation failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/install-key', async (req, res) => {
  try {
    const { host, publicKey, connection } = req.body as {
      host?: string
      publicKey?: string
      connection?: unknown
    }

    if (!host?.trim() || !publicKey?.trim()) {
      res.status(400).json({
        success: false,
        error: 'host and publicKey are required'
      })
      return
    }

    await installSshPublicKey(host.trim(), normalizeConnection(connection), publicKey.trim())
    res.json({
      success: true,
      host: host.trim(),
      installed: true
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'ssh key installation failed',
      details: String(error)
    })
  }
})

app.post('/api/ssh/scp', async (req, res) => {
  try {
    const { direction, host, localPath, remotePath, connection } = req.body as {
      direction?: 'upload' | 'download'
      host?: string
      localPath?: string
      remotePath?: string
      connection?: unknown
    }

    if (!direction || !host?.trim() || !localPath?.trim() || !remotePath?.trim()) {
      res.status(400).json({
        success: false,
        error: 'direction, host, localPath and remotePath are required'
      })
      return
    }

    await scpTransfer(direction, { host: host.trim(), connection: normalizeConnection(connection) }, localPath.trim(), remotePath.trim())
    res.json({
      success: true,
      direction,
      localPath: localPath.trim(),
      remotePath: remotePath.trim()
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'scp transfer failed',
      details: String(error)
    })
  }
})

app.post('/api/shell/stream', async (req, res) => {
  const rawBody = req.body as Partial<ShellRunRequestBody>
  if (!isValidShellRunRequest(rawBody)) {
    res.status(400).json({
      success: false,
      error: 'invalid shell run request'
    })
    return
  }

  const body: ShellRunRequestBody = {
    paneId: rawBody.paneId!,
    target: rawBody.target!,
    command: rawBody.command!,
    cwd: typeof rawBody.cwd === 'string' ? rawBody.cwd : null
  }

  if (activeShellRuns.has(body.paneId)) {
    res.status(409).json({
      success: false,
      error: 'shell is already running'
    })
    return
  }

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()

  let run: ActiveShellRun | null = null

  req.on('close', () => {
    if (!res.writableEnded && run) {
      run.stop()
      clearActiveShellRun(body.paneId, run)
    }
  })

  try {
    run = await startShellRun({
      ...body,
      onEvent: (event) => writeShellStreamEvent(res, event)
    })

    activeShellRuns.set(body.paneId, run)

    const result = await run.promise
    clearActiveShellRun(body.paneId, run)
    writeShellStreamEvent(res, {
      type: 'exit',
      exitCode: result.exitCode,
      cwd: result.cwd
    })
    res.end()
  } catch (error) {
    if (run) {
      clearActiveShellRun(body.paneId, run)
    }

    writeShellStreamEvent(res, {
      type: 'error',
      message: String(error)
    })

    if (!res.writableEnded) {
      res.end()
    }
  }
})

app.post('/api/shell/stop', (req, res) => {
  const { paneId } = req.body as { paneId?: string }
  if (!paneId) {
    res.status(400).json({
      success: false,
      error: 'paneId required'
    })
    return
  }

  const run = activeShellRuns.get(paneId)
  if (run) {
    run.stop()
    activeShellRuns.delete(paneId)
  }

  res.json({
    success: true,
    stopped: Boolean(run)
  })
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
    codexFastMode: normalizeCodexFastMode(rawBody.codexFastMode),
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
      codexFastMode: body.codexFastMode,
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
    codexFastMode: normalizeCodexFastMode(rawBody.codexFastMode),
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
      codexFastMode: body.codexFastMode,
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
  console.log(`T.A.K.O server listening on http://localhost:${port}`)
})
