import { existsSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { execFile } from 'child_process'
import type { ProviderCatalogResponse, ProviderId, ProviderModelInfo, ProviderVersionInfo, ReasoningEffort } from './types.js'
import { SERVER_ROOT, dedupeStrings } from './util.js'

type ProviderCatalogMap = Record<ProviderId, ProviderCatalogResponse>

type CopilotSdkModelPayload = {
  id: string
  name: string
  supportedReasoningEfforts?: ReasoningEffort[]
  defaultReasoningEffort?: ReasoningEffort | null
}

type ReasoningCapabilityOverride = {
  pattern: RegExp
  supportedReasoningEfforts: ReasoningEffort[]
  defaultReasoningEffort: ReasoningEffort | null
}

const COPILOT_REASONING_OVERRIDES: ReasoningCapabilityOverride[] = [
  {
    pattern: /^gpt-4\.1([-.].+)?$/i,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null
  },
  {
    pattern: /^gpt-4o([-.].+)?$/i,
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null
  }
]

const CACHE_TTL_MS = 5 * 60 * 1000
const PROVIDER_IDS: ProviderId[] = ['codex', 'gemini', 'copilot']
const PROVIDER_PACKAGES: Record<ProviderId, string> = {
  codex: '@openai/codex',
  gemini: '@google/gemini-cli',
  copilot: '@github/copilot'
}
const GEMINI_MODEL_ORDER = [
  'auto-gemini-3',
  'auto-gemini-2.5',
  'gemini-3.1-pro-preview',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
] as const
const GEMINI_HIDDEN_MODEL_IDS = new Set(['gemini-3-pro-preview', 'gemini-3.1-pro-preview-customtools'])

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

function getNpmExecutable(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

function buildProviderInstallCommand(provider: ProviderId, targetVersion = 'latest'): string {
  return `npm install -g ${PROVIDER_PACKAGES[provider]}@${targetVersion}`
}

function createUnknownVersionInfo(provider: ProviderId): ProviderVersionInfo {
  return {
    packageName: PROVIDER_PACKAGES[provider],
    installedVersion: null,
    latestVersion: null,
    updateAvailable: false,
    updateCommand: buildProviderInstallCommand(provider),
    latestCheckError: null
  }
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

async function getInstalledPackageVersion(provider: ProviderId): Promise<string | null> {
  const packageSegments = PROVIDER_PACKAGES[provider].split('/')

  for (const npmRoot of getCandidateNpmRoots()) {
    const packageJsonPath = path.join(npmRoot, 'node_modules', ...packageSegments, 'package.json')
    if (!existsSync(packageJsonPath)) {
      continue
    }

    try {
      const payload = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { version?: unknown }
      if (typeof payload.version === 'string' && payload.version.trim()) {
        return payload.version.trim()
      }
    } catch {
      // Ignore broken package metadata and continue probing other roots.
    }
  }

  return null
}

async function getLatestPackageVersion(provider: ProviderId): Promise<string> {
  const packageName = PROVIDER_PACKAGES[provider]
  const command = `${getNpmExecutable()} view ${packageName} version --silent`

  return new Promise((resolve, reject) => {
    execFile(
      process.platform === 'win32' ? 'cmd.exe' : getNpmExecutable(),
      process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['view', packageName, 'version', '--silent'],
      {
        windowsHide: true,
        cwd: SERVER_ROOT,
        timeout: 10000
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || stdout.trim() || error.message))
          return
        }

        const latestVersion = stdout.trim()
        if (!latestVersion) {
          reject(new Error('empty npm version response'))
          return
        }

        resolve(latestVersion)
      }
    )
  })
}

async function getProviderVersionInfo(provider: ProviderId): Promise<ProviderVersionInfo> {
  const [installedResult, latestResult] = await Promise.allSettled([
    getInstalledPackageVersion(provider),
    getLatestPackageVersion(provider)
  ])

  const installedVersion = installedResult.status === 'fulfilled' ? installedResult.value : null
  const latestVersion = latestResult.status === 'fulfilled' ? latestResult.value : null

  return {
    packageName: PROVIDER_PACKAGES[provider],
    installedVersion,
    latestVersion,
    updateAvailable: Boolean(installedVersion && latestVersion && installedVersion !== latestVersion),
    updateCommand: buildProviderInstallCommand(provider, latestVersion ?? 'latest'),
    latestCheckError: latestResult.status === 'rejected' ? String(latestResult.reason) : null
  }
}

async function getInstalledVersionSnapshot(): Promise<Record<ProviderId, string | null>> {
  const entries = await Promise.all(
    PROVIDER_IDS.map(async (provider) => [provider, await getInstalledPackageVersion(provider)] as const)
  )

  return Object.fromEntries(entries) as Record<ProviderId, string | null>
}

function hasInstalledVersionChanged(catalogs: ProviderCatalogMap, installedVersions: Record<ProviderId, string | null>): boolean {
  return PROVIDER_IDS.some((provider) => catalogs[provider].versionInfo.installedVersion !== installedVersions[provider])
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

function formatGeminiModelName(modelId: string): string {
  if (modelId === 'auto-gemini-3') {
    return 'Auto (Gemini 3)'
  }

  if (modelId === 'auto-gemini-2.5') {
    return 'Auto (Gemini 2.5)'
  }

  return modelId
    .replace(/^gemini-/i, 'Gemini ')
    .replace(/-/g, ' ')
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

function createGeminiModelInfo(modelId: string): ProviderModelInfo {
  return {
    id: modelId,
    name: formatGeminiModelName(modelId),
    supportedReasoningEfforts: [],
    defaultReasoningEffort: null
  }
}

async function readFirstExistingFile(candidates: string[]): Promise<{ path: string; source: string } | null> {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue
    }

    return {
      path: candidate,
      source: await fs.readFile(candidate, 'utf8')
    }
  }

  return null
}

async function readGeminiDiscoverySource(): Promise<{ source: string; label: string } | null> {
  for (const npmRoot of getCandidateNpmRoots()) {
    const packageRoot = path.join(npmRoot, 'node_modules', '@google', 'gemini-cli')
    const directConfig = await readFirstExistingFile([
      path.join(packageRoot, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'config', 'models.js'),
      path.join(packageRoot, 'dist', 'src', 'config', 'models.js')
    ])

    if (directConfig) {
      return {
        source: directConfig.source,
        label: path.relative(packageRoot, directConfig.path).replace(/\\/g, '/')
      }
    }

    const bundleDir = path.join(packageRoot, 'bundle')
    if (!existsSync(bundleDir)) {
      continue
    }

    const bundleFiles = (await fs.readdir(bundleDir))
      .filter((fileName) => fileName.endsWith('.js'))
      .sort()

    if (bundleFiles.length === 0) {
      continue
    }

    const bundleSources = await Promise.all(
      bundleFiles.map(async (fileName) => {
        const filePath = path.join(bundleDir, fileName)
        const source = await fs.readFile(filePath, 'utf8')
        return /auto-gemini-|gemini-2\.5-|gemini-3/i.test(source) ? source : ''
      })
    )

    const combinedSource = bundleSources.filter(Boolean).join('\n')
    if (combinedSource) {
      return {
        source: combinedSource,
        label: 'bundle/*.js'
      }
    }
  }

  return null
}

function extractGeminiModelIds(source: string): string[] {
  const discoveredIds = dedupeStrings(
    Array.from(source.matchAll(/["'`](auto-gemini-[\d.]+|gemini-[\d.][a-z0-9.-]*)["'`]/gi))
      .map((match) => match[1]?.toLowerCase() ?? '')
      .filter((modelId) => modelId.length > 0)
      .filter((modelId) => !GEMINI_HIDDEN_MODEL_IDS.has(modelId))
  )

  const orderedIds = GEMINI_MODEL_ORDER.filter((modelId) => discoveredIds.includes(modelId))

  return orderedIds.length > 0 ? [...orderedIds] : discoveredIds
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
      createGeminiModelInfo('auto-gemini-3'),
      createGeminiModelInfo('auto-gemini-2.5'),
      createGeminiModelInfo('gemini-3.1-pro-preview'),
      createGeminiModelInfo('gemini-3-flash-preview'),
      createGeminiModelInfo('gemini-3.1-flash-lite-preview'),
      createGeminiModelInfo('gemini-2.5-pro'),
      createGeminiModelInfo('gemini-2.5-flash'),
      createGeminiModelInfo('gemini-2.5-flash-lite')
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
  error: string | null,
  versionInfo: ProviderVersionInfo = createUnknownVersionInfo(provider)
): ProviderCatalogResponse {
  return {
    provider,
    label: provider === 'codex' ? 'Codex CLI' : provider === 'gemini' ? 'Gemini CLI' : 'GitHub Copilot CLI',
    source,
    fetchedAt: new Date().toISOString(),
    available,
    models,
    versionInfo,
    error
  }
}

function toReasoningEffortList(values: Array<ReasoningEffort | undefined> | undefined): ReasoningEffort[] {
  return (values ?? []).filter((value): value is ReasoningEffort => Boolean(value))
}

function applyReasoningCapabilityOverrides(
  provider: ProviderId,
  modelId: string,
  supportedReasoningEfforts: ReasoningEffort[],
  defaultReasoningEffort: ReasoningEffort | null
): { supportedReasoningEfforts: ReasoningEffort[]; defaultReasoningEffort: ReasoningEffort | null } {
  if (provider !== 'copilot') {
    return { supportedReasoningEfforts, defaultReasoningEffort }
  }

  const override = COPILOT_REASONING_OVERRIDES.find((item) => item.pattern.test(modelId))
  if (!override) {
    return { supportedReasoningEfforts, defaultReasoningEffort }
  }

  return {
    supportedReasoningEfforts: override.supportedReasoningEfforts,
    defaultReasoningEffort: override.defaultReasoningEffort
  }
}

function normalizeCopilotModelPayload(model: CopilotSdkModelPayload): ProviderModelInfo | null {
  if (!model?.id || !model?.name) {
    return null
  }

  const supportedReasoningEfforts = toReasoningEffortList(model.supportedReasoningEfforts)
  const defaultReasoningEffort = model.defaultReasoningEffort ?? null
  const nextCapabilities = applyReasoningCapabilityOverrides(
    'copilot',
    model.id,
    supportedReasoningEfforts,
    defaultReasoningEffort
  )

  return {
    id: model.id,
    name: model.name,
    supportedReasoningEfforts: nextCapabilities.supportedReasoningEfforts,
    defaultReasoningEffort: nextCapabilities.defaultReasoningEffort
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
  const versionInfo = await getProviderVersionInfo('codex')

  if (!existsSync(cacheFile)) {
    return createCatalog('codex', createFallbackModels('codex'), available, 'fallback', null, versionInfo)
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

  return createCatalog('codex', models.length > 0 ? models : createFallbackModels('codex'), available, 'codex models_cache.json', null, versionInfo)
}

async function discoverGeminiCatalog(): Promise<ProviderCatalogResponse> {
  const available = getProviderRuntimeAvailable('gemini')
  const versionInfo = await getProviderVersionInfo('gemini')
  const discoverySource = await readGeminiDiscoverySource()

  if (!discoverySource) {
    return createCatalog('gemini', createFallbackModels('gemini'), available, 'fallback', null, versionInfo)
  }

  const models = extractGeminiModelIds(discoverySource.source).map((modelId) => createGeminiModelInfo(modelId))

  return createCatalog(
    'gemini',
    models.length > 0 ? models : createFallbackModels('gemini'),
    available,
    `gemini ${discoverySource.label}`,
    null,
    versionInfo
  )
}

async function discoverCopilotCatalog(): Promise<ProviderCatalogResponse> {
  const available = getProviderRuntimeAvailable('copilot')
  const versionInfo = await getProviderVersionInfo('copilot')
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
        return createCatalog('copilot', models, available, 'copilot sdk listModels()', null, versionInfo)
      }
    } catch (error) {
      return createCatalog('copilot', createFallbackModels('copilot'), available, 'fallback', String(error), versionInfo)
    }
  }

  return createCatalog('copilot', createFallbackModels('copilot'), available, 'fallback', null, versionInfo)
}

export function clearProviderCatalogCache(): void {
  cachedCatalogs = null
}

export async function getProviderCatalogs(forceRefresh = false): Promise<ProviderCatalogMap> {
  if (!forceRefresh && cachedCatalogs && Date.now() - cachedCatalogs.fetchedAt < CACHE_TTL_MS) {
    const installedVersions = await getInstalledVersionSnapshot().catch(() => null)
    if (!installedVersions || !hasInstalledVersionChanged(cachedCatalogs.value, installedVersions)) {
      return cachedCatalogs.value
    }

    cachedCatalogs = null
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