import type {
  PaneProviderSessionState,
  PaneProviderSettings,
  PaneState,
  ProviderCatalogResponse,
  ProviderId,
  ReasoningEffort
} from '../types'

const PROVIDERS: ProviderId[] = ['codex', 'copilot', 'gemini']

type PaneSessionScopeInput = Pick<
  PaneState,
  'provider' | 'model' | 'workspaceMode' | 'localWorkspacePath' | 'sshHost' | 'sshUser' | 'sshPort' | 'remoteWorkspacePath'
>

export function isProviderId(value: unknown): value is ProviderId {
  return value === 'codex' || value === 'copilot' || value === 'gemini'
}

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh'
}

export function buildPaneSessionScopeKey(pane: PaneSessionScopeInput): string {
  if (pane.workspaceMode === 'local') {
    return ['local', pane.provider, pane.model, pane.localWorkspacePath.trim()].join('::')
  }

  return ['ssh', pane.provider, pane.model, pane.sshUser.trim(), pane.sshHost.trim(), pane.sshPort.trim(), pane.remoteWorkspacePath.trim()].join('::')
}

export function createEmptyProviderSessionState(): PaneProviderSessionState {
  return {
    sessionId: null,
    sessionScopeKey: null,
    lastSharedLogEntryId: null,
    lastSharedStreamEntryId: null,
    updatedAt: null
  }
}

export function createEmptyProviderSessions(): Record<ProviderId, PaneProviderSessionState> {
  return {
    codex: createEmptyProviderSessionState(),
    copilot: createEmptyProviderSessionState(),
    gemini: createEmptyProviderSessionState()
  }
}

export function createProviderSettingsFromCatalog(catalogs: Record<ProviderId, ProviderCatalogResponse>, provider: ProviderId): PaneProviderSettings {
  const model = catalogs[provider].models[0]
  return {
    model: model?.id ?? '',
    reasoningEffort: model?.defaultReasoningEffort ?? 'medium',
    autonomyMode: 'balanced',
    codexFastMode: 'off'
  }
}

export function normalizeProviderSettings(
  rawSettings: Partial<PaneProviderSettings> | null | undefined,
  catalogs: Record<ProviderId, ProviderCatalogResponse>,
  provider: ProviderId
): PaneProviderSettings {
  const fallback = createProviderSettingsFromCatalog(catalogs, provider)
  const catalog = catalogs[provider]
  const model = typeof rawSettings?.model === 'string' && catalog.models.some((item) => item.id === rawSettings.model)
    ? rawSettings.model
    : fallback.model
  const modelInfo = catalog.models.find((item) => item.id === model) ?? catalog.models[0]
  const reasoningEffort =
    isReasoningEffort(rawSettings?.reasoningEffort) &&
    (modelInfo?.supportedReasoningEfforts.length ? modelInfo.supportedReasoningEfforts.includes(rawSettings.reasoningEffort) : true)
      ? rawSettings.reasoningEffort
      : modelInfo?.defaultReasoningEffort ?? fallback.reasoningEffort

  return {
    model,
    reasoningEffort,
    autonomyMode: rawSettings?.autonomyMode === 'max' ? 'max' : 'balanced',
    codexFastMode: provider === 'codex' && rawSettings?.codexFastMode === 'fast' ? 'fast' : 'off'
  }
}

export function createProviderSettingsMap(catalogs: Record<ProviderId, ProviderCatalogResponse>): Record<ProviderId, PaneProviderSettings> {
  return {
    codex: createProviderSettingsFromCatalog(catalogs, 'codex'),
    copilot: createProviderSettingsFromCatalog(catalogs, 'copilot'),
    gemini: createProviderSettingsFromCatalog(catalogs, 'gemini')
  }
}

export function normalizeProviderSettingsMap(
  rawSettings: Partial<Record<ProviderId, Partial<PaneProviderSettings>>> | null | undefined,
  catalogs: Record<ProviderId, ProviderCatalogResponse>
): Record<ProviderId, PaneProviderSettings> {
  return {
    codex: normalizeProviderSettings(rawSettings?.codex, catalogs, 'codex'),
    copilot: normalizeProviderSettings(rawSettings?.copilot, catalogs, 'copilot'),
    gemini: normalizeProviderSettings(rawSettings?.gemini, catalogs, 'gemini')
  }
}

export function normalizeProviderSessionState(rawSession: Partial<PaneProviderSessionState> | null | undefined): PaneProviderSessionState {
  return {
    sessionId: typeof rawSession?.sessionId === 'string' ? rawSession.sessionId : null,
    sessionScopeKey: typeof rawSession?.sessionScopeKey === 'string' ? rawSession.sessionScopeKey : null,
    lastSharedLogEntryId: typeof rawSession?.lastSharedLogEntryId === 'string' ? rawSession.lastSharedLogEntryId : null,
    lastSharedStreamEntryId: typeof rawSession?.lastSharedStreamEntryId === 'string' ? rawSession.lastSharedStreamEntryId : null,
    updatedAt: typeof rawSession?.updatedAt === 'number' ? rawSession.updatedAt : null
  }
}

export function normalizeProviderSessionsMap(
  rawSessions: Partial<Record<ProviderId, Partial<PaneProviderSessionState>>> | null | undefined
): Record<ProviderId, PaneProviderSessionState> {
  return Object.fromEntries(
    PROVIDERS.map((provider) => [provider, normalizeProviderSessionState(rawSessions?.[provider])])
  ) as Record<ProviderId, PaneProviderSessionState>
}

export function getCurrentProviderSettings(pane: PaneState): PaneProviderSettings {
  return {
    model: pane.model,
    reasoningEffort: pane.reasoningEffort,
    autonomyMode: pane.autonomyMode,
    codexFastMode: pane.provider === 'codex' ? pane.codexFastMode : 'off'
  }
}

export function syncCurrentProviderSettings(pane: PaneState): PaneState {
  return {
    ...pane,
    providerSettings: {
      ...pane.providerSettings,
      [pane.provider]: getCurrentProviderSettings(pane)
    }
  }
}

export function updateProviderSessionState(
  pane: PaneState,
  provider: ProviderId,
  updates: Partial<PaneProviderSessionState>
): PaneState {
  return {
    ...pane,
    providerSessions: {
      ...pane.providerSessions,
      [provider]: {
        ...pane.providerSessions[provider],
        ...updates
      }
    }
  }
}

export function resetProviderSessionState(pane: PaneState, provider: ProviderId): PaneState {
  return updateProviderSessionState(pane, provider, createEmptyProviderSessionState())
}

export function getProviderResumeSession(pane: PaneState, provider: ProviderId, scopeKey: string): string | null {
  const providerSession = pane.providerSessions[provider]
  if (providerSession?.sessionScopeKey === scopeKey) {
    return providerSession.sessionId
  }

  if (provider === pane.provider && pane.sessionScopeKey === scopeKey) {
    return pane.sessionId
  }

  return null
}
