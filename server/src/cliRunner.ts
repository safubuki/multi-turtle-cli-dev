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
  RunImageAttachment,
  RunStreamEvent,
  WorkspaceTarget
} from './types.js'
import { getProviderCatalogs } from './providerCatalog.js'
import { buildSshCommandArgs, runRemoteBashCommand, scpTransfer } from './ssh.js'
import { APP_ROOT, buildRemoteBashBootstrap, dedupeStrings, shellEscapePosix } from './util.js'

interface RunOptions {
  provider: ProviderId
  model: string
  prompt: string
  reasoningEffort: ReasoningEffort
  autonomyMode: AutonomyMode
  codexFastMode: CodexFastMode
  codexExecutionMode?: 'sandboxed' | 'danger-full-access'
  sessionId: string | null
  target: WorkspaceTarget
  imageAttachments: RunImageAttachment[]
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

const REMOTE_CAPTURE_BEGIN = '__TAKO_REMOTE_CAPTURE_BEGIN__'
const REMOTE_CAPTURE_END = '__TAKO_REMOTE_CAPTURE_END__'
const REMOTE_CODEX_OUTPUT_PLACEHOLDER = '__TAKO_REMOTE_CODEX_OUTPUT__'
const REMOTE_PREVIEW_IMAGE_DIR = '/tmp/multi-turtle-images-preview'
const CODEX_SANDBOX_RETRY_NOTICE = 'Codex の sandbox 初期化に失敗したため、この実行だけ sandbox なしで再試行します。'

interface ResolvedRunImageAttachment {
  fileName: string
  path: string
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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isCodexSandboxStartupFailure(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('bwrap:') ||
    normalized.includes('bubblewrap') ||
    (normalized.includes('windows sandbox') && normalized.includes('createprocessasuserw failed')) ||
    normalized.includes('failed rtm_newaddr') ||
    (normalized.includes('loopback') && normalized.includes('operation not permitted')) ||
    (normalized.includes('sandbox') && normalized.includes('operation not permitted'))
}

function isLikelyFileWriteRequest(prompt: string): boolean {
  const normalized = prompt.toLowerCase()
  return /\.md\b|write|save|create file|output to file|markdown|書き込|保存|作成|出力|ファイル|そのまま入れて/.test(normalized)
}

function isCodexSandboxFailureResponse(response: string): boolean {
  const normalized = response.toLowerCase()
  return isCodexSandboxStartupFailure(normalized) ||
    normalized.includes('サンドボックス制約') ||
    normalized.includes('書き込みを実行できませんでした') ||
    normalized.includes('作成できていません') ||
    normalized.includes('operation not permitted')
}

function buildCodexExecArgs(
  prefixArgs: string[],
  model: string,
  outputFilePath: string,
  resolvedSessionId: string | null,
  executionMode: 'sandboxed' | 'danger-full-access',
  imagePaths: string[]
): string[] {
  const sandboxArgs = executionMode === 'danger-full-access'
    ? ['--dangerously-bypass-approvals-and-sandbox']
    : ['--full-auto']

  return resolvedSessionId
    ? [
        ...prefixArgs,
        'exec',
        '--json',
        ...sandboxArgs,
        '--skip-git-repo-check',
        '-o',
        outputFilePath,
        '-m',
        model,
        ...imagePaths.flatMap((imagePath) => ['--image', imagePath]),
        'resume',
        resolvedSessionId,
        '-'
      ]
    : [
        ...prefixArgs,
        'exec',
        '--json',
        ...sandboxArgs,
        '--skip-git-repo-check',
        '-o',
        outputFilePath,
        '-m',
        model,
        ...imagePaths.flatMap((imagePath) => ['--image', imagePath]),
        '-'
      ]
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

function getNestedBoolean(value: unknown, pathSegments: string[]): boolean | null {
  let current: unknown = value

  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') {
      return null
    }

    current = (current as Record<string, unknown>)[segment]
  }

  return typeof current === 'boolean' ? current : null
}

function normalizeCopilotToolErrorMessage(message: string): string {
  const normalized = message.toLowerCase()

  if (normalized.includes('powershell 6+ (pwsh) is not available') || normalized.includes('pwsh.exe --version')) {
    return 'PowerShell 7 (pwsh) が見つからないため、Copilot CLI のツール実行に失敗しました。pwsh をインストールするか、pwsh 前提の操作を避けてください。'
  }

  return message
}

function appendStderrText(state: ParsedRunState, onEvent: RunOptions['onEvent'], text: string): void {
  emitIfText(onEvent, 'stderr', text)
  state.stderrText += `${text}\n`
}

function extractGeminiMessageContent(content: unknown): { text: string; thought: string } {
  if (typeof content === 'string') {
    return {
      text: content,
      thought: ''
    }
  }

  const items = Array.isArray(content)
    ? content
    : content && typeof content === 'object'
      ? [content]
      : []

  const textParts: string[] = []
  const thoughtParts: string[] = []

  for (const item of items) {
    if (typeof item === 'string') {
      textParts.push(item)
      continue
    }

    if (!item || typeof item !== 'object') {
      continue
    }

    const part = item as { type?: unknown; text?: unknown; thought?: unknown }
    const partType = typeof part.type === 'string' ? part.type : null
    const text = typeof part.text === 'string' ? part.text : null
    const thought = typeof part.thought === 'string' ? part.thought : null

    if (partType === 'thought') {
      if (thought) {
        thoughtParts.push(thought)
      } else if (text) {
        thoughtParts.push(text)
      }
      continue
    }

    if (text) {
      textParts.push(text)
      continue
    }

    if (thought) {
      thoughtParts.push(thought)
    }
  }

  return {
    text: textParts.join(''),
    thought: thoughtParts.join('\n')
  }
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

  if (eventType === 'tool.execution_complete') {
    const toolLabel = getNestedString(parsed, ['data', 'tool']) ?? getNestedString(parsed, ['tool']) ?? 'tool'
    const success = getNestedBoolean(parsed, ['data', 'success'])
    const errorMessage = getNestedString(parsed, ['data', 'error', 'message'])

    emitIfText(onEvent, 'tool', success === false ? `${toolLabel}: failed` : `${toolLabel}: completed`)

    if (success === false && errorMessage) {
      emitIfText(onEvent, 'stderr', normalizeCopilotToolErrorMessage(errorMessage))
    }
    return
  }

  if (eventType === 'tool.execution_start' || eventType === 'tool.execution_started') {
    const toolLabel = getNestedString(parsed, ['data', 'tool']) ?? getNestedString(parsed, ['tool']) ?? 'tool'
    emitIfText(onEvent, 'tool', `${toolLabel}: started`)
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
    return
  }

  if (eventType) {
    emitIfText(onEvent, 'status', eventType)
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

  if (eventType === 'message') {
    const role = typeof parsed.role === 'string' ? parsed.role : null
    const { text, thought } = extractGeminiMessageContent(parsed.content)

    if (role === 'assistant' || role === 'agent' || role === 'model') {
      if (thought) {
        emitIfText(onEvent, 'status', thought)
      }

      if (text) {
        pushAssistantText(state, onEvent, text)
      }

      return
    }

    if (typeof parsed.messageType === 'string' && parsed.messageType === 'error' && (text || thought)) {
      appendStderrText(state, onEvent, text || thought)
      return
    }

    if (text || thought) {
      emitIfText(onEvent, 'status', text || thought)
      return
    }
  }

  if (eventType === 'tool_use' && typeof parsed.tool_name === 'string') {
    emitIfText(onEvent, 'tool', parsed.tool_name)
    return
  }

  if (eventType === 'tool_request') {
    const toolLabel = typeof parsed.name === 'string' ? parsed.name : 'tool'
    emitIfText(onEvent, 'tool', `${toolLabel}: started`)
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

  if (eventType === 'tool_response') {
    const toolLabel = typeof parsed.name === 'string' ? parsed.name : 'tool'
    const hasErrorFlag = typeof parsed.isError === 'boolean'
    emitIfText(
      onEvent,
      'tool',
      hasErrorFlag ? `${toolLabel}: ${parsed.isError ? 'failed' : 'completed'}` : toolLabel
    )

    if (parsed.isError) {
      const { text, thought } = extractGeminiMessageContent(parsed.content)
      if (text || thought) {
        appendStderrText(state, onEvent, text || thought)
      }
    }
    return
  }

  if (eventType === 'error') {
    const message = typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed)
    appendStderrText(state, onEvent, message)
    return
  }

  if (eventType === 'agent_end') {
    const summary = getNestedString(parsed, ['data', 'message'])
    if (summary) {
      emitIfText(onEvent, 'status', summary)
    }
    return
  }

  if (eventType === 'agent_start' || eventType === 'session_update' || eventType === 'usage') {
    return
  }

  if (eventType === 'result') {
    return
  }

  emitIfText(onEvent, 'status', JSON.stringify(parsed))
}

function classifyStatus(response: string, stderrText: string): CliExecResult['statusHint'] {
  const normalizedResponse = response.toLowerCase()
  const normalizedStderr = stderrText.toLowerCase()

  if (/approval|approve|continue\?|yes\/no|which one|choose|select|confirm|confirmation required|need your input/.test(normalizedResponse)) {
    return 'attention'
  }

  if (/tool execution denied by policy|you are in plan mode and cannot modify source code|may only use write_file or replace to save plans/.test(normalizedStderr)) {
    return 'attention'
  }

  if (!normalizedResponse.trim() && /permission denied|fatal:|traceback|exception|failed|error:|not found|enoent/.test(normalizedStderr) && !/no error/.test(normalizedStderr)) {
    return 'error'
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

function sanitizePromptImageFileName(index: number, fileName: string): string {
  const extension = path.extname(fileName).replace(/[^.a-zA-Z0-9_-]/g, '')
  const baseName = path.basename(fileName, extension).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  const safeBaseName = baseName || `image-${index + 1}`
  return `${safeBaseName}${extension || '.img'}`
}

function resolveLocalImageAttachments(imageAttachments: RunImageAttachment[]): ResolvedRunImageAttachment[] {
  return imageAttachments.map((attachment) => {
    if (!fs.existsSync(attachment.localPath)) {
      throw new Error(`画像ファイルが見つかりません: ${attachment.fileName}`)
    }

    return {
      fileName: attachment.fileName,
      path: attachment.localPath
    }
  })
}

async function cleanupRemoteImageDirectory(target: Extract<WorkspaceTarget, { kind: 'ssh' }>, remoteDirectory: string | null): Promise<void> {
  if (!remoteDirectory) {
    return
  }

  await runRemoteBashCommand(
    target.host,
    target.connection,
    `if [ -d ${shellEscapePosix(remoteDirectory)} ]; then rm -rf ${shellEscapePosix(remoteDirectory)}; fi`,
    15_000
  )
}

async function prepareRemoteImageAttachments(options: RunOptions): Promise<{
  remoteDirectory: string | null
  attachments: ResolvedRunImageAttachment[]
}> {
  if (options.target.kind !== 'ssh' || options.imageAttachments.length === 0) {
    return {
      remoteDirectory: null,
      attachments: []
    }
  }

  options.onEvent?.({
    type: 'status',
    text: `画像をリモート環境へ転送します (${options.imageAttachments.length} 件)`
  })

  let remoteDirectory: string | null = null

  try {
    const remoteDirectoryOutput = await runRemoteBashCommand(
      options.target.host,
      options.target.connection,
      [
        'if command -v mktemp >/dev/null 2>&1; then',
        '  mktemp -d "${TMPDIR:-/tmp}/multi-turtle-images.XXXXXX"',
        'else',
        '  dir="${TMPDIR:-/tmp}/multi-turtle-images-$$-$(date +%s)"',
        '  mkdir -p "$dir"',
        "  printf '%s\\n' \"$dir\"",
        'fi'
      ].join('\n'),
      20_000
    )

    remoteDirectory = remoteDirectoryOutput
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean) ?? null

    if (!remoteDirectory) {
      throw new Error('リモート側の一時画像フォルダを作成できませんでした。')
    }

    const attachments: ResolvedRunImageAttachment[] = []
    for (const [index, attachment] of options.imageAttachments.entries()) {
      const remotePath = `${remoteDirectory}/${sanitizePromptImageFileName(index, attachment.fileName)}`
      options.onEvent?.({
        type: 'status',
        text: `画像を転送中: ${attachment.fileName}`
      })
      await scpTransfer('upload', { host: options.target.host, connection: options.target.connection }, attachment.localPath, remotePath)
      attachments.push({
        fileName: attachment.fileName,
        path: remotePath
      })
    }

    return {
      remoteDirectory,
      attachments
    }
  } catch (error) {
    await cleanupRemoteImageDirectory(options.target, remoteDirectory).catch(() => undefined)
    throw error
  }
}

function resolveRemotePreviewImageAttachments(imageAttachments: RunImageAttachment[]): {
  remoteDirectory: string | null
  attachments: ResolvedRunImageAttachment[]
} {
  if (imageAttachments.length === 0) {
    return {
      remoteDirectory: null,
      attachments: []
    }
  }

  return {
    remoteDirectory: REMOTE_PREVIEW_IMAGE_DIR,
    attachments: imageAttachments.map((attachment, index) => ({
      fileName: attachment.fileName,
      path: path.posix.join(REMOTE_PREVIEW_IMAGE_DIR, sanitizePromptImageFileName(index, attachment.fileName))
    }))
  }
}

function buildAttachedImagePrompt(provider: ProviderId, imageAttachments: ResolvedRunImageAttachment[]): string {
  if (imageAttachments.length === 0) {
    return ''
  }

  if (provider === 'gemini') {
    return [
      'Attached Images',
      'Treat these image files as part of the request and inspect them directly from the listed paths before answering.',
      ...imageAttachments.map((attachment, index) => `Image ${index + 1}: ${attachment.fileName}\nPath: ${attachment.path}`)
    ].join('\n')
  }

  return [
    'Attached Images',
    'Treat the attached image files as part of the request and inspect them before answering.',
    ...imageAttachments.map((attachment, index) => `Image ${index + 1}: ${attachment.fileName}`)
  ].join('\n')
}

function buildGeminiIncludeDirectoryArgs(basePath: string, imageAttachments: ResolvedRunImageAttachment[]): string[] {
  const directories = dedupeStrings([
    basePath,
    ...imageAttachments.map((attachment) => path.dirname(attachment.path))
  ])

  return directories.flatMap((directoryPath) => ['--include-directories', directoryPath])
}

function buildProviderPrompt(options: RunOptions, imageAttachments: ResolvedRunImageAttachment[] = []): string {
  const promptSections = [
    ...(imageAttachments.length > 0 ? [buildAttachedImagePrompt(options.provider, imageAttachments)] : []),
    options.prompt
  ]
  const promptBody = promptSections.filter(Boolean).join('\n\n')

  return options.provider === 'codex' && options.codexFastMode === 'fast'
    ? ['/fast', '', promptBody].join('\n')
    : promptBody
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

function buildPreviewCommandLine(command: string, args: string[]): string {
  if (process.platform === 'win32') {
    return buildWindowsCommandLine(command, args)
  }

  return [shellEscapePosix(command), ...args.map((value) => shellEscapePosix(value))].join(' ')
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
  if (options.provider === 'copilot' && options.imageAttachments.length > 0) {
    throw new Error('GitHub Copilot CLI は画像入力に対応していません。Codex CLI または Gemini CLI を選択してください。')
  }

  const supportsReasoning = await modelSupportsReasoning(options.provider, options.model)
  const resolvedSessionId = sanitizeSessionId(options.sessionId)
  const launcher = resolveCommand(options.provider)
  const resolvedImageAttachments = resolveLocalImageAttachments(options.imageAttachments)
  const providerPrompt = buildProviderPrompt(options, resolvedImageAttachments)

  if (options.provider === 'codex') {
    const outputFilePath = createCodexOutputCapturePath()
    const args = buildCodexExecArgs(
      launcher.prefixArgs,
      options.model,
      outputFilePath,
      resolvedSessionId,
      options.codexExecutionMode ?? 'sandboxed',
      resolvedImageAttachments.map((attachment) => attachment.path)
    )

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
      ...buildGeminiIncludeDirectoryArgs(options.target.path, resolvedImageAttachments),
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

async function buildRemoteLaunchSpecFromResolved(
  options: RunOptions,
  preparedRemoteImages: {
    remoteDirectory: string | null
    attachments: ResolvedRunImageAttachment[]
  }
): Promise<CliLaunchSpec> {
  if (options.target.kind !== 'ssh') {
    throw new Error('Remote launch requires ssh target.')
  }

  const supportsReasoning = await modelSupportsReasoning(options.provider, options.model)
  const resolvedSessionId = sanitizeSessionId(options.sessionId)
  const approvalMode = options.autonomyMode === 'max' ? 'yolo' : 'auto_edit'
  const providerPrompt = buildProviderPrompt(options, preparedRemoteImages.attachments)

  const remoteArgs =
    options.provider === 'codex'
      ? buildCodexExecArgs(
          ['codex'],
          options.model,
          REMOTE_CODEX_OUTPUT_PLACEHOLDER,
          resolvedSessionId,
          options.codexExecutionMode ?? 'sandboxed',
          preparedRemoteImages.attachments.map((attachment) => attachment.path)
        )
      : options.provider === 'gemini'
        ? [
            'gemini',
            '-m',
            options.model,
            '--output-format',
            'stream-json',
            '--approval-mode',
            approvalMode,
            ...buildGeminiIncludeDirectoryArgs(options.target.path, preparedRemoteImages.attachments),
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

  const escapedRemoteArgs = remoteArgs
    .map((entry) => entry === REMOTE_CODEX_OUTPUT_PLACEHOLDER ? '"$tako_codex_output"' : shellEscapePosix(entry))
    .join(' ')
  const providerCommand = options.provider === 'codex' ? 'codex' : options.provider === 'gemini' ? 'gemini' : 'copilot'
  const remoteCommandLines = [
    buildRemoteBashBootstrap(),
    'export TERM=xterm-256color',
    'export COLORTERM=truecolor',
    `cd ${shellEscapePosix(options.target.path)}`,
    `if ! command -v ${providerCommand} >/dev/null 2>&1; then printf '%s\n' 'Remote ${providerCommand} CLI was not found in PATH after loading shell profiles.' >&2; exit 127; fi`
  ]

  if (preparedRemoteImages.remoteDirectory) {
    remoteCommandLines.push(
      `tako_prompt_image_dir=${shellEscapePosix(preparedRemoteImages.remoteDirectory)}`,
      'cleanup_tako_prompt_images() { if [ -n "$tako_prompt_image_dir" ] && [ -d "$tako_prompt_image_dir" ]; then rm -rf "$tako_prompt_image_dir"; fi; }',
      'trap cleanup_tako_prompt_images EXIT'
    )
  }

  if (options.provider === 'codex') {
    remoteCommandLines.push(
      'tako_codex_output=""',
      'if command -v mktemp >/dev/null 2>&1; then',
      '  tako_codex_output="$(mktemp "${TMPDIR:-/tmp}/tako-codex-output.XXXXXX")"',
      'else',
      '  tako_codex_output="${TMPDIR:-/tmp}/tako-codex-output-$$.txt"',
      '  : > "$tako_codex_output"',
      'fi',
      escapedRemoteArgs,
      'tako_codex_status=$?',
      `if [ -f "$tako_codex_output" ]; then printf '%s\n' ${shellEscapePosix(REMOTE_CAPTURE_BEGIN)}; cat "$tako_codex_output"; printf '\n%s\n' ${shellEscapePosix(REMOTE_CAPTURE_END)}; fi`,
      'rm -f "$tako_codex_output"',
      'exit "$tako_codex_status"'
    )
  } else {
    remoteCommandLines.push(escapedRemoteArgs)
  }

  const remoteCommand = remoteCommandLines.join('\n')

  return {
    command: 'ssh',
    args: buildSshCommandArgs(
      {
        host: options.target.host,
        connection: options.target.connection
      },
      ['bash', '-lc', shellEscapePosix(remoteCommand)]
    ),
    stdinPrompt: options.provider === 'copilot' ? null : options.provider === 'gemini' ? null : providerPrompt
  }
}

async function buildRemoteLaunchSpec(options: RunOptions): Promise<CliLaunchSpec> {
  if (options.target.kind !== 'ssh') {
    throw new Error('Remote launch requires ssh target.')
  }

  if (options.provider === 'copilot' && options.imageAttachments.length > 0) {
    throw new Error('GitHub Copilot CLI \u306f\u753b\u50cf\u5165\u529b\u306b\u5bfe\u5fdc\u3057\u3066\u3044\u307e\u305b\u3093\u3002Codex CLI \u307e\u305f\u306f Gemini CLI \u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
  }

  const preparedRemoteImages = await prepareRemoteImageAttachments(options)
  return buildRemoteLaunchSpecFromResolved(options, preparedRemoteImages)
}

function createActiveRun(
  child: ChildProcessWithoutNullStreams,
  options: RunOptions,
  launchSpec: CliLaunchSpec
): ActiveCliRun {
  const state = DEFAULT_STATE()
  let stdoutBuffer = ''
  let remoteCapturedOutput = ''
  let isCapturingRemoteOutput = false
  let stopped = false
  const stdoutDecoder = createBufferDecoder(process.platform === 'win32' ? 'auto' : 'utf8')
  const stderrDecoder = createBufferDecoder(process.platform === 'win32' ? 'auto' : 'utf8')

  const processStdoutLine = (line: string) => {
    if (line === REMOTE_CAPTURE_BEGIN) {
      remoteCapturedOutput = ''
      isCapturingRemoteOutput = true
      return
    }

    if (line === REMOTE_CAPTURE_END) {
      isCapturingRemoteOutput = false
      return
    }

    if (isCapturingRemoteOutput) {
      remoteCapturedOutput += remoteCapturedOutput ? `\n${line}` : line
      return
    }

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

      const response = (state.finalText ?? state.assistantText).trim() || capturedOutput || remoteCapturedOutput.trim()
      if (stopped) {
        reject(new Error('CLI run stopped'))
        return
      }

      if (!response && code !== 0) {
        reject(new Error(state.stderrText.trim() || `CLI exited with code ${code}`))
        return
      }

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

export async function previewCliRunCommand(options: RunOptions): Promise<{
  commandLine: string
  stdinPrompt: string | null
  effectivePrompt: string
  workingDirectory: string
  notes: string[]
}> {
  if (options.provider === 'copilot' && options.imageAttachments.length > 0) {
    throw new Error('GitHub Copilot CLI \u306f\u753b\u50cf\u5165\u529b\u306b\u5bfe\u5fdc\u3057\u3066\u3044\u307e\u305b\u3093\u3002Codex CLI \u307e\u305f\u306f Gemini CLI \u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002')
  }

  const notes: string[] = []

  if (options.target.kind === 'local') {
    const resolvedImageAttachments = resolveLocalImageAttachments(options.imageAttachments)
    const effectivePrompt = buildProviderPrompt(options, resolvedImageAttachments)
    const launchSpec = await buildLocalLaunchSpec(options)
    if (launchSpec.stdinPrompt) {
      notes.push('Codex CLI \u3067\u306f\u30d7\u30ed\u30f3\u30d7\u30c8\u672c\u4f53\u3092\u6a19\u6e96\u5165\u529b\u3067\u6e21\u3057\u307e\u3059\u3002')
    }

    return {
      commandLine: buildPreviewCommandLine(launchSpec.command, launchSpec.args),
      stdinPrompt: launchSpec.stdinPrompt,
      effectivePrompt,
      workingDirectory: options.target.path,
      notes
    }
  }

  const previewRemoteImages = resolveRemotePreviewImageAttachments(options.imageAttachments)
  const effectivePrompt = buildProviderPrompt(options, previewRemoteImages.attachments)
  const launchSpec = await buildRemoteLaunchSpecFromResolved(options, previewRemoteImages)
  if (launchSpec.stdinPrompt) {
    notes.push('Codex CLI \u3067\u306f\u30d7\u30ed\u30f3\u30d7\u30c8\u672c\u4f53\u3092\u6a19\u6e96\u5165\u529b\u3067\u6e21\u3057\u307e\u3059\u3002')
  }
  if (previewRemoteImages.attachments.length > 0) {
    notes.push('\u30ea\u30e2\u30fc\u30c8\u753b\u50cf\u306f\u5b9f\u884c\u6642\u306b\u4e00\u6642\u30c7\u30a3\u30ec\u30af\u30c8\u30ea\u3078\u8ee2\u9001\u3055\u308c\u308b\u305f\u3081\u3001\u30d7\u30ec\u30d3\u30e5\u30fc\u3067\u306f\u4ee3\u8868\u30d1\u30b9\u3092\u8868\u793a\u3057\u3066\u3044\u307e\u3059\u3002')
  }

  return {
    commandLine: buildPreviewCommandLine(launchSpec.command, launchSpec.args),
    stdinPrompt: launchSpec.stdinPrompt,
    effectivePrompt,
    workingDirectory: options.target.path,
    notes
  }
}

async function startSingleCliRun(options: RunOptions): Promise<ActiveCliRun> {
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

export async function startCliRun(options: RunOptions): Promise<ActiveCliRun> {
  const initialRun = await startSingleCliRun({
    ...options,
    codexExecutionMode: options.codexExecutionMode ?? 'sandboxed'
  })

  if (options.provider !== 'codex') {
    return initialRun
  }

  let currentRun = initialRun
  let stopped = false

  const retryWithoutSandbox = async (): Promise<CliExecResult> => {
    options.onEvent?.({
      type: 'status',
      text: CODEX_SANDBOX_RETRY_NOTICE
    })

    const retryRun = await startSingleCliRun({
      ...options,
      codexExecutionMode: 'danger-full-access'
    })
    currentRun = retryRun

    if (stopped) {
      retryRun.stop()
      throw new Error('CLI run stopped')
    }

    return retryRun.promise
  }

  return {
    promise: (async () => {
      try {
        const result = await initialRun.promise
        if (!stopped && isLikelyFileWriteRequest(options.prompt) && isCodexSandboxFailureResponse(result.response)) {
          return retryWithoutSandbox()
        }

        return result
      } catch (error) {
        const message = getErrorMessage(error)
        if (stopped || !isCodexSandboxStartupFailure(message)) {
          throw error
        }

        return retryWithoutSandbox()
      }
    })(),
    stop: () => {
      stopped = true
      currentRun.stop()
    }
  }
}







