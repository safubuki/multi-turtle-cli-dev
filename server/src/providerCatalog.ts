import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { execFile, spawn } from 'child_process'
import type { ProviderCatalogResponse, ProviderId, ProviderModelInfo, ProviderUpdateResult, ReasoningEffort } from './types.js'
import { SERVER_ROOT, dedupeStrings } from './util.js'

type ProviderCatalogMap = Record<ProviderId, ProviderCatalogResponse>

type CopilotSdkModelPayload = {
  id: string
  name: string
  supportedReasoningEfforts?: ReasoningEffort[]
  defaultReasoningEffort?: ReasoningEffort | null
}

const CACHE_TTL_MS = 5 * 60 * 1000
const PROVIDER_PACKAGES: Record<ProviderId, string> = {
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
  copilot: '@github/copilot'
}

let cachedCatalogs:
  | {
      fetchedAt: number
      value: ProviderCatalogMap
    }
  | null = null

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

function getCliCommandPath(provider: ProviderId): string | null {
  const npmRoot = getCandidateNpmRoots()[0]
  if (!npmRoot) {
    return null
  }

  const baseName = provider === 'codex' ? 'codex' : provider === 'gemini' ? 'gemini' : 'copilot'
  const candidates = [
    path.join(npmRoot, `${baseName}.cmd`),
    path.join(npmRoot, `${baseName}.ps1`),
    path.join(npmRoot, `${baseName}.bat`),
    path.join(npmRoot, `${baseName}.exe`)
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? null
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
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }

  return null
}

function getProviderRuntimeAvailable(provider: ProviderId): boolean {
  if (provider === 'copilot') {
    return Boolean(getCliCommandPath('copilot') || getCopilotSdkModulePath() || getCliScriptPath('copilot'))
  }

  return Boolean(getCliCommandPath(provider) || getCliScriptPath(provider))
}

export function getCopilotSdkModulePath(): string | null {
  for (const npmRoot of getCandidateNpmRoots()) {
    const sdkPath = path.join(npmRoot, 'node_modules', '@github', 'copilot', 'copilot-sdk', 'index.js')
    if (existsSync(sdkPath)) {
      return sdkPath
    }
  }

  return null
}

function createFallbackModels(provider: ProviderId): ProviderModelInfo[] {
  if (provider === 'codex') {
    return [
      {
        id: 'gpt-5.4',
        name: 'gpt-5.4',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'medium'
      },
      {
        id: 'gpt-5.4-mini',
        name: 'gpt-5.4-mini',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'medium'
      },
      {
        id: 'gpt-5.3-codex',
        name: 'gpt-5.3-codex',
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'medium'
      }
    ]
  }

  if (provider === 'gemini') {
    return [
      { id: 'auto-gemini-3', name: 'Auto (Gemini 3)', supportedReasoningEfforts: [], defaultReasoningEffort: null },
      { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)', supportedReasoningEfforts: [], defaultReasoningEffort: null },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', supportedReasoningEfforts: [], defaultReasoningEffort: null },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportedReasoningEfforts: [], defaultReasoningEffort: null },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportedReasoningEfforts: [], defaultReasoningEffort: null }
    ]
  }

  return [
    {
      id: 'claude-sonnet-4.5',
      name: 'Claude Sonnet 4.5',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5',
      name: 'GPT-5',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5.1',
      name: 'GPT-5.1',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5.2',
      name: 'GPT-5.2',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    }
  ]
}

function createCatalog(
  provider: ProviderId,
  models: ProviderModelInfo[],
  available: boolean,
  source: string,
  error: string | null
): ProviderCatalogResponse {
  return {
    provider,
    label: provider === 'codex' ? 'Codex CLI' : provider === 'gemini' ? 'Gemini CLI' : 'GitHub Copilot CLI',
    source,
    fetchedAt: new Date().toISOString(),
    available,
    models,
    error
  }
}

function toReasoningEffortList(values: Array<ReasoningEffort | undefined> | undefined): ReasoningEffort[] {
  return (values ?? []).filter((value): value is ReasoningEffort => Boolean(value))
}

function normalizeCopilotModelPayload(model: CopilotSdkModelPayload): ProviderModelInfo | null {
  if (!model?.id || !model?.name) {
    return null
  }

  return {
    id: model.id,
    name: model.name,
    supportedReasoningEfforts: toReasoningEffortList(model.supportedReasoningEfforts),
    defaultReasoningEffort: model.defaultReasoningEffort ?? null
  }
}

async function runCopilotSdkBridge(request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const bridgePath = path.join(SERVER_ROOT, 'src', 'copilotSdkBridge.mjs')

  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [bridgePath], { windowsHide: true, cwd: SERVER_ROOT }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr.trim() || error.message))
        return
      }

      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(new Error(parseError instanceof Error ? parseError.message : String(parseError)))
      }
    })

    child.stdin?.end(JSON.stringify(request))
  })
}

async function discoverCodexCatalog(): Promise<ProviderCatalogResponse> {
  const cacheFile = path.join(process.env.USERPROFILE ?? '', '.codex', 'models_cache.json')
  const available = getProviderRuntimeAvailable('codex')

  if (!existsSync(cacheFile)) {
    return createCatalog('codex', createFallbackModels('codex'), available, 'fallback', null)
  }

  const payload = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as {
    models?: Array<{
      slug?: string
      display_name?: string
      description?: string
      visibility?: string
      supported_reasoning_levels?: Array<{ effort?: ReasoningEffort }>
      default_reasoning_level?: ReasoningEffort
    }>
  }

  const models = (payload.models ?? [])
    .filter((entry): entry is NonNullable<typeof entry> & { slug: string } => Boolean(entry?.slug && entry.visibility !== 'hide'))
    .map((entry) => ({
      id: entry.slug,
      name: entry.display_name ?? entry.slug,
      description: entry.description,
      supportedReasoningEfforts: toReasoningEffortList(entry.supported_reasoning_levels?.map((item) => item.effort)),
      defaultReasoningEffort: entry.default_reasoning_level ?? null
    }))

  return createCatalog('codex', models.length > 0 ? models : createFallbackModels('codex'), available, 'codex models_cache.json', null)
}

async function discoverGeminiCatalog(): Promise<ProviderCatalogResponse> {
  const available = getProviderRuntimeAvailable('gemini')
  const modelsFile = path.join(
    process.env.APPDATA ?? '',
    'npm',
    'node_modules',
    '@google',
    'gemini-cli',
    'node_modules',
    '@google',
    'gemini-cli-core',
    'dist',
    'src',
    'config',
    'models.js'
  )

  if (!existsSync(modelsFile)) {
    return createCatalog('gemini', createFallbackModels('gemini'), available, 'fallback', null)
  }

  const source = await fs.readFile(modelsFile, 'utf8')
  const preferredOrder = [
    'auto-gemini-3',
    'auto-gemini-2.5',
    'gemini-3.1-pro-preview',
    'gemini-3.1-pro-preview-customtools',
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite-preview',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ]

  const discoveredIds = Array.from(source.matchAll(/export const [A-Z0-9_]+ = '([^']+)'/g))
    .map((match) => match[1])
    .filter((value) => /^(auto-gemini-[\d.]+|gemini-[\d.][a-z0-9.-]*)$/i.test(value))
  const orderedIds = preferredOrder.filter((id) => discoveredIds.includes(id))
  const models = (orderedIds.length > 0 ? orderedIds : discoveredIds)
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((model) => ({
      id: model,
      name:
        model === 'auto-gemini-3'
          ? 'Auto (Gemini 3)'
          : model === 'auto-gemini-2.5'
            ? 'Auto (Gemini 2.5)'
            : model,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null
    }))

  return createCatalog('gemini', models.length > 0 ? models : createFallbackModels('gemini'), available, 'gemini models.js', null)
}

async function discoverCopilotCatalog(): Promise<ProviderCatalogResponse> {
  const available = getProviderRuntimeAvailable('copilot')
  const sdkModulePath = getCopilotSdkModulePath()

  if (sdkModulePath) {
    try {
      const response = await runCopilotSdkBridge({
        mode: 'listModels',
        sdkModulePath,
        workspaceRoot: SERVER_ROOT
      })

      const models = Array.isArray(response.models)
        ? response.models
            .map((item) => normalizeCopilotModelPayload(item as CopilotSdkModelPayload))
            .filter((item): item is ProviderModelInfo => Boolean(item))
        : []

      if (models.length > 0) {
        return createCatalog('copilot', models, available, 'copilot sdk listModels()', null)
      }
    } catch (error) {
      return createCatalog('copilot', createFallbackModels('copilot'), available, 'fallback', String(error))
    }
  }

  return createCatalog('copilot', createFallbackModels('copilot'), available, 'fallback', null)
}

export function clearProviderCatalogCache(): void {
  cachedCatalogs = null
}

export async function updateProviderCli(provider: ProviderId): Promise<ProviderUpdateResult> {
  const packageName = PROVIDER_PACKAGES[provider]

  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn(getCmdExecutable(), ['/d', '/s', '/c', `npm.cmd install -g ${packageName}@latest`], {
            windowsHide: true,
            cwd: SERVER_ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        : spawn('npm', ['install', '-g', `${packageName}@latest`], {
            cwd: SERVER_ROOT,
            stdio: ['ignore', 'pipe', 'pipe']
          })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.once('error', (error) => {
      reject(error)
    })

    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `update failed with code ${code}`))
        return
      }

      clearProviderCatalogCache()
      resolve({
        provider,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      })
    })
  })
}

export async function getProviderCatalogs(forceRefresh = false): Promise<ProviderCatalogMap> {
  if (!forceRefresh && cachedCatalogs && Date.now() - cachedCatalogs.fetchedAt < CACHE_TTL_MS) {
    return cachedCatalogs.value
  }

  const [codex, gemini, copilot] = await Promise.allSettled([
    discoverCodexCatalog(),
    discoverGeminiCatalog(),
    discoverCopilotCatalog()
  ])

  const value: ProviderCatalogMap = {
    codex:
      codex.status === 'fulfilled'
        ? codex.value
        : createCatalog('codex', createFallbackModels('codex'), getProviderRuntimeAvailable('codex'), 'fallback', String(codex.reason)),
    gemini:
      gemini.status === 'fulfilled'
        ? gemini.value
        : createCatalog('gemini', createFallbackModels('gemini'), getProviderRuntimeAvailable('gemini'), 'fallback', String(gemini.reason)),
    copilot:
      copilot.status === 'fulfilled'
        ? copilot.value
        : createCatalog('copilot', createFallbackModels('copilot'), getProviderRuntimeAvailable('copilot'), 'fallback', String(copilot.reason))
  }

  cachedCatalogs = {
    fetchedAt: Date.now(),
    value
  }

  return value
}