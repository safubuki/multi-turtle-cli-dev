import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getProviderCatalogs } from './providerCatalog'

export type AgentCliProvider = 'codex' | 'gemini' | 'copilot'
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

export interface RateLimitWindow {
  remaining: number | null
  limit: number | null
  resetAt: string | null
}

export interface AgentRateLimits {
  daily: RateLimitWindow | null
  weekly: RateLimitWindow | null
  source: string | null
}

export interface CliExecResult {
  response: string
  sessionId: string | null
  rateLimits: AgentRateLimits | null
}

export interface CliRunOptions {
  provider: AgentCliProvider
  model: string
  reasoningEffort: ReasoningEffort
  prompt: string
  sessionId?: string
}

interface CliLauncher {
  command: string
  prefixArgs: string[]
}

interface CliInvocation {
  args: string[]
  stdinPrompt: string | null
}

interface ModelRuntimeCapabilities {
  supportedReasoningEfforts: ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort | null
}

interface CopilotBridgeRequest {
  sdkModulePath: string
  workspaceRoot: string
  model: string
  prompt: string
  reasoningEffort: ReasoningEffort | null
  sessionId: string | null
}

const WORKSPACE_ROOT = path.resolve(__dirname, '..')

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
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

function sanitizeSessionId(sessionId: string | undefined | null): string | null {
  if (!sessionId) {
    return null
  }

  const trimmed = sessionId.trim()
  if (!trimmed || trimmed.length > 160) {
    return null
  }

  if (/[\r\n]/.test(trimmed)) {
    return null
  }

  return trimmed
}

function shouldResumeSession(provider: AgentCliProvider): boolean {
  return provider === 'codex' || provider === 'gemini'
}

function getNpmRoot(): string {
  return getCandidateNpmRoots()[0] ?? path.join(process.env.APPDATA ?? '', 'npm')
}

function getCliCommandPath(provider: AgentCliProvider): string {
  const npmBin = getNpmRoot()

  switch (provider) {
    case 'codex':
      return process.platform === 'win32' ? path.join(npmBin, 'codex.cmd') : 'codex'
    case 'gemini':
      return process.platform === 'win32' ? path.join(npmBin, 'gemini.cmd') : 'gemini'
    case 'copilot':
      return process.platform === 'win32' ? path.join(npmBin, 'copilot.cmd') : 'copilot'
    default:
      return provider
  }
}

function getCliScriptPath(provider: AgentCliProvider): string | null {
  const candidateRoots = getCandidateNpmRoots()

  for (const npmRoot of candidateRoots) {
    const packageRoot = path.join(npmRoot, 'node_modules')

    let candidatePath: string | null = null
    switch (provider) {
      case 'codex':
        candidatePath = path.join(packageRoot, '@openai', 'codex', 'bin', 'codex.js')
        break
      case 'gemini':
        candidatePath = path.join(packageRoot, '@google', 'gemini-cli', 'dist', 'index.js')
        break
      case 'copilot':
        candidatePath = path.join(packageRoot, '@github', 'copilot', 'npm-loader.js')
        break
      default:
        candidatePath = null
    }

    if (candidatePath && fs.existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

function getCopilotSdkModulePath(): string | null {
  for (const npmRoot of getCandidateNpmRoots()) {
    const sdkPath = path.join(npmRoot, 'node_modules', '@github', 'copilot', 'copilot-sdk', 'index.js')
    if (fs.existsSync(sdkPath)) {
      return sdkPath
    }
  }

  return null
}

export function hasCopilotSdkRuntime(): boolean {
  return getCopilotSdkModulePath() !== null
}

function resolveCliLauncher(provider: AgentCliProvider): CliLauncher {
  const scriptPath = getCliScriptPath(provider)

  if (process.platform === 'win32' && scriptPath && fs.existsSync(scriptPath)) {
    const nodeArgs = provider === 'gemini' ? ['--no-warnings=DEP0040'] : []

    return {
      command: process.execPath,
      prefixArgs: [...nodeArgs, scriptPath]
    }
  }

  return {
    command: getCliCommandPath(provider),
    prefixArgs: []
  }
}

function normalizeRateLimitWindow(value: unknown): RateLimitWindow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const windowLike = value as Record<string, unknown>
  const remaining =
    typeof windowLike.remaining === 'number'
      ? windowLike.remaining
      : typeof windowLike.remainingAmount === 'number'
        ? windowLike.remainingAmount
        : null
  const limit =
    typeof windowLike.limit === 'number'
      ? windowLike.limit
      : typeof windowLike.max === 'number'
        ? windowLike.max
        : null
  const resetAt =
    typeof windowLike.resetAt === 'string'
      ? windowLike.resetAt
      : typeof windowLike.resetTime === 'string'
        ? windowLike.resetTime
        : null

  if (remaining === null && limit === null && resetAt === null) {
    return null
  }

  return { remaining, limit, resetAt }
}

function extractRateLimits(value: unknown, source: string): AgentRateLimits | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const directDaily = normalizeRateLimitWindow(record.daily)
  const directWeekly = normalizeRateLimitWindow(record.weekly)

  if (directDaily || directWeekly) {
    return {
      daily: directDaily,
      weekly: directWeekly,
      source
    }
  }

  for (const nested of Object.values(record)) {
    const found = extractRateLimits(nested, source)
    if (found) {
      return found
    }
  }

  return null
}

function extractJsonObjects(stdout: string): unknown[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return []
      }
    })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
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

function parseGeminiOutput(stdout: string): CliExecResult {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    const response =
      typeof parsed.response === 'string'
        ? parsed.response.trim()
        : typeof parsed.content === 'string'
          ? parsed.content.trim()
          : stdout.trim()

    return {
      response,
      sessionId:
        typeof parsed.session_id === 'string'
          ? parsed.session_id
          : typeof parsed.sessionId === 'string'
            ? parsed.sessionId
            : null,
      rateLimits: extractRateLimits(parsed, 'gemini')
    }
  } catch {
    return {
      response: stdout.trim(),
      sessionId: null,
      rateLimits: null
    }
  }
}

function parseCopilotOutput(stdout: string): CliExecResult {
  const records = extractJsonObjects(stdout)
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => entry !== null)

  const assistantMessageEvent = [...records]
    .reverse()
    .find((record) => getNestedString(record, ['type']) === 'assistant.message')

  const assistantMessageContent = getNestedString(assistantMessageEvent, ['data', 'content'])

  const lastDeltaEvent = [...records]
    .reverse()
    .find((record) => getNestedString(record, ['type']) === 'assistant.message_delta')
  const lastDeltaMessageId = getNestedString(lastDeltaEvent, ['data', 'messageId'])
  const deltaContent = lastDeltaMessageId
    ? records
        .filter(
          (record) =>
            getNestedString(record, ['type']) === 'assistant.message_delta' &&
            getNestedString(record, ['data', 'messageId']) === lastDeltaMessageId
        )
        .map((record) => getNestedString(record, ['data', 'deltaContent']) ?? '')
        .join('')
        .trim()
    : ''

  const fallbackResponse = [...records]
    .reverse()
    .map((record) => {
      const directKeys = ['response', 'content', 'message', 'output', 'text']
      for (const key of directKeys) {
        const value = record[key]
        if (typeof value === 'string' && value.trim().length > 0) {
          return value.trim()
        }
      }

      return getNestedString(record, ['data', 'content']) ?? getNestedString(record, ['data', 'message']) ?? null
    })
    .find(Boolean)

  const resultEvent = [...records]
    .reverse()
    .find((record) => getNestedString(record, ['type']) === 'result')

  const sessionCandidate =
    getNestedString(resultEvent, ['sessionId']) ??
    getNestedString(resultEvent, ['data', 'sessionId']) ??
    [...records]
      .reverse()
      .map(
        (record) =>
          getNestedString(record, ['session_id']) ??
          getNestedString(record, ['sessionId']) ??
          getNestedString(record, ['conversationId'])
      )
      .find(Boolean) ??
    null

  const rateLimits = records.map((entry) => extractRateLimits(entry, 'copilot')).find(Boolean) ?? null

  return {
    response:
      assistantMessageContent ??
      (deltaContent || fallbackResponse?.trim() || stdout.trim()),
    sessionId: sessionCandidate ?? null,
    rateLimits
  }
}

function parseCodexOutput(
  stdout: string,
  fallbackSessionId?: string
): { sessionId: string | null; rateLimits: AgentRateLimits | null } {
  const parsedObjects = extractJsonObjects(stdout)
  const threadStarted = parsedObjects.find((entry) => {
    if (!entry || typeof entry !== 'object') {
      return false
    }

    return (entry as Record<string, unknown>).type === 'thread.started'
  }) as Record<string, unknown> | undefined

  const rateLimits =
    parsedObjects.map((entry) => extractRateLimits(entry, 'codex')).find(Boolean) ?? null

  return {
    sessionId:
      typeof threadStarted?.thread_id === 'string'
        ? threadStarted.thread_id
        : fallbackSessionId ?? null,
    rateLimits
  }
}

async function runCopilotViaSdk(
  options: CliRunOptions,
  supportsReasoning: boolean
): Promise<CliExecResult> {
  const sdkModulePath = getCopilotSdkModulePath()
  if (!sdkModulePath) {
    throw new Error('GitHub Copilot SDK runtime is not available.')
  }

  const bridgePath = path.join(__dirname, 'copilotSdkBridge.mjs')
  const prompt = buildPromptBody('copilot', options, supportsReasoning)
  const payload: CopilotBridgeRequest = {
    sdkModulePath,
    workspaceRoot: WORKSPACE_ROOT,
    model: options.model,
    prompt,
    reasoningEffort: supportsReasoning ? options.reasoningEffort : null,
    sessionId: sanitizeSessionId(options.sessionId)
  }

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bridgePath], {
      cwd: WORKSPACE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    child.stdin.on('error', () => {
      // The bridge may close stdin after consuming the request body.
    })

    child.stdin.end(`${JSON.stringify(payload)}\n`)

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `copilot bridge exited with code ${code}`))
        return
      }

      try {
        const parsed = JSON.parse(stdout.trim()) as CliExecResult
        resolve({
          response: parsed.response,
          sessionId: sanitizeSessionId(parsed.sessionId) ?? null,
          rateLimits: parsed.rateLimits ?? null
        })
      } catch (error) {
        reject(new Error(`Failed to parse Copilot bridge output: ${String(error)} / stdout: ${stdout} / stderr: ${stderr}`))
      }
    })
  })
}

function getReadableDirectoryArgs(provider: AgentCliProvider): string[] {
  switch (provider) {
    case 'codex':
      return ['--add-dir', WORKSPACE_ROOT]
    case 'gemini':
      return ['--include-directories', WORKSPACE_ROOT]
    case 'copilot':
      return ['--add-dir', WORKSPACE_ROOT]
    default:
      return []
  }
}

async function getModelRuntimeCapabilities(
  provider: AgentCliProvider,
  model: string
): Promise<ModelRuntimeCapabilities> {
  try {
    const catalogs = await getProviderCatalogs(false)
    const providerCatalog = catalogs[provider]
    const modelInfo = providerCatalog.models.find((entry) => entry.id === model)

    if (modelInfo) {
      return {
        supportedReasoningEfforts: modelInfo.supportedReasoningEfforts,
        defaultReasoningEffort: modelInfo.defaultReasoningEffort
      }
    }
  } catch {
    // Fall back to conservative defaults.
  }

  return {
    supportedReasoningEfforts: provider === 'gemini' ? [] : [],
    defaultReasoningEffort: null
  }
}

function buildPromptPrefix(
  provider: AgentCliProvider,
  reasoningEffort: ReasoningEffort,
  supportsReasoning: boolean
): string {
  const providerLabel =
    provider === 'codex' ? 'Codex CLI' : provider === 'gemini' ? 'Gemini CLI' : 'GitHub Copilot CLI'

  const lines = [
    `You are running inside ${providerLabel}.`,
    'This task is a discussion task only.',
    'Do not modify files.',
    'Do not run shell commands.',
    'Do not browse the web unless strictly required to answer.',
    'Respond in Japanese.'
  ]

  if (supportsReasoning) {
    lines.splice(1, 0, `Reasoning effort preference: ${reasoningEffort}.`)
  }

  return lines.join('\n')
}

function buildPromptBody(
  provider: AgentCliProvider,
  options: CliRunOptions,
  supportsReasoning: boolean
): string {
  return `${buildPromptPrefix(provider, options.reasoningEffort, supportsReasoning)}\n\n${options.prompt}`
}

function buildProviderArgs(
  provider: AgentCliProvider,
  options: CliRunOptions,
  outputFilePath: string | undefined,
  supportsReasoning: boolean
): CliInvocation {
  const prompt = buildPromptBody(provider, options, supportsReasoning)
  const readableDirectoryArgs = getReadableDirectoryArgs(provider)
  const resumableSessionId = shouldResumeSession(provider) ? sanitizeSessionId(options.sessionId) : null

  switch (provider) {
    case 'codex': {
      const sharedArgs = ['exec', '--json', '-C', WORKSPACE_ROOT, '-s', 'read-only', ...readableDirectoryArgs]
      const resultOutputArgs = outputFilePath ? ['-o', outputFilePath] : []

      if (resumableSessionId) {
        return {
          args: [
            ...sharedArgs,
            'resume',
            '-m',
            options.model,
            '--skip-git-repo-check',
            ...resultOutputArgs,
            resumableSessionId,
            '-'
          ],
          stdinPrompt: prompt
        }
      }

      return {
        args: [
          ...sharedArgs,
          '-m',
          options.model,
          '--skip-git-repo-check',
          ...resultOutputArgs,
          '-'
        ],
        stdinPrompt: prompt
      }
    }

    case 'gemini': {
      const args = [
        '--output-format',
        'json',
        '--approval-mode',
        'plan',
        '-m',
        options.model,
        ...readableDirectoryArgs
      ]

      if (resumableSessionId) {
        args.push('--resume', resumableSessionId)
      }

      return {
        args,
        stdinPrompt: prompt
      }
    }

    case 'copilot': {
      const args = [
        '--silent',
        '--model',
        options.model,
        '--allow-all-tools',
        '--no-ask-user',
        '--no-alt-screen',
        '--no-color',
        ...readableDirectoryArgs
      ]

      if (supportsReasoning) {
        args.push('--reasoning-effort', options.reasoningEffort)
      }

      return {
        args,
        stdinPrompt: prompt
      }
    }
  }
}

export async function runCli(options: CliRunOptions): Promise<CliExecResult> {
  const capabilities = await getModelRuntimeCapabilities(options.provider, options.model)
  const supportsReasoning = capabilities.supportedReasoningEfforts.length > 0

  if (options.provider === 'copilot' && hasCopilotSdkRuntime()) {
    return runCopilotViaSdk(options, supportsReasoning)
  }

  const tmpOutFile =
    options.provider === 'codex'
      ? path.join(os.tmpdir(), `turtle-brain-codex-${Date.now()}.txt`)
      : undefined

  const launcher = resolveCliLauncher(options.provider)
  const invocation = buildProviderArgs(options.provider, options, tmpOutFile, supportsReasoning)
  const args = [
    ...launcher.prefixArgs,
    ...invocation.args
  ]

  return new Promise((resolve, reject) => {
    const child = spawn(launcher.command, args, {
      cwd: WORKSPACE_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    child.stdin.on('error', () => {
      // Providers may close stdin early once they have consumed the prompt.
    })

    child.stdin.end(invocation.stdinPrompt ? `${invocation.stdinPrompt}\n` : '')

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code) => {
      if (tmpOutFile) {
        try {
          const response = fs.readFileSync(tmpOutFile, 'utf-8').trim()
          fs.unlinkSync(tmpOutFile)

          if (code !== 0) {
            reject(new Error(`${options.provider} exited with code ${code}. stderr: ${stderr}`))
            return
          }

          if (!response) {
            reject(
              new Error(
                `${options.provider} completed but no final message was written. stdout: ${stdout} stderr: ${stderr}`
              )
            )
            return
          }

          const codexMeta = parseCodexOutput(stdout, options.sessionId)
          resolve({
            response,
            sessionId: codexMeta.sessionId,
            rateLimits: codexMeta.rateLimits
          })
          return
        } catch (error) {
          try {
            fs.unlinkSync(tmpOutFile)
          } catch {
            // no-op
          }

          reject(new Error(`Codex output read failed: ${String(error)}`))
          return
        }
      }

      if (code !== 0) {
        reject(new Error(`${options.provider} exited with code ${code}. stderr: ${stderr || stdout}`))
        return
      }

      const trimmedStdout = stdout.trim()
      if (!trimmedStdout) {
        reject(new Error(`${options.provider} returned an empty response`))
        return
      }

      if (options.provider === 'gemini') {
        resolve(parseGeminiOutput(trimmedStdout))
        return
      }

      resolve(parseCopilotOutput(trimmedStdout))
    })

    child.on('error', (error) => {
      if (tmpOutFile) {
        try {
          fs.unlinkSync(tmpOutFile)
        } catch {
          // no-op
        }
      }

      reject(
        new Error(
          `${options.provider} launch failed: ${error.message} (command: ${launcher.command} ${args.join(' ')})`
        )
      )
    })
  })
}
