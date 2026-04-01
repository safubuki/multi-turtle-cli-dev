import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import type { ProviderCatalogResponse, ProviderId, ProviderModelInfo, ReasoningEffort } from './types.js'
import { dedupeStrings } from './util.js'

type ProviderCatalogMap = Record<ProviderId, ProviderCatalogResponse>

const CACHE_TTL_MS = 5 * 60 * 1000

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

function getCliCommandPath(provider: ProviderId): string | null {
  const npmRoot = getCandidateNpmRoots()[0]
  if (!npmRoot) {
    return null
  }

  const commandName =
    provider === 'codex' ? 'codex.cmd' : provider === 'gemini' ? 'gemini.cmd' : 'copilot.cmd'
  const commandPath = path.join(npmRoot, commandName)
  return existsSync(commandPath) ? commandPath : null
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
      {
        id: 'gemini-3.1-pro-preview',
        name: 'Gemini 3.1 Pro Preview',
        supportedReasoningEfforts: [],
        defaultReasoningEffort: null
      },
      { id: 'gemini-2.5-pro', name: 'gemini-2.5-pro', supportedReasoningEfforts: [], defaultReasoningEffort: null }
    ]
  }

  return [
    {
      id: 'claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5.4',
      name: 'GPT-5.4',
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    },
    {
      id: 'gpt-5.2',
      name: 'GPT-5.2',
      supportedReasoningEfforts: ['low', 'medium', 'high'],
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

async function discoverCodexCatalog(): Promise<ProviderCatalogResponse> {
  const cacheFile = path.join(process.env.USERPROFILE ?? '', '.codex', 'models_cache.json')
  const commandPath = getCliCommandPath('codex')

  if (!existsSync(cacheFile)) {
    return createCatalog('codex', createFallbackModels('codex'), Boolean(commandPath), 'fallback', null)
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

  return createCatalog(
    'codex',
    models.length > 0 ? models : createFallbackModels('codex'),
    Boolean(commandPath),
    'codex models_cache.json',
    null
  )
}

async function discoverGeminiCatalog(): Promise<ProviderCatalogResponse> {
  const commandPath = getCliCommandPath('gemini')
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
    return createCatalog('gemini', createFallbackModels('gemini'), Boolean(commandPath), 'fallback', null)
  }

  const source = await fs.readFile(modelsFile, 'utf8')
  const discovered = Array.from(source.matchAll(/'([^']+gemini[^']+)'/g))
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 8)
    .map((model) => ({
      id: model,
      name: model,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null
    }))

  return createCatalog(
    'gemini',
    discovered.length > 0 ? discovered : createFallbackModels('gemini'),
    Boolean(commandPath),
    'gemini models.js',
    null
  )
}

async function discoverCopilotCatalog(): Promise<ProviderCatalogResponse> {
  const commandPath = getCliCommandPath('copilot')
  const sdkPath = getCopilotSdkModulePath()
  return createCatalog(
    'copilot',
    createFallbackModels('copilot'),
    Boolean(commandPath || sdkPath),
    sdkPath ? 'copilot sdk runtime' : 'fallback',
    null
  )
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
        : createCatalog('codex', createFallbackModels('codex'), Boolean(getCliCommandPath('codex')), 'fallback', String(codex.reason)),
    gemini:
      gemini.status === 'fulfilled'
        ? gemini.value
        : createCatalog('gemini', createFallbackModels('gemini'), Boolean(getCliCommandPath('gemini')), 'fallback', String(gemini.reason)),
    copilot:
      copilot.status === 'fulfilled'
        ? copilot.value
        : createCatalog(
            'copilot',
            createFallbackModels('copilot'),
            Boolean(getCliCommandPath('copilot')),
            'fallback',
            String(copilot.reason)
          )
  }

  cachedCatalogs = {
    fetchedAt: Date.now(),
    value
  }

  return value
}
