import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import fs from 'fs'
import path from 'path'
import type {
  ActiveCliRun,
  AutonomyMode,
  CliExecResult,
  CodexFastMode,
  ProviderId,
  ReasoningEffort,
  RunStreamEvent,
  WorkspaceTarget
} from './types.js'
import { getProviderCatalogs } from './providerCatalog.js'
import { buildSshCommandArgs } from './ssh.js'
import { APP_ROOT, dedupeStrings, shellEscapePosix } from './util.js'

interface RunOptions {
  provider: ProviderId
  model: string
  prompt: string
  reasoningEffort: ReasoningEffort
  autonomyMode: AutonomyMode
  codexFastMode: CodexFastMode
  sessionId: string | null
  target: WorkspaceTarget
  onEvent?: (event: RunStreamEvent) => void
}

interface CliLaunchSpec {
  command: string
  args: string[]
  stdinPrompt: string | null
  outputFilePath?: string
}

interface ParsedRunState {
  sessionId: string | null
  assistantText: string
  finalText: string | null
  stderrText: string
}

const DEFAULT_STATE = (): ParsedRunState => ({
  sessionId: null,
  assistantText: '',
  finalText: null,
  stderrText: ''
})

type CliEncoding = 'auto' | 'utf8' | 'shift_jis'

function createCodexOutputCapturePath(): string {
  const captureDir = path.join(APP_ROOT, '.multi-turtle-runtime')
  fs.mkdirSync(captureDir, { recursive: true })
  return path.join(captureDir, `codex-last-message-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`)
}

function emitIfText(onEvent: RunOptions['onEvent'], type: Extract<RunStreamEvent, { type: 'status' | 'tool' | 'stderr' | 'assistant-delta' }>['type'], text: string): void {
  const normalized = text.replace(/\r/g, '').trimEnd()
  if (!normalized) {
    return
  }

  if (type === 'assistant-delta') {
    onEvent?.({ type, text })
    return
  }

  for (const line of normalized.split('\n').map((entry) => entry.trim()).filter(Boolean)) {
    onEvent?.({ type, text: line })
  }
}

function sanitizeSessionId(sessionId: string | null | undefined): string | null {
  if (!sessionId) {
    return null
  }

  const normalized = sessionId.trim()
  if (!normalized || normalized.length > 200 || /[\r\n]/.test(normalized)) {
    return null
  }

  return normalized
}

function isCmdScript(command: string): boolean {
  return /\.(cmd|bat)$/i.test(command)
}

function countReplacementCharacters(value: string): number {
  return (value.match(/\uFFFD/g) ?? []).length
}

function chooseDecodedText(utf8Text: string, shiftJisText: string): string {
  const utf8ReplacementCount = countReplacementCharacters(utf8Text)
  const shiftJisReplacementCount = countReplacementCharacters(shiftJisText)

  if (utf8ReplacementCount === 0 && shiftJisReplacementCount > 0) {
    return utf8Text
  }

  if (shiftJisReplacementCount === 0 && utf8ReplacementCount > 0) {
    return shiftJisText
  }

  if (utf8ReplacementCount !== shiftJisReplacementCount) {
    return utf8ReplacementCount < shiftJisReplacementCount ? utf8Text : shiftJisText
  }

  return utf8Text
}

function createBufferDecoder(encoding: CliEncoding) {
  if (encoding === 'auto') {
    const utf8Decoder = new TextDecoder('utf-8')
    const shiftJisDecoder = new TextDecoder('shift_jis')

    return {
      write: (chunk: Buffer) => chooseDecodedText(
        utf8Decoder.decode(chunk, { stream: true }),
        shiftJisDecoder.decode(chunk, { stream: true })
      ),
      end: () => chooseDecodedText(utf8Decoder.decode(), shiftJisDecoder.decode())
    }
  }

  const decoder = new TextDecoder(encoding === 'shift_jis' ? 'shift_jis' : 'utf-8')
  return {
    write: (chunk: Buffer) => decoder.decode(chunk, { stream: true }),
    end: () => decoder.decode()
  }
}

function safeJsonParse(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function getNestedString(value: unknown, pathSegments: string[]): string | null {
  let current: unknown = value

  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') {
      return null
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'string' && current.trim().length > 0 ? current : null
}

function pushAssistantText(state: ParsedRunState, onEvent: RunOptions['onEvent'], text: string): void {
  if (!text) {
    return
  }

  state.assistantText += text
  emitIfText(onEvent, 'assistant-delta', text)
}

function handleCodexLine(state: ParsedRunState, onEvent: RunOptions['onEvent'], line: string): void {
  const parsed = safeJsonParse(line)
  if (!parsed) {
    emitIfText(onEvent, 'status', line)
    return
  }

  const eventType = getNestedString(parsed, ['type'])

  if (eventType === 'thread.started') {
    const sessionId = sanitizeSessionId(
      typeof parsed.thread_id === 'string'
        ? parsed.thread_id
        : getNestedString(parsed, ['data', 'thread_id'])
    )
    if (sessionId) {
      state.sessionId = sessionId
      onEvent?.({ type: 'session', sessionId })
    }
    return
  }

  if (eventType === 'assistant.message_delta') {
    const delta =
      getNestedString(parsed, ['data', 'deltaContent']) ??
      getNestedString(parsed, ['data', 'delta']) ??
      ''
    pushAssistantText(state, onEvent, delta)
    return
  }

  if (eventType === 'assistant.message') {
    const finalText = getNestedString(parsed, ['data', 'content'])
    if (finalText) {
      state.finalText = finalText
    }
    return
  }

  if (eventType?.includes('error')) {
    const message =
      getNestedString(parsed, ['data', 'message']) ??
      getNestedString(parsed, ['message']) ??
      JSON.stringify(parsed)
    emitIfText(onEvent, 'stderr', message)
    state.stderrText += `${message}\n`
    return
  }

  const commandText =
    getNestedString(parsed, ['data', 'command']) ??
    getNestedString(parsed, ['data', 'cmd']) ??
    getNestedString(parsed, ['message'])

  if (commandText) {
    emitIfText(onEvent, 'tool', `${eventType ?? 'event'}: ${commandText}`)
  } else if (eventType) {
    emitIfText(onEvent, 'status', eventType)
  }
}

function handleCopilotLine(state: ParsedRunState, onEvent: RunOptions['onEvent'], line: string): void {
  const parsed = safeJsonParse(line)
  if (!parsed) {
    emitIfText(onEvent, 'status', line)
    return
  }

  const eventType = getNestedString(parsed, ['type'])

  if (eventType === 'assistant.message_delta') {
    const delta = getNestedString(parsed, ['data', 'deltaContent']) ?? ''
    pushAssistantText(state, onEvent, delta)
    return
  }

  if (eventType === 'assistant.message') {
    const finalText = getNestedString(parsed, ['data', 'content'])
    if (finalText) {
      state.finalText = finalText
    }
    return
  }

  if (eventType === 'result') {
    const sessionId =
      sanitizeSessionId(getNestedString(parsed, ['sessionId'])) ??
      sanitizeSessionId(getNestedString(parsed, ['data', 'sessionId'])) ??
      sanitizeSessionId(getNestedString(parsed, ['conversationId']))

    if (sessionId && state.sessionId !== sessionId) {
      state.sessionId = sessionId
      onEvent?.({ type: 'session', sessionId })
    }
    return
  }

  const toolName = getNestedString(parsed, ['data', 'tool']) ?? getNestedString(parsed, ['tool'])
  if (toolName) {
    emitIfText(onEvent, 'tool', toolName)
    return
  }

  const message = getNestedString(parsed, ['message']) ?? getNestedString(parsed, ['data', 'message'])
  if (message) {
    emitIfText(onEvent, 'status', message)
  }
}

function handleGeminiLine(state: ParsedRunState, onEvent: RunOptions['onEvent'], line: string): void {
  const parsed = safeJsonParse(line)
  if (!parsed) {
    emitIfText(onEvent, 'status', line)
    return
  }

  const eventType = typeof parsed.type === 'string' ? parsed.type : null

  if (eventType === 'init') {
    const sessionId = sanitizeSessionId(
      typeof parsed.session_id === 'string' ? parsed.session_id : null
    )
    if (sessionId) {
      state.sessionId = sessionId
      onEvent?.({ type: 'session', sessionId })
    }
    return
  }

  if (eventType === 'message' && parsed.role === 'assistant') {
    if (typeof parsed.content === 'string') {
      pushAssistantText(state, onEvent, parsed.content)
      return
    }

    if (Array.isArray(parsed.content)) {
      const text = parsed.content
        .flatMap((item) => {
          if (typeof item === 'string') {
            return [item]
          }

          if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
            return [(item as { text: string }).text]
          }

          return []
        })
        .join('')

      pushAssistantText(state, onEvent, text)
      return
    }
  }

  if (eventType === 'tool_use' && typeof parsed.tool_name === 'string') {
    emitIfText(onEvent, 'tool', parsed.tool_name)
    return
  }

  if (eventType === 'tool_result') {
    const toolStatus =
      typeof parsed.status === 'string'
        ? `tool_result: ${parsed.status}`
        : 'tool_result'
    emitIfText(onEvent, 'tool', toolStatus)
    return
  }

  if (eventType === 'error') {
    const message = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed)
    emitIfText(onEvent, 'stderr', message)
    state.stderrText += `${message}\n`
    return
  }

  if (eventType === 'result') {
    return
  }

  emitIfText(onEvent, 'status', JSON.stringify(parsed))
}

function classifyStatus(response: string, stderrText: string): CliExecResult['statusHint'] {
  const combined = `${response}
${stderrText}`.toLowerCase()

  if (/permission denied|fatal:|traceback|exception|failed|error:|not found|enoent/.test(combined) && !/no error/.test(combined)) {
    return 'error'
  }

  if (/approval|approve|continue\?|yes\/no|which one|choose|select|confirm|confirmation required|need your input/.test(combined)) {
    return 'attention'
  }

  return 'completed'
}

async function modelSupportsReasoning(provider: ProviderId, model: string): Promise<boolean> {
  try {
    const catalogs = await getProviderCatalogs(false)
    const modelInfo = catalogs[provider].models.find((entry) => entry.id === model)
    return Boolean(modelInfo && modelInfo.supportedReasoningEfforts.length > 0)
  } catch {
    return false
  }
}

function getCandidateNpmRoots(): string[] {
  const pathRoots =
    process.env.PATH?.split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .filter((entry) => /[\\/]npm$/i.test(entry) || /appdata[\\/]roaming[\\/]npm/i.test(entry)) ?? []

  return dedupeStrings([
    process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Roaming', 'npm') : null,
    process.env.NPM_CONFIG_PREFIX || null,
    process.env.npm_config_prefix || null,
    ...pathRoots
  ])
}

function getCmdExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'cmd.exe')
}

function getPowerShellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function getCliCommandPath(provider: ProviderId): string {
  if (process.platform !== 'win32') {
    return provider
  }

  const npmRoot = getCandidateNpmRoots()[0] ?? path.join(process.env.APPDATA ?? '', 'npm')
  const baseName = provider === 'codex' ? 'codex' : provider === 'gemini' ? 'gemini' : 'copilot'
  const candidates = [
    path.join(npmRoot, `${baseName}.cmd`),
    path.join(npmRoot, `${baseName}.ps1`),
    path.join(npmRoot, `${baseName}.bat`),
    path.join(npmRoot, `${baseName}.exe`)
  ]

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? baseName
}

function getCliScriptPath(provider: ProviderId): string | null {
  for (const npmRoot of getCandidateNpmRoots()) {
    const nodeModulesRoot = path.join(npmRoot, 'node_modules')
    const candidates =
      provider === 'codex'
        ? [path.join(nodeModulesRoot, '@openai', 'codex', 'bin', 'codex.js')]
        : provider === 'gemini'
          ? [
              path.join(nodeModulesRoot, '@google', 'gemini-cli', 'bundle', 'gemini.js'),
              path.join(nodeModulesRoot, '@google', 'gemini-cli', 'dist', 'index.js')
            ]
          : [path.join(nodeModulesRoot, '@github', 'copilot', 'npm-loader.js')]

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function resolveCommand(provider: ProviderId): { command: string; prefixArgs: string[] } {
  const scriptPath = getCliScriptPath(provider)

  if (process.platform === 'win32' && scriptPath) {
    return {
      command: process.execPath,
      prefixArgs: [scriptPath]
    }
  }

  const commandPath = getCliCommandPath(provider)
  if (process.platform === 'win32' && /\.ps1$/i.test(commandPath)) {
    return {
      command: getPowerShellExecutable(),
      prefixArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', commandPath]
    }
  }

  return {
    command: commandPath,
    prefixArgs: []
  }
}

function buildProviderPrompt(options: RunOptions): string {
  return options.provider === 'codex' && options.codexFastMode === 'fast'
    ? ['/fast', '', options.prompt].join('\n')
    : options.prompt
}

function quoteForCmd(value: string): string {
  if (!value) {
    return '""'
  }

  if (!/[\s"]/u.test(value)) {
    return value
  }

  return `"${value.replace(/"/g, '""')}"`
}

function buildWindowsCommandLine(command: string, args: string[]): string {
  return [quoteForCmd(command), ...args.map((value) => quoteForCmd(value))].join(' ')
}

function spawnCliChild(command: string, args: string[], cwd: string): ChildProcessWithoutNullStreams {
  const baseOptions = {
    cwd,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe']
  }

  if (process.platform === 'win32' && isCmdScript(command)) {
    return spawn(getCmdExecutable(), ['/d', '/s', '/c', buildWindowsCommandLine(command, args)], baseOptions)
  }

  return spawn(command, args, baseOptions)
}

async function buildLocalLaunchSpec(options: RunOptions): Promise<CliLaunchSpec> {
  const supportsReasoning = await modelSupportsReasoning(options.provider, options.model)
  const resolvedSessionId = sanitizeSessionId(options.sessionId)
  const launcher = resolveCommand(options.provider)
  const providerPrompt = buildProviderPrompt(options)

  if (options.provider === 'codex') {
    const outputFilePath = createCodexOutputCapturePath()
    const args = resolvedSessionId
      ? [
          ...launcher.prefixArgs,
          'exec',
          '--json',
          '--full-auto',
          '--skip-git-repo-check',
          '-o',
          outputFilePath,
          '-m',
          options.model,
          'resume',
          resolvedSessionId,
          '-'
        ]
      : [
          ...launcher.prefixArgs,
          'exec',
          '--json',
          '--full-auto',
          '--skip-git-repo-check',
          '-o',
          outputFilePath,
          '-m',
          options.model,
          '-'
        ]

    return {
      command: launcher.command,
      args,
      stdinPrompt: providerPrompt,
      outputFilePath
    }
  }

  if (options.provider === 'gemini') {
    const approvalMode = options.autonomyMode === 'max' ? 'yolo' : 'auto_edit'
    const args = [
      ...launcher.prefixArgs,
      '-m',
      options.model,
      '--output-format',
      'stream-json',
      '--approval-mode',
      approvalMode,
      '--include-directories',
      options.target.path,
      '--prompt',
      providerPrompt
    ]

    if (resolvedSessionId) {
      args.push('--resume', resolvedSessionId)
    }

    return {
      command: launcher.command,
      args,
      stdinPrompt: null
    }
  }

  const args = [
    ...launcher.prefixArgs,
    '--output-format',
    'json',
    '--stream',
    'on',
    '--model',
    options.model,
    options.autonomyMode === 'max' ? '--allow-all' : '--allow-all-tools',
    '--no-ask-user',
    '--no-color',
    '--add-dir',
    options.target.path
  ]

  if (supportsReasoning) {
    args.push('--reasoning-effort', options.reasoningEffort)
  }

  if (resolvedSessionId) {
    args.push(`--resume=${resolvedSessionId}`)
  }

  args.push('-p', options.prompt)

  return {
    command: launcher.command,
    args,
    stdinPrompt: null
  }
}

async function buildRemoteLaunchSpec(options: RunOptions): Promise<CliLaunchSpec> {
  const providerPrompt = buildProviderPrompt(options)
  if (options.target.kind !== 'ssh') {
    throw new Error('Remote launch requires ssh target.')
  }

  const supportsReasoning = await modelSupportsReasoning(options.provider, options.model)
  const resolvedSessionId = sanitizeSessionId(options.sessionId)
  const approvalMode = options.autonomyMode === 'max' ? 'yolo' : 'auto_edit'

  const remoteArgs =
    options.provider === 'codex'
      ? resolvedSessionId
        ? [
            'codex',
            'exec',
            '--json',
            '--full-auto',
            '--skip-git-repo-check',
            '-m',
            options.model,
            'resume',
            resolvedSessionId,
            '-'
          ]
        : [
            'codex',
            'exec',
            '--json',
            '--full-auto',
            '--skip-git-repo-check',
            '-m',
            options.model,
            '-'
          ]
      : options.provider === 'gemini'
        ? [
            'gemini',
            '-m',
            options.model,
            '--output-format',
            'stream-json',
            '--approval-mode',
            approvalMode,
            '--include-directories',
            options.target.path,
            '--prompt',
            providerPrompt,
            ...(resolvedSessionId ? ['--resume', resolvedSessionId] : [])
          ]
        : [
            'copilot',
            '--output-format',
            'json',
            '--stream',
            'on',
            '--model',
            options.model,
            options.autonomyMode === 'max' ? '--allow-all' : '--allow-all-tools',
            '--no-ask-user',
            '--no-color',
            '--add-dir',
            options.target.path,
            ...(supportsReasoning ? ['--reasoning-effort', options.reasoningEffort] : []),
            ...(resolvedSessionId ? [`--resume=${resolvedSessionId}`] : []),
            '-p',
            options.prompt
          ]

  const escapedRemoteArgs = remoteArgs.map((entry) => shellEscapePosix(entry)).join(' ')
  const remoteCommand = [
    'export PATH="$HOME/.local/bin:$HOME/bin:$PATH"',
    'export TERM=xterm-256color',
    'export COLORTERM=truecolor',
    options.provider === 'codex'
      ? `cd ${shellEscapePosix(options.target.path)} && ${escapedRemoteArgs}`
      : escapedRemoteArgs
  ].join(' && ')

  return {
    command: 'ssh',
    args: buildSshCommandArgs(
      {
        host: options.target.host,
        connection: options.target.connection
      },
      ['bash', '-lc', remoteCommand]
    ),
    stdinPrompt: options.provider === 'copilot' ? null : options.provider === 'gemini' ? null : providerPrompt
  }
}

function createActiveRun(
  child: ChildProcessWithoutNullStreams,
  options: RunOptions,
  launchSpec: CliLaunchSpec
): ActiveCliRun {
  const state = DEFAULT_STATE()
  let stdoutBuffer = ''
  let stopped = false
  const stdoutDecoder = createBufferDecoder(process.platform === 'win32' ? 'auto' : 'utf8')
  const stderrDecoder = createBufferDecoder(process.platform === 'win32' ? 'auto' : 'utf8')

  const processStdoutLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    if (options.provider === 'codex') {
      handleCodexLine(state, options.onEvent, trimmed)
      return
    }

    if (options.provider === 'gemini') {
      handleGeminiLine(state, options.onEvent, trimmed)
      return
    }

    handleCopilotLine(state, options.onEvent, trimmed)
  }

  const flushStdoutBuffer = (final = false) => {
    if (!stdoutBuffer) {
      return
    }

    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = final ? '' : lines.pop() ?? ''

    for (const line of final ? lines : lines) {
      processStdoutLine(line)
    }

    if (final && lines.length === 0) {
      processStdoutLine(stdoutBuffer)
      stdoutBuffer = ''
    }
  }

  const promise = new Promise<CliExecResult>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += stdoutDecoder.write(chunk)
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        processStdoutLine(line)
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const text = stderrDecoder.write(chunk)
      state.stderrText += text
      emitIfText(options.onEvent, 'stderr', text)
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      const stdoutTail = stdoutDecoder.end()
      if (stdoutTail) {
        stdoutBuffer += stdoutTail
      }
      flushStdoutBuffer(true)
      if (stdoutBuffer) {
        processStdoutLine(stdoutBuffer)
        stdoutBuffer = ''
      }

      const stderrTail = stderrDecoder.end()
      if (stderrTail) {
        state.stderrText += stderrTail
        emitIfText(options.onEvent, 'stderr', stderrTail)
      }

      let capturedOutput = ''
      if (launchSpec.outputFilePath) {
        try {
          capturedOutput = fs.readFileSync(launchSpec.outputFilePath, 'utf8').trim()
        } catch {
          capturedOutput = ''
        }

        try {
          fs.rmSync(launchSpec.outputFilePath, { force: true })
        } catch {
          // ignore cleanup errors
        }
      }

      if (stopped) {
        reject(new Error('CLI run stopped'))
        return
      }

      if (code !== 0) {
        reject(new Error(state.stderrText.trim() || `CLI exited with code ${code}`))
        return
      }

      const response = (state.finalText ?? state.assistantText).trim() || capturedOutput
      if (!response) {
        reject(new Error(state.stderrText.trim() || 'CLI returned empty output'))
        return
      }

      const result: CliExecResult = {
        response,
        statusHint: classifyStatus(response, state.stderrText),
        sessionId: sanitizeSessionId(state.sessionId)
      }

      resolve(result)
    })
  })

  return {
    promise,
    stop: () => {
      if (child.killed) {
        return
      }

      stopped = true
      child.kill()
    }
  }
}

export async function startCliRun(options: RunOptions): Promise<ActiveCliRun> {
  const launchSpec =
    options.target.kind === 'local'
      ? await buildLocalLaunchSpec(options)
      : await buildRemoteLaunchSpec(options)

  const child = spawnCliChild(
    launchSpec.command,
    launchSpec.args,
    options.target.kind === 'local' ? options.target.path : APP_ROOT
  )

  child.stdin.on('error', () => {
    // Some CLIs close stdin as soon as they have consumed the prompt.
  })
  child.stdin.end(launchSpec.stdinPrompt ? `${launchSpec.stdinPrompt}\n` : '')

  return createActiveRun(child, options, launchSpec)
}




