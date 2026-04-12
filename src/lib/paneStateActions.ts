import type { Dispatch, SetStateAction } from 'react'
import {
  appendStreamEntry,
  findReusableSshPane,
  getPreferredLocalSshKey,
  mergeLocalSshKeys
} from './appCore'
import { syncCurrentProviderSettings } from './providerState'
import type { PaneState } from '../types'

export type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void
export type PaneMutator = (paneId: string, updater: (pane: PaneState) => PaneState) => void

interface PaneStateActionsParams {
  setPanes: Dispatch<SetStateAction<PaneState[]>>
}

export function createPaneStateActions(params: PaneStateActionsParams) {
  const mutatePane: PaneMutator = (paneId, updater) => {
    params.setPanes((current) => current.map((pane) => (pane.id === paneId ? updater(pane) : pane)))
  }

  const updatePane: PaneUpdater = (paneId, updates) => {
    params.setPanes((current) => current.map((pane) => {
      if (pane.id !== paneId) {
        return pane
      }

      const nextPane = { ...pane, ...updates }
      if (typeof updates.sshHost !== 'string') {
        return syncCurrentProviderSettings(nextPane)
      }

      const reusablePane = findReusableSshPane(paneId, nextPane.sshHost, current)
      if (!reusablePane) {
        return nextPane
      }

      const mergedLocalKeys = mergeLocalSshKeys(nextPane.sshLocalKeys, reusablePane.sshLocalKeys)
      const hasExplicitKeySelection = Boolean(nextPane.sshSelectedKeyPath.trim() || nextPane.sshIdentityFile.trim())
      const preferredKey = getPreferredLocalSshKey({ ...nextPane, sshLocalKeys: mergedLocalKeys }, mergedLocalKeys, current)

      if (mergedLocalKeys.length !== nextPane.sshLocalKeys.length) {
        nextPane.sshLocalKeys = mergedLocalKeys
      }

      if (!hasExplicitKeySelection) {
        if (preferredKey) {
          nextPane.sshSelectedKeyPath = preferredKey.privateKeyPath
          nextPane.sshIdentityFile = preferredKey.privateKeyPath
          nextPane.sshPublicKeyText = preferredKey.publicKey
          nextPane.sshKeyName = preferredKey.name
          nextPane.sshKeyComment = preferredKey.comment
        } else if (reusablePane.sshIdentityFile.trim()) {
          nextPane.sshIdentityFile = reusablePane.sshIdentityFile.trim()
        }
      }

      return syncCurrentProviderSettings(nextPane)
    }))
  }

  const appendPaneSystemMessage = (paneId: string, text: string) => {
    const eventAt = Date.now()
    mutatePane(paneId, (pane) => ({
      ...pane,
      streamEntries: appendStreamEntry(pane.streamEntries, 'system', text, eventAt),
      lastActivityAt: eventAt
    }))
  }

  return {
    updatePane,
    mutatePane,
    appendPaneSystemMessage
  }
}