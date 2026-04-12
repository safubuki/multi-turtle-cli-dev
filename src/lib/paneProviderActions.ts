import type { MutableRefObject } from 'react'
import { appendStreamEntry } from './appCore'
import {
  buildPaneSessionScopeKey,
  createProviderSettingsFromCatalog,
  getProviderResumeSession,
  syncCurrentProviderSettings,
  updateProviderSessionState
} from './providerState'
import { selectPaneContextMemory } from './runContext'
import type {
  AutonomyMode,
  BootstrapPayload,
  CodexFastMode,
  PaneState,
  PromptImageAttachment,
  ProviderId,
  ReasoningEffort
} from '../types'

type PaneMutator = (paneId: string, updater: (pane: PaneState) => PaneState) => void

interface PaneProviderActionsParams {
  bootstrap: BootstrapPayload | null
  panesRef: MutableRefObject<PaneState[]>
  paneImageAttachmentsRef: MutableRefObject<Record<string, PromptImageAttachment[]>>
  clearPanePromptImages: (paneId: string, options?: { cleanupFiles?: boolean }) => void
  mutatePane: PaneMutator
}

export function createPaneProviderActions(params: PaneProviderActionsParams) {
  const getPane = (paneId: string) => params.panesRef.current.find((item) => item.id === paneId)

  const handleProviderChange = (paneId: string, provider: ProviderId) => {
    if (!params.bootstrap) {
      return
    }

    const pane = getPane(paneId)
    if (!pane || pane.provider === provider) {
      return
    }

    const nextSettings = pane.providerSettings[provider] ?? createProviderSettingsFromCatalog(params.bootstrap.providers, provider)
    const hasPromptImages = (params.paneImageAttachmentsRef.current[paneId] ?? []).length > 0
    if (provider === 'copilot' && hasPromptImages) {
      params.clearPanePromptImages(paneId)
    }

    const changedAt = Date.now()
    params.mutatePane(paneId, (currentPane) => {
      const previousProvider = currentPane.provider
      const savedPane = syncCurrentProviderSettings(
        updateProviderSessionState(currentPane, previousProvider, {
          sessionId: currentPane.sessionId,
          sessionScopeKey: currentPane.sessionScopeKey,
          updatedAt: changedAt
        })
      )
      const candidatePane = {
        ...savedPane,
        provider,
        model: nextSettings.model,
        reasoningEffort: nextSettings.reasoningEffort,
        autonomyMode: nextSettings.autonomyMode,
        codexFastMode: provider === 'codex' ? nextSettings.codexFastMode : 'off'
      }
      const nextSessionScopeKey = buildPaneSessionScopeKey(candidatePane)
      const providerContextMemory = selectPaneContextMemory(savedPane, provider)
      const nextSessionId = getProviderResumeSession(savedPane, provider, nextSessionScopeKey)
      const previousProviderLabel = params.bootstrap?.providers[previousProvider]?.label ?? previousProvider
      const nextProviderLabel = params.bootstrap?.providers[provider]?.label ?? provider
      const switchLog = [
        `CLI切り替え: ${previousProviderLabel} -> ${nextProviderLabel}`,
        `モデル: ${nextSettings.model}`,
        nextSessionId
          ? `native session: 再利用 (${nextSessionId})`
          : providerContextMemory.length > 0
            ? `native session: 新規（同一ペイン補助コンテキスト ${providerContextMemory.length}件を付与）`
            : 'native session: 新規'
      ].join('\n')

      return syncCurrentProviderSettings({
        ...candidatePane,
        sessionId: nextSessionId,
        sessionScopeKey: nextSessionId ? nextSessionScopeKey : null,
        selectedSessionKey: null,
        streamEntries: appendStreamEntry(candidatePane.streamEntries, 'system', switchLog, changedAt, provider, nextSettings.model),
        ...(provider === 'copilot' && hasPromptImages
          ? {
              status: 'attention' as const,
              statusText: 'Copilot では画像添付を使えません',
              lastError: 'GitHub Copilot CLI は画像入力未対応のため、添付画像を解除しました。'
            }
          : {})
      })
    })
  }

  const handleModelChange = (paneId: string, model: string) => {
    if (!params.bootstrap) {
      return
    }

    const pane = getPane(paneId)
    if (!pane) {
      return
    }

    const normalizedModel = model.trim()
    if (!normalizedModel) {
      return
    }

    const modelInfo = params.bootstrap.providers[pane.provider].models.find((item) => item.id === normalizedModel)

    const reasoningEffort =
      !modelInfo ||
      modelInfo.supportedReasoningEfforts.length === 0 ||
      modelInfo.supportedReasoningEfforts.includes(pane.reasoningEffort)
        ? pane.reasoningEffort
        : modelInfo.defaultReasoningEffort ?? 'medium'

    params.mutatePane(paneId, (currentPane) => syncCurrentProviderSettings({
      ...currentPane,
      model: normalizedModel,
      reasoningEffort,
      sessionId: null,
      sessionScopeKey: null,
      selectedSessionKey: null
    }))
  }

  const handleReasoningEffortChange = (paneId: string, reasoningEffort: ReasoningEffort) => {
    if (!params.bootstrap) {
      return
    }

    const pane = getPane(paneId)
    if (!pane) {
      return
    }

    const modelInfo = params.bootstrap.providers[pane.provider].models.find((item) => item.id === pane.model)
    const nextReasoningEffort =
      modelInfo &&
      modelInfo.supportedReasoningEfforts.length > 0 &&
      !modelInfo.supportedReasoningEfforts.includes(reasoningEffort)
        ? modelInfo.defaultReasoningEffort ?? pane.reasoningEffort
        : reasoningEffort

    if (pane.reasoningEffort === nextReasoningEffort) {
      return
    }

    params.mutatePane(paneId, (currentPane) => syncCurrentProviderSettings({
      ...currentPane,
      reasoningEffort: nextReasoningEffort
    }))
  }

  const handleAutonomyModeChange = (paneId: string, autonomyMode: AutonomyMode) => {
    const pane = getPane(paneId)
    if (!pane) {
      return
    }

    const nextAutonomyMode = autonomyMode === 'max' ? 'max' : 'balanced'
    if (pane.autonomyMode === nextAutonomyMode) {
      return
    }

    params.mutatePane(paneId, (currentPane) => syncCurrentProviderSettings({
      ...currentPane,
      autonomyMode: nextAutonomyMode
    }))
  }

  const handleCodexFastModeChange = (paneId: string, codexFastMode: CodexFastMode) => {
    const pane = getPane(paneId)
    if (!pane) {
      return
    }

    const nextCodexFastMode = pane.provider === 'codex' && codexFastMode === 'fast' ? 'fast' : 'off'
    if (pane.codexFastMode === nextCodexFastMode) {
      return
    }

    params.mutatePane(paneId, (currentPane) => syncCurrentProviderSettings({
      ...currentPane,
      codexFastMode: currentPane.provider === 'codex' && nextCodexFastMode === 'fast' ? 'fast' : 'off'
    }))
  }

  return {
    handleProviderChange,
    handleModelChange,
    handleReasoningEffortChange,
    handleAutonomyModeChange,
    handleCodexFastModeChange
  }
}