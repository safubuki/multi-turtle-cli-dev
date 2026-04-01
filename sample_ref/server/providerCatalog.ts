import { spawn } from 'child_process'
import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import type { AgentCliProvider, ReasoningEffort } from './cliRunner'

export interface ProviderModelInfo {
  id: string
  name: string
  description?: string
  supportedReasoningEfforts: ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort | null
  billingMultiplier: number | null
}

export interface ProviderCatalogResponse {
  provider: AgentCliProvider
  label: string
  source: string
  fetchedAt: string | null
  available: boolean
  models: ProviderModelInfo[]
  error: string | null
}

type ProviderCatalogMap = Record<AgentCliProvider, ProviderCatalogResponse>

interface CachedCatalogs {
  fetchedAt: number
  catalogs: ProviderCatalogMap
}

const CACHE_TTL_MS = 5 * 60 * 1000
let cachedCatalogs: CachedCatalogs | null = null

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

function getCopilotSdkModulePath(): string | null {
  for (const npmRoot of getCandidateNpmRoots()) {
    const sdkPath = path.join(npmRoot, 'node_modules', '@github', 'copilot', 'copilot-sdk', 'index.js')
    if (existsSync(sdkPath)) {
      return sdkPath
    }
  }

  return null
}

function createFallbackCatalog(provider: AgentCliProvider, error: string | null = null): ProviderCatalogResponse {
  const now = new Date().toISOString()
  const available = !error

  if (provider === 'codex') {
    return {
      provider,
      label: 'Codex CLI',
      source: 'fallback',
      fetchedAt: now,
      available,
      error,
      models: [
        { id: 'gpt-5.4', name: 'gpt-5.4', description: 'Latest frontier agentic coding model.', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', billingMultiplier: null },
        { id: 'gpt-5.4-mini', name: 'gpt-5.4-mini', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', billingMultiplier: null },
        { id: 'gpt-5.3-codex', name: 'gpt-5.3-codex', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', billingMultiplier: null },
        { id: 'gpt-5.2-codex', name: 'gpt-5.2-codex', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', billingMultiplier: null },
        { id: 'gpt-5.2', name: 'gpt-5.2', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', billingMultiplier: null }
      ]
    }
  }

  if (provider === 'gemini') {
    return {
      provider,
      label: 'Gemini CLI',
      source: 'fallback',
      fetchedAt: now,
      available,
      error,
      models: [
        { id: 'auto-gemini-3', name: 'Auto (Gemini 3)', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: null },
        { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: null },
        { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: null },
        { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: null },
        { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: null },
        { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: null }
      ]
    }
  }

  return {
    provider,
    label: 'GitHub Copilot CLI',
    source: 'fallback',
    fetchedAt: now,
    available,
    error,
    models: [
      { id: 'claude-sonnet-4.6', name: 'Claude Sonnet 4.6', supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium', billingMultiplier: 1 },
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Preview)', supportedReasoningEfforts: [], defaultReasoningEffort: null, billingMultiplier: 1 },
      { id: 'gpt-5.4', name: 'GPT-5.4', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'], defaultReasoningEffort: 'medium', billingMultiplier: 1 },
      { id: 'gpt-5.2', name: 'GPT-5.2', supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium', billingMultiplier: 1 },
      { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1-Codex-Mini', supportedReasoningEfforts: ['low', 'medium', 'high'], defaultReasoningEffort: 'medium', billingMultiplier: 0.33 }
    ]
  }
}

function runNodeScript(script: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('Provider catalog command timed out'))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Catalog command exited with code ${code}`))
        return
      }

      if (!stdout.trim()) {
        reject(new Error(stderr.trim() || 'Catalog command returned empty output'))
        return
      }

      resolve(stdout.trim())
    })
  })
}

function normalizeReasoningEfforts(value: unknown): ReasoningEffort[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is ReasoningEffort =>
    entry === 'low' || entry === 'medium' || entry === 'high' || entry === 'xhigh'
  )
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort | null {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value
  }

  return null
}

function normalizeModelInfo(value: unknown): ProviderModelInfo[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    .map((entry) => ({
      id: typeof entry.id === 'string' ? entry.id : '',
      name: typeof entry.name === 'string' ? entry.name : (typeof entry.id === 'string' ? entry.id : ''),
      description: typeof entry.description === 'string' ? entry.description : undefined,
      supportedReasoningEfforts: normalizeReasoningEfforts(entry.supportedReasoningEfforts),
      defaultReasoningEffort: normalizeReasoningEffort(entry.defaultReasoningEffort),
      billingMultiplier: typeof entry.billingMultiplier === 'number' ? entry.billingMultiplier : null
    }))
    .filter((model) => Boolean(model.id))
}

async function discoverCodexCatalog(): Promise<ProviderCatalogResponse> {
  const filePath = path.join(process.env.USERPROFILE ?? '', '.codex', 'models_cache.json')
  const payload = JSON.parse(await fs.readFile(filePath, 'utf8')) as {
    fetched_at?: string
    models?: Array<{
      slug?: string
      display_name?: string
      description?: string
      visibility?: string
      supported_reasoning_levels?: Array<{ effort?: unknown }>
      default_reasoning_level?: unknown
    }>
  }

  const models = Array.isArray(payload.models) ? payload.models : []

  return {
    provider: 'codex',
    label: 'Codex CLI',
    source: 'Codex models_cache.json',
    fetchedAt: payload.fetched_at ?? new Date().toISOString(),
    available: true,
    error: null,
    models: models
      .filter((model): model is NonNullable<typeof model> & { slug: string } => Boolean(model?.slug && model.visibility !== 'hide'))
      .map((model) => ({
        id: model.slug,
        name: model.display_name || model.slug,
        description: model.description,
        supportedReasoningEfforts: normalizeReasoningEfforts(
          Array.isArray(model.supported_reasoning_levels)
            ? model.supported_reasoning_levels.map((entry) => entry.effort)
            : []
        ),
        defaultReasoningEffort: normalizeReasoningEffort(model.default_reasoning_level),
        billingMultiplier: null
      }))
  }
}

async function discoverGeminiCatalog(): Promise<ProviderCatalogResponse> {
  const modelsFilePath = path.join(
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
  const modelsSource = await fs.readFile(modelsFilePath, 'utf8')

  const modelConstants = Object.fromEntries(
    Array.from(modelsSource.matchAll(/export const (\w+) = '([^']+)'/g)).map((match) => [match[1], match[2]])
  ) as Record<string, string>

  const getDisplayName = (id: string): string => {
    const manualLabels: Record<string, string> = {
      'auto-gemini-3': 'Auto (Gemini 3)',
      'auto-gemini-2.5': 'Auto (Gemini 2.5)',
      'gemini-3-pro-preview': 'Gemini 3 Pro Preview',
      'gemini-3.1-pro-preview': 'Gemini 3.1 Pro Preview',
      'gemini-3.1-pro-preview-customtools': 'Gemini 3.1 Pro Preview Custom Tools',
      'gemini-3-flash-preview': 'Gemini 3 Flash Preview',
      'gemini-3.1-flash-lite-preview': 'Gemini 3.1 Flash Lite Preview',
      'gemini-2.5-pro': 'Gemini 2.5 Pro',
      'gemini-2.5-flash': 'Gemini 2.5 Flash',
      'gemini-2.5-flash-lite': 'Gemini 2.5 Flash Lite'
    }

    return manualLabels[id] ?? id
  }

  const candidates = [
    { id: modelConstants.PREVIEW_GEMINI_MODEL_AUTO, description: 'Let Gemini CLI decide the best model for the task: gemini-3.1-pro, gemini-3-flash' },
    { id: modelConstants.DEFAULT_GEMINI_MODEL_AUTO, description: 'Let Gemini CLI decide the best model for the task: gemini-2.5-pro, gemini-2.5-flash' },
    { id: modelConstants.PREVIEW_GEMINI_3_1_MODEL },
    { id: modelConstants.PREVIEW_GEMINI_3_1_CUSTOM_TOOLS_MODEL },
    { id: modelConstants.PREVIEW_GEMINI_FLASH_MODEL },
    { id: modelConstants.PREVIEW_GEMINI_3_1_FLASH_LITE_MODEL },
    { id: modelConstants.DEFAULT_GEMINI_MODEL },
    { id: modelConstants.DEFAULT_GEMINI_FLASH_MODEL },
    { id: modelConstants.DEFAULT_GEMINI_FLASH_LITE_MODEL }
  ].filter((entry): entry is { id: string; description?: string } => typeof entry.id === 'string' && entry.id.length > 0)

  const seen = new Set<string>()
  const models = candidates
    .filter((entry) => {
      if (seen.has(entry.id)) {
        return false
      }
      seen.add(entry.id)
      return true
    })
    .map((entry) => ({
      id: entry.id,
      name: getDisplayName(entry.id),
      description: entry.description,
      supportedReasoningEfforts: [],
      defaultReasoningEffort: null,
      billingMultiplier: null
    }))

  return {
    provider: 'gemini',
    label: 'Gemini CLI',
    source: 'Gemini CLI core constants',
    fetchedAt: new Date().toISOString(),
    available: true,
    error: null,
    models
  }
}

async function discoverCopilotCatalog(): Promise<ProviderCatalogResponse> {
  const sdkPath = getCopilotSdkModulePath()
  if (!sdkPath) {
    throw new Error('GitHub Copilot SDK runtime is not available.')
  }

  const sdkUrl = pathToFileURL(sdkPath).href

  const script = `
    (async () => {
      const { CopilotClient } = await import(${JSON.stringify(sdkUrl)});
      const client = new CopilotClient({ useStdio: true, autoStart: false });

      try {
        await client.start();
        const models = await client.listModels();
        console.log(JSON.stringify({
          provider: 'copilot',
          label: 'GitHub Copilot CLI',
          source: 'Copilot SDK models.list',
          fetchedAt: new Date().toISOString(),
          available: true,
          error: null,
          models: models.map((model) => ({
            id: model.id,
            name: model.name || model.id,
            supportedReasoningEfforts: model.supportedReasoningEfforts || [],
            defaultReasoningEffort: model.defaultReasoningEffort || null,
            billingMultiplier: model.billing?.multiplier ?? null
          }))
        }));
      } finally {
        await client.stop().catch(() => []);
      }
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `

  const raw = await runNodeScript(script, 45000)
  const parsed = JSON.parse(raw) as Record<string, unknown>

  return {
    provider: 'copilot',
    label: 'GitHub Copilot CLI',
    source: typeof parsed.source === 'string' ? parsed.source : 'Copilot SDK models.list',
    fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : new Date().toISOString(),
    available: true,
    error: null,
    models: normalizeModelInfo(parsed.models)
  }
}

export async function getProviderCatalogs(forceRefresh = false): Promise<ProviderCatalogMap> {
  if (!forceRefresh && cachedCatalogs && Date.now() - cachedCatalogs.fetchedAt < CACHE_TTL_MS) {
    return cachedCatalogs.catalogs
  }

  const [codexResult, geminiResult, copilotResult] = await Promise.allSettled([
    discoverCodexCatalog(),
    discoverGeminiCatalog(),
    discoverCopilotCatalog()
  ])

  const catalogs: ProviderCatalogMap = {
    codex: codexResult.status === 'fulfilled' ? codexResult.value : createFallbackCatalog('codex', codexResult.reason instanceof Error ? codexResult.reason.message : String(codexResult.reason)),
    gemini: geminiResult.status === 'fulfilled' ? geminiResult.value : createFallbackCatalog('gemini', geminiResult.reason instanceof Error ? geminiResult.reason.message : String(geminiResult.reason)),
    copilot: copilotResult.status === 'fulfilled' ? copilotResult.value : createFallbackCatalog('copilot', copilotResult.reason instanceof Error ? copilotResult.reason.message : String(copilotResult.reason))
  }

  cachedCatalogs = {
    fetchedAt: Date.now(),
    catalogs
  }

  return catalogs
}
