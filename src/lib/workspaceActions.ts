import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import {
  browseLocalDirectory,
  browseRemoteDirectory,
  createLocalDirectory,
  createRemoteDirectory,
  deleteSshKey,
  fetchLocalBrowseRoots,
  fetchRemoteWorkspaces,
  generateSshKey,
  inspectSshHost,
  installSshKey,
  openTargetInCommandPrompt,
  openTargetInFileManager,
  openWorkspaceInVsCode,
  pickLocalWorkspace,
  pickSaveFilePath,
  removeKnownHost,
  transferSshPath
} from './api'
import {
  appendStreamEntry,
  buildSshConnectionFromPane,
  buildSshLabel,
  buildTargetFromPane,
  getPreferredLocalSshKey,
  mergeLocalSshKeys
} from './appCore'
import {
  createProviderSettingsFromCatalog,
  getCurrentProviderSettings,
  syncCurrentProviderSettings
} from './providerState'
import { applyBackgroundActionFailure, applyBackgroundActionSuccess } from './paneState'
import { STORAGE_KEYS } from './storage'
import {
  buildLocalWorkspacePickerEntries,
  buildLocalWorkspaceRecord,
  buildRemoteWorkspacePickerEntries,
  buildRemoteWorkspacePickerRoots,
  chooseLocalWorkspacePickerStartPath,
  clampLocalPathToWorkspace,
  createWorkspacePickerState,
  getDefaultLocalBrowsePath,
  isLocalWorkspacePickerRootVisible,
  mergeLocalWorkspaces,
  normalizeComparablePath,
  patchWorkspacePickerState,
  resolveLinkedLocalPath,
  resolveLinkedRemotePath
} from './workspacePaths'
import type {
  BootstrapPayload,
  LocalWorkspace,
  PaneState,
  WorkspacePickerState,
  WorkspaceTarget
} from '../types'

type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void
type PaneMutator = (paneId: string, updater: (pane: PaneState) => PaneState) => void

interface WorkspaceActionsParams {
  bootstrap: BootstrapPayload | null
  panesRef: MutableRefObject<PaneState[]>
  localWorkspacesRef: MutableRefObject<LocalWorkspace[]>
  lastLocalBrowsePathRef: MutableRefObject<string | null>
  workspaceRefreshTimersRef: MutableRefObject<Record<string, number>>
  workspacePicker: WorkspacePickerState | null
  setPanes: Dispatch<SetStateAction<PaneState[]>>
  setLocalWorkspaces: Dispatch<SetStateAction<LocalWorkspace[]>>
  setWorkspacePicker: Dispatch<SetStateAction<WorkspacePickerState | null>>
  updatePane: PaneUpdater
  mutatePane: PaneMutator
  appendPaneSystemMessage: (paneId: string, text: string) => void
}

export function createWorkspaceActions(params: WorkspaceActionsParams) {
  const rememberLastLocalBrowsePath = (targetPath: string) => {
    const normalizedPath = targetPath.trim()
    if (!normalizedPath) {
      return
    }

    params.lastLocalBrowsePathRef.current = normalizedPath
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEYS.lastLocalBrowsePath, JSON.stringify(normalizedPath))
    }
  }

  const handleBrowseLocal = async (paneId: string, targetPath: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const workspaceRoot = pane.localWorkspacePath.trim()
    const nextPath = workspaceRoot ? clampLocalPathToWorkspace(targetPath, workspaceRoot) : targetPath.trim()
    if (!nextPath) {
      return
    }

    params.updatePane(paneId, {
      localBrowserLoading: true
    })

    try {
      const payload = await browseLocalDirectory(nextPath)
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        localBrowserLoading: false,
        localBrowserPath: payload.path,
        localBrowserEntries: payload.entries,
        lastError: null
      }))
    } catch (error) {
      params.updatePane(paneId, {
        localBrowserLoading: false,
        status: 'error',
        statusText: 'ワークスペースの内容の読み込みに失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleSelectLocalWorkspace = async (paneId: string, workspacePath: string) => {
    const selectedPath = workspacePath.trim()
    if (!selectedPath) {
      return
    }

    params.updatePane(paneId, {
      workspaceMode: 'local',
      localWorkspacePath: selectedPath,
      localBrowserPath: '',
      localBrowserEntries: [],
      localBrowserLoading: true
    })

    try {
      const payload = await browseLocalDirectory(selectedPath)
      const nextWorkspacePath = payload.path.trim() || selectedPath
      rememberLastLocalBrowsePath(nextWorkspacePath)
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        workspaceMode: 'local',
        localWorkspacePath: nextWorkspacePath,
        localBrowserPath: nextWorkspacePath,
        localBrowserEntries: payload.entries,
        localShellPath: nextWorkspacePath,
        localBrowserLoading: false,
        lastError: null
      }))
    } catch (error) {
      params.updatePane(paneId, {
        localBrowserLoading: false,
        status: 'error',
        statusText: 'フォルダ内容の読み込みに失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleBrowseRemote = async (paneId: string, nextPath?: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH ホストを入力してください',
        lastError: 'SSH ホストが未設定です。'
      })
      return
    }

    params.updatePane(paneId, {
      remoteBrowserLoading: true
    })

    try {
      const browsePayload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        nextPath || pane.remoteBrowserPath || pane.remoteHomeDirectory || undefined,
        buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
      )
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        remoteBrowserLoading: false,
        remoteHomeDirectory: browsePayload.homeDirectory,
        remoteBrowserPath: browsePayload.path,
        remoteParentPath: browsePayload.parentPath,
        remoteBrowserEntries: browsePayload.entries,
        sshRemotePath: currentPane.sshRemotePath || browsePayload.path,
        lastError: null
      }))
    } catch (error) {
      params.updatePane(paneId, {
        remoteBrowserLoading: false,
        status: 'error',
        statusText: 'SSH 一覧の取得に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const scheduleWorkspaceContentsRefresh = (paneId: string, delay = 240) => {
    const existingTimer = params.workspaceRefreshTimersRef.current[paneId]
    if (existingTimer) {
      window.clearTimeout(existingTimer)
    }

    params.workspaceRefreshTimersRef.current[paneId] = window.setTimeout(() => {
      delete params.workspaceRefreshTimersRef.current[paneId]

      const pane = params.panesRef.current.find((item) => item.id === paneId)
      if (!pane) {
        return
      }

      if (pane.workspaceMode === 'local') {
        const targetPath = pane.localBrowserPath.trim() || pane.localWorkspacePath.trim()
        if (targetPath) {
          void handleBrowseLocal(paneId, targetPath)
        }
        return
      }

      const targetPath = pane.remoteBrowserPath.trim() || pane.remoteWorkspacePath.trim()
      if (pane.sshHost.trim() && targetPath) {
        void handleBrowseRemote(paneId, targetPath)
      }
    }, delay)
  }

  const handleRefreshWorkspaceContents = (paneId: string) => {
    scheduleWorkspaceContentsRefresh(paneId, 0)
  }

  const handleBrowseWorkspacePicker = async (targetPath: string) => {
    const normalizedTargetPath = targetPath.trim()
    if (!params.workspacePicker || !normalizedTargetPath) {
      return
    }

    params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
      loading: true,
      error: null
    }))

    try {
      if (params.workspacePicker.mode === 'local') {
        const payload = await browseLocalDirectory(normalizedTargetPath)
        rememberLastLocalBrowsePath(payload.path)
        params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
          path: payload.path,
          entries: buildLocalWorkspacePickerEntries(payload.entries),
          loading: false,
          error: null
        }))
      } else {
        const pane = params.panesRef.current.find((item) => item.id === params.workspacePicker?.paneId)
        if (!pane || !pane.sshHost.trim()) {
          throw new Error('SSH 接続先が未設定です。')
        }

        const payload = await browseRemoteDirectory(
          pane.sshHost.trim(),
          normalizedTargetPath,
          buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
        )

        params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
          path: payload.path,
          entries: buildRemoteWorkspacePickerEntries(payload.entries),
          roots: buildRemoteWorkspacePickerRoots(params.bootstrap?.remoteRoots ?? [], payload.homeDirectory),
          loading: false,
          error: null
        }))
      }
    } catch (error) {
      params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const handleOpenWorkspacePicker = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)

    params.setWorkspacePicker(createWorkspacePickerState({
      mode: 'local',
      paneId,
      loading: true,
      error: null
    }))

    try {
      const rootsPayload = await fetchLocalBrowseRoots()
      const visibleRoots = rootsPayload.roots.filter(isLocalWorkspacePickerRootVisible)
      const defaultPath = getDefaultLocalBrowsePath(rootsPayload.roots, params.bootstrap?.hostPlatform)
      const requestedStartPath = chooseLocalWorkspacePickerStartPath({
        pane,
        workspaces: params.localWorkspacesRef.current,
        roots: rootsPayload.roots,
        lastLocalBrowsePath: params.lastLocalBrowsePathRef.current,
        hostPlatform: params.bootstrap?.hostPlatform
      })
      const startPath = requestedStartPath || defaultPath
      let directoryPayload: Awaited<ReturnType<typeof browseLocalDirectory>>
      try {
        directoryPayload = await browseLocalDirectory(startPath)
      } catch (error) {
        if (!defaultPath || normalizeComparablePath(defaultPath).toLowerCase() === normalizeComparablePath(startPath).toLowerCase()) {
          throw error
        }
        directoryPayload = await browseLocalDirectory(defaultPath)
      }

      params.setWorkspacePicker(createWorkspacePickerState({
        mode: 'local',
        paneId,
        path: directoryPayload.path,
        entries: buildLocalWorkspacePickerEntries(directoryPayload.entries),
        roots: visibleRoots,
        loading: false,
        error: null
      }))
      rememberLastLocalBrowsePath(directoryPayload.path)
    } catch (error) {
      params.setWorkspacePicker(createWorkspacePickerState({
        mode: 'local',
        paneId,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const handleOpenRemoteWorkspacePicker = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '先にリモートに接続してください',
        lastError: 'リモートワークスペースを選択する前に SSH 接続が必要です。'
      })
      return
    }

    const startPath = pane.remoteWorkspacePath || pane.remoteBrowserPath || pane.remoteHomeDirectory || '~'
    const roots = buildRemoteWorkspacePickerRoots(params.bootstrap?.remoteRoots ?? [], pane.remoteHomeDirectory)

    params.setWorkspacePicker(createWorkspacePickerState({
      mode: 'ssh',
      paneId,
      path: startPath,
      roots,
      loading: true,
      error: null
    }))

    try {
      const payload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        startPath,
        buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
      )

      params.setWorkspacePicker(createWorkspacePickerState({
        mode: 'ssh',
        paneId,
        path: payload.path,
        entries: buildRemoteWorkspacePickerEntries(payload.entries),
        roots: buildRemoteWorkspacePickerRoots(params.bootstrap?.remoteRoots ?? [], payload.homeDirectory),
        loading: false,
        error: null
      }))
    } catch (error) {
      params.setWorkspacePicker(createWorkspacePickerState({
        mode: 'ssh',
        paneId,
        path: startPath,
        roots,
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const handleConfirmWorkspacePicker = async () => {
    if (!params.workspacePicker?.path) {
      return
    }

    if (params.workspacePicker.mode === 'local') {
      const workspace = buildLocalWorkspaceRecord(params.workspacePicker.path)
      params.setLocalWorkspaces((current) => mergeLocalWorkspaces([workspace], current))
      await handleSelectLocalWorkspace(params.workspacePicker.paneId, workspace.path)
    } else {
      const selectedPath = params.workspacePicker.path
      params.updatePane(params.workspacePicker.paneId, {
        workspaceMode: 'ssh',
        remoteWorkspacePath: selectedPath,
        sshRemotePath: selectedPath,
        remoteShellPath: selectedPath,
        status: 'idle',
        statusText: 'リモートワークスペースを選択しました',
        lastError: null
      })
      void handleBrowseRemote(params.workspacePicker.paneId, selectedPath)
    }

    params.setWorkspacePicker(null)
  }

  const handleAddLocalWorkspace = async (paneId: string) => {
    await handleOpenWorkspacePicker(paneId)
  }

  const handleCreateWorkspacePickerDirectory = async () => {
    if (!params.workspacePicker?.path || params.workspacePicker.loading) {
      return
    }

    const folderName = window.prompt('作成するフォルダ名', '')
    if (folderName === null) {
      return
    }

    const trimmedName = folderName.trim()
    if (!trimmedName) {
      params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
        error: '新しいフォルダ名を入力してください。'
      }))
      return
    }

    const parentPath = params.workspacePicker.path
    params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
      loading: true,
      error: null
    }))

    try {
      if (params.workspacePicker.mode === 'local') {
        const payload = await createLocalDirectory(parentPath, trimmedName)
        const directoryPayload = await browseLocalDirectory(payload.path)
        params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
          path: directoryPayload.path,
          entries: buildLocalWorkspacePickerEntries(directoryPayload.entries),
          loading: false,
          error: null
        }))
      } else {
        const pane = params.panesRef.current.find((item) => item.id === params.workspacePicker?.paneId)
        if (!pane || !pane.sshHost.trim()) {
          throw new Error('SSH 接続先が未設定です。')
        }

        const payload = await createRemoteDirectory(
          pane.sshHost.trim(),
          parentPath,
          trimmedName,
          buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
        )
        const directoryPayload = await browseRemoteDirectory(
          pane.sshHost.trim(),
          payload.path,
          buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
        )

        params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
          path: directoryPayload.path,
          entries: buildRemoteWorkspacePickerEntries(directoryPayload.entries),
          roots: buildRemoteWorkspacePickerRoots(params.bootstrap?.remoteRoots ?? [], directoryPayload.homeDirectory),
          loading: false,
          error: null
        }))
      }
    } catch (error) {
      params.setWorkspacePicker((current) => patchWorkspacePickerState(current, {
        loading: false,
        error: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  const handleOpenWorkspace = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const target = buildTargetFromPane(pane, params.localWorkspacesRef.current, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
    if (!target) {
      return
    }

    try {
      await openWorkspaceInVsCode(target)
      const completedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => applyBackgroundActionSuccess(currentPane, 'VSCode を起動しました', completedAt))
    } catch (error) {
      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      params.mutatePane(paneId, (currentPane) => applyBackgroundActionFailure(currentPane, 'VSCode の起動に失敗しました', message, failedAt))
    }
  }

  const handleOpenFileManager = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || pane.workspaceMode !== 'local') {
      return
    }

    const targetPath = pane.localBrowserPath.trim() || pane.localWorkspacePath.trim()
    if (!targetPath) {
      return
    }

    try {
      await openTargetInFileManager({
        kind: 'local',
        path: targetPath,
        label: targetPath,
        resourceType: 'folder'
      })
      const completedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => applyBackgroundActionSuccess(currentPane, 'Explorer を起動しました', completedAt))
    } catch (error) {
      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      params.mutatePane(paneId, (currentPane) => applyBackgroundActionFailure(currentPane, 'Explorer の起動に失敗しました', message, failedAt))
    }
  }

  const handleOpenCommandPrompt = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const target = buildTargetFromPane(pane, params.localWorkspacesRef.current, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
    if (!target) {
      return
    }

    try {
      await openTargetInCommandPrompt(target)
      const completedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => applyBackgroundActionSuccess(currentPane, 'ターミナルを起動しました', completedAt))
    } catch (error) {
      const failedAt = Date.now()
      const message = error instanceof Error ? error.message : String(error)
      params.mutatePane(paneId, (currentPane) => applyBackgroundActionFailure(currentPane, 'ターミナルの起動に失敗しました', message, failedAt))
    }
  }

  const handleOpenPathInVsCode = async (paneId: string, path: string, resourceType: 'folder' | 'file') => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !path.trim()) {
      return
    }

    const resolvedPath =
      pane.workspaceMode === 'local'
        ? resolveLinkedLocalPath(path, pane.localWorkspacePath.trim())
        : resolveLinkedRemotePath(path, pane.remoteWorkspacePath.trim())

    if (!resolvedPath) {
      return
    }

    const target: WorkspaceTarget =
      pane.workspaceMode === 'local'
        ? {
            kind: 'local',
            path: resolvedPath,
            label: resolvedPath,
            resourceType,
            workspacePath: pane.localWorkspacePath.trim()
          }
        : {
            kind: 'ssh',
            host: pane.sshHost.trim(),
            path: resolvedPath,
            label: buildSshLabel(pane.sshHost.trim(), resolvedPath, buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)),
            resourceType,
            workspacePath: pane.remoteWorkspacePath.trim(),
            connection: buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
          }

    try {
      await openWorkspaceInVsCode(target)
    } catch (error) {
      params.updatePane(paneId, {
        status: 'error',
        statusText: 'VSCode の起動に失敗しました',
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleLoadRemote = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH ホストを入力してください',
        lastError: 'SSH ホストが未設定です。'
      })
      return
    }

    const host = pane.sshHost.trim()
    const connection = buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
    const requestedBrowsePath = pane.remoteBrowserPath || pane.remoteWorkspacePath || undefined
    const startedAt = Date.now()
    params.updatePane(paneId, {
      status: 'running',
      statusText: 'SSH 接続を確認中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      remoteBrowserLoading: true,
      sshActionState: 'running',
      sshActionMessage: `${host} に接続しています...`
    })

    try {
      let browsePayload: Awaited<ReturnType<typeof browseRemoteDirectory>> | null = null
      let browseFallbackWarning: string | null = null

      try {
        browsePayload = await browseRemoteDirectory(host, requestedBrowsePath, connection)
      } catch (error) {
        if (!requestedBrowsePath) {
          throw error
        }

        try {
          browsePayload = await browseRemoteDirectory(host, undefined, connection)
          browseFallbackWarning = `指定したリモートパスを開けなかったため、ホームディレクトリを表示しています: ${requestedBrowsePath}`
        } catch {
          throw error
        }
      }

      if (!browsePayload) {
        throw new Error('remote browse failed')
      }

      const browseCompletedAt = Date.now()
      params.setPanes((current) =>
        current.map((item) => {
          if (item.id !== paneId) {
            return item
          }

          const nextRemoteWorkspacePath = browseFallbackWarning ? '' : item.remoteWorkspacePath.trim()
          const nextDiagnostics = browseFallbackWarning
            ? Array.from(new Set([...item.sshDiagnostics, browseFallbackWarning]))
            : item.sshDiagnostics

          return {
            ...item,
            remoteBrowserLoading: false,
            remoteBrowserPath: browsePayload.path,
            remoteParentPath: browsePayload.parentPath,
            remoteBrowserEntries: browsePayload.entries,
            remoteHomeDirectory: browsePayload.homeDirectory ?? item.remoteHomeDirectory,
            remoteWorkspacePath: nextRemoteWorkspacePath,
            sshRemotePath: item.sshRemotePath || nextRemoteWorkspacePath || browsePayload.path,
            remoteShellPath: item.remoteShellPath || nextRemoteWorkspacePath || browsePayload.path,
            sshDiagnostics: nextDiagnostics,
            status: browseFallbackWarning ? 'attention' : 'idle',
            statusText: browseFallbackWarning ? 'SSH に接続しましたがホームを表示しています' : 'SSH に接続しました',
            runningSince: null,
            lastActivityAt: browseCompletedAt,
            lastFinishedAt: browseCompletedAt,
            lastError: browseFallbackWarning,
            sshActionState: 'success',
            sshActionMessage: `${host} に接続しました`
          }
        })
      )

      const [workspaceResult, inspectionResult] = await Promise.allSettled([
        fetchRemoteWorkspaces(host, connection),
        inspectSshHost(host, connection)
      ])

      const workspacePayload = workspaceResult.status === 'fulfilled' ? workspaceResult.value : null
      const inspectionPayload = inspectionResult.status === 'fulfilled' ? inspectionResult.value : null
      const failedPartLabels = [
        workspaceResult.status === 'rejected' ? 'ワークスペース一覧' : null,
        inspectionResult.status === 'rejected' ? '接続診断 / CLI確認' : null
      ].filter((item): item is string => Boolean(item))
      const partialErrors = [
        workspaceResult.status === 'rejected'
          ? `ワークスペース一覧の取得に失敗しました: ${workspaceResult.reason instanceof Error ? workspaceResult.reason.message : String(workspaceResult.reason)}`
          : null,
        inspectionResult.status === 'rejected'
          ? `接続診断 / CLI確認の取得に失敗しました: ${inspectionResult.reason instanceof Error ? inspectionResult.reason.message : String(inspectionResult.reason)}`
          : null,
        browseFallbackWarning
      ].filter((item): item is string => Boolean(item))

      params.setPanes((current) =>
        current.map((item) => {
          if (item.id !== paneId) {
            return item
          }

          const nextProvider =
            inspectionPayload && inspectionPayload.availableProviders.length > 0 && !inspectionPayload.availableProviders.includes(item.provider)
              ? inspectionPayload.availableProviders[0]
              : item.provider
          const nextSettings =
            nextProvider !== item.provider && params.bootstrap
              ? item.providerSettings[nextProvider] ?? createProviderSettingsFromCatalog(params.bootstrap.providers, nextProvider)
              : getCurrentProviderSettings(item)
          const updatedAt = Date.now()
          const nextLocalKeys = mergeLocalSshKeys(inspectionPayload?.localKeys ?? [], item.sshLocalKeys)
          const selectedKey = getPreferredLocalSshKey({ ...item, sshLocalKeys: nextLocalKeys }, nextLocalKeys, current)
          const availableProviders = inspectionPayload?.availableProviders ?? item.remoteAvailableProviders
          const currentRemoteWorkspacePath = item.remoteWorkspacePath.trim()
          const nextRemoteWorkspacePath = browseFallbackWarning ? '' : currentRemoteWorkspacePath
          const mergedDiagnostics = Array.from(new Set([
            ...(inspectionPayload?.diagnostics ?? item.sshDiagnostics),
            ...partialErrors
          ]))
          const hasPartialFailure = partialErrors.length > 0
          const noRemoteProviderDetected = Boolean(inspectionPayload && inspectionPayload.availableProviders.length === 0)

          return syncCurrentProviderSettings({
            ...item,
            provider: nextProvider,
            model: nextSettings.model,
            reasoningEffort: nextSettings.reasoningEffort,
            autonomyMode: nextSettings.autonomyMode,
            codexFastMode: nextProvider === 'codex' ? nextSettings.codexFastMode : 'off',
            sessionId: nextProvider === item.provider ? item.sessionId : null,
            sessionScopeKey: nextProvider === item.provider ? item.sessionScopeKey : null,
            sshUser: item.sshUser || inspectionPayload?.suggestedUser || '',
            sshPort: item.sshPort || inspectionPayload?.suggestedPort || '',
            sshIdentityFile: selectedKey?.privateKeyPath || item.sshIdentityFile || inspectionPayload?.suggestedIdentityFile || '',
            sshProxyJump: item.sshProxyJump || inspectionPayload?.suggestedProxyJump || '',
            sshProxyCommand: item.sshProxyCommand || inspectionPayload?.suggestedProxyCommand || '',
            sshLocalKeys: nextLocalKeys,
            sshSelectedKeyPath: selectedKey?.privateKeyPath ?? '',
            sshPublicKeyText: selectedKey?.publicKey ?? item.sshPublicKeyText,
            sshKeyName: selectedKey?.name ?? item.sshKeyName,
            sshKeyComment: selectedKey?.comment ?? item.sshKeyComment,
            sshDiagnostics: mergedDiagnostics,
            sshLocalPath: item.sshLocalPath || params.localWorkspacesRef.current[0]?.path || '',
            sshRemotePath: item.sshRemotePath || nextRemoteWorkspacePath || browsePayload.path,
            remoteShellPath: item.remoteShellPath || nextRemoteWorkspacePath || browsePayload.path,
            remoteWorkspaces: workspacePayload?.workspaces ?? item.remoteWorkspaces,
            remoteAvailableProviders: availableProviders,
            remoteHomeDirectory: inspectionPayload?.homeDirectory ?? browsePayload.homeDirectory ?? item.remoteHomeDirectory,
            remoteBrowserLoading: false,
            remoteBrowserPath: browsePayload.path,
            remoteParentPath: browsePayload.parentPath,
            remoteBrowserEntries: browsePayload.entries,
            remoteWorkspacePath: nextRemoteWorkspacePath,
            status: hasPartialFailure || noRemoteProviderDetected ? 'attention' : 'idle',
            statusText: hasPartialFailure ? `SSH に接続しましたが ${failedPartLabels.join(' / ')} の取得に失敗しました` : noRemoteProviderDetected ? 'SSH 接続済み / CLI 未検出' : 'SSH を更新しました',
            runningSince: null,
            lastActivityAt: updatedAt,
            lastFinishedAt: updatedAt,
            lastError: hasPartialFailure ? partialErrors.join('\n') : null,
            sshActionState: hasPartialFailure ? 'error' : 'success',
            sshActionMessage: hasPartialFailure ? `${host} への接続は成功しましたが、${failedPartLabels.join(' / ')} の取得に失敗しました` : noRemoteProviderDetected ? `${host} に接続しました。CLI を確認してください` : `${host} の接続情報を更新しました`
          })
        })
      )
    } catch (error) {
      const failedAt = Date.now()
      params.updatePane(paneId, {
        status: 'error',
        statusText: 'SSH 接続に失敗しました',
        runningSince: null,
        remoteBrowserLoading: false,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: error instanceof Error ? error.message : String(error),
        sshActionState: 'error',
        sshActionMessage: `SSH 接続に失敗しました: ${error instanceof Error ? error.message : String(error)}`
      })
    }
  }

  const handleCreateRemoteDirectory = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim() || !pane.remoteBrowserPath.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '作成先を選択してください',
        lastError: 'リモート一覧を表示してから作成してください。'
      })
      return
    }

    const folderName = window.prompt('作成するフォルダ名', '')
    if (folderName === null) {
      return
    }

    const trimmedName = folderName.trim()
    if (!trimmedName) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'フォルダ名を入力してください',
        lastError: '新規フォルダ名が空です。'
      })
      return
    }

    const startedAt = Date.now()
    params.updatePane(paneId, {
      remoteBrowserLoading: true,
      status: 'running',
      statusText: 'フォルダを作成中',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null
    })

    try {
      const payload = await createRemoteDirectory(
        pane.sshHost.trim(),
        pane.remoteBrowserPath.trim(),
        trimmedName,
        buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
      )
      const browsePayload = await browseRemoteDirectory(
        pane.sshHost.trim(),
        pane.remoteBrowserPath.trim(),
        buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
      )
      const finishedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        remoteBrowserLoading: false,
        remoteBrowserPath: browsePayload.path,
        remoteParentPath: browsePayload.parentPath,
        remoteBrowserEntries: browsePayload.entries,
        sshRemotePath: payload.path,
        status: 'completed',
        statusText: 'フォルダを作成しました',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', `フォルダ作成: ${payload.path}`, finishedAt)
      }))
    } catch (error) {
      params.updatePane(paneId, {
        remoteBrowserLoading: false,
        status: 'error',
        statusText: 'フォルダ作成に失敗しました',
        runningSince: null,
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  const handleGenerateSshKey = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    const keyName = pane.sshKeyName.trim() || 'id_ed25519'
    const keyComment = pane.sshKeyComment.trim() || 'tako-cli-dev-tool'
    const startedAt = Date.now()
    params.updatePane(paneId, {
      status: 'running',
      statusText: 'SSH 鍵を生成中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: 'SSH 鍵を生成中です...'
    })

    try {
      const result = await generateSshKey(keyName, keyComment, '')
      const finishedAt = Date.now()
      params.mutatePane(paneId, (paneState) => ({
        ...paneState,
        sshLocalKeys: [result.key, ...paneState.sshLocalKeys.filter((item) => item.privateKeyPath !== result.key.privateKeyPath)],
        sshSelectedKeyPath: result.key.privateKeyPath,
        sshIdentityFile: result.key.privateKeyPath,
        sshPublicKeyText: result.key.publicKey,
        sshKeyName: result.key.name,
        sshKeyComment: result.key.comment,
        sshDiagnostics: [
          ...paneState.sshDiagnostics.filter((item) => !item.startsWith('ローカル鍵:') && !item.startsWith('ローカルの ~/.ssh に利用可能な鍵がありません')),
          `ローカル鍵: ${result.key.privateKeyPath}`
        ],
        sshActionState: 'success',
        sshActionMessage: result.created ? `SSH 鍵を生成しました: ${result.key.privateKeyPath}` : `既存の SSH 鍵を選択しました: ${result.key.privateKeyPath}`,
        status: 'completed',
        statusText: result.created ? 'SSH 鍵を生成しました' : '既存の SSH 鍵を選択しました',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        streamEntries: appendStreamEntry(paneState.streamEntries, 'system', result.created ? `SSH 鍵を生成しました: ${result.key.privateKeyPath}` : `既存の SSH 鍵を選択しました: ${result.key.privateKeyPath}`, finishedAt)
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      params.updatePane(paneId, {
        status: 'error',
        statusText: 'SSH 鍵の生成に失敗しました',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `SSH 鍵の生成に失敗しました: ${message}`
      })
    }
  }

  const handleDeleteSshKey = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    const selectedKey = pane?.sshLocalKeys.find((item) => item.privateKeyPath === pane.sshSelectedKeyPath) ?? null
    if (!pane || !selectedKey) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '削除する SSH 鍵を選択してください',
        lastError: '選択中のローカル SSH 鍵がありません。',
        sshActionState: 'error',
        sshActionMessage: '削除する SSH 鍵を選択してください。'
      })
      return
    }

    if (!window.confirm(`次の SSH 鍵を削除しますか？\n${selectedKey.privateKeyPath}`)) {
      return
    }

    const startedAt = Date.now()
    params.updatePane(paneId, {
      status: 'running',
      statusText: 'SSH 鍵を削除中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: `SSH 鍵を削除しています: ${selectedKey.privateKeyPath}`
    })

    try {
      const result = await deleteSshKey(selectedKey.privateKeyPath)
      const finishedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => {
        const nextSelectedKey = result.remainingKeys.find((item) => item.privateKeyPath === currentPane.sshSelectedKeyPath) ?? result.remainingKeys[0] ?? null
        const nextIdentityFile = currentPane.sshIdentityFile === selectedKey.privateKeyPath
          ? nextSelectedKey?.privateKeyPath ?? ''
          : currentPane.sshIdentityFile
        const nextDiagnostics = [
          ...currentPane.sshDiagnostics.filter((item) => !item.startsWith('ローカル鍵:') && !item.startsWith('ローカルの ~/.ssh に利用可能な鍵がありません')),
          ...(nextSelectedKey ? [`ローカル鍵: ${nextSelectedKey.privateKeyPath}`] : ['ローカルの ~/.ssh に利用可能な鍵がありません。必要ならここから生成してください。'])
        ]

        return {
          ...currentPane,
          sshLocalKeys: result.remainingKeys,
          sshSelectedKeyPath: nextSelectedKey?.privateKeyPath ?? '',
          sshIdentityFile: nextIdentityFile,
          sshPublicKeyText: nextSelectedKey?.publicKey ?? '',
          sshKeyName: nextSelectedKey?.name ?? 'id_ed25519',
          sshKeyComment: nextSelectedKey?.comment ?? 'tako-cli-dev-tool',
          sshDiagnostics: nextDiagnostics,
          sshActionState: 'success',
          sshActionMessage: result.deleted ? `SSH 鍵を削除しました: ${selectedKey.privateKeyPath}` : `SSH 鍵は既に削除されていました: ${selectedKey.privateKeyPath}`,
          status: 'completed',
          statusText: result.deleted ? 'SSH 鍵を削除しました' : 'SSH 鍵は既に削除済みでした',
          runningSince: null,
          lastActivityAt: finishedAt,
          lastFinishedAt: finishedAt,
          lastError: null,
          streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', result.deleted ? `SSH 鍵を削除しました: ${selectedKey.privateKeyPath}` : `SSH 鍵は既に削除済みでした: ${selectedKey.privateKeyPath}`, finishedAt)
        }
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      params.updatePane(paneId, {
        status: 'error',
        statusText: 'SSH 鍵の削除に失敗しました',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `SSH 鍵の削除に失敗しました: ${message}`
      })
    }
  }

  const handleRemoveKnownHost = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH ホストを入力してください',
        lastError: '削除する接続先ホスト鍵の対象が未設定です。',
        sshActionState: 'error',
        sshActionMessage: '接続先のホスト鍵を削除する対象を入力してください。'
      })
      return
    }

    const host = pane.sshHost.trim()
    const startedAt = Date.now()
    params.updatePane(paneId, {
      status: 'running',
      statusText: '接続先のホスト鍵を削除しています',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: `${host} の接続先ホスト鍵を削除しています...`
    })

    try {
      const result = await removeKnownHost(host, buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current))
      const finishedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        sshDiagnostics: [
          `接続先のホスト鍵を削除しました: ${result.removedHosts.length > 0 ? result.removedHosts.join(', ') : host}`,
          ...currentPane.sshDiagnostics.filter((item) => !item.startsWith('接続先のホスト鍵を削除しました:'))
        ],
        sshActionState: 'success',
        sshActionMessage: result.removedHosts.length > 0 ? `${host} の接続先ホスト鍵を削除しました` : `${host} のホスト鍵は見つかりませんでした`,
        status: 'completed',
        statusText: result.removedHosts.length > 0 ? '接続先のホスト鍵を削除しました' : '削除対象のホスト鍵はありませんでした',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', result.removedHosts.length > 0 ? `接続先のホスト鍵を削除しました: ${result.removedHosts.join(', ')}` : `削除対象のホスト鍵はありませんでした: ${host}`, finishedAt)
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      params.updatePane(paneId, {
        status: 'error',
        statusText: '接続先のホスト鍵の削除に失敗しました',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `接続先のホスト鍵の削除に失敗しました: ${message}`
      })
    }
  }

  const handleInstallSshPublicKey = async (paneId: string) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim() || !pane.sshPublicKeyText.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '接続先と公開鍵を確認してください',
        lastError: 'SSH 公開鍵の登録に必要な情報が不足しています。',
        sshActionState: 'error',
        sshActionMessage: '接続先と公開鍵を確認してください。',
        sshPasswordPulseAt: 0
      })
      return
    }

    if (!pane.sshPassword.trim()) {
      const pulseAt = Date.now()
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'パスワードを入力してください',
        lastError: '公開鍵を接続先に登録する場合はパスワードを設定してください。',
        sshActionState: 'error',
        sshActionMessage: '公開鍵を接続先に登録する場合はパスワードを設定してください',
        sshPasswordPulseAt: pulseAt
      })
      return
    }

    const startedAt = Date.now()
    params.updatePane(paneId, {
      status: 'running',
      statusText: '公開鍵を接続先に登録中です',
      runningSince: startedAt,
      lastActivityAt: startedAt,
      lastError: null,
      sshActionState: 'running',
      sshActionMessage: `公開鍵を ${pane.sshHost.trim()} の接続先へ登録中です...`,
      sshPasswordPulseAt: 0
    })

    try {
      await installSshKey(pane.sshHost.trim(), pane.sshPublicKeyText.trim(), buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current))
      const finishedAt = Date.now()
      params.mutatePane(paneId, (currentPane) => ({
        ...currentPane,
        sshDiagnostics: [`公開鍵を接続先へ登録しました: ${pane.sshHost.trim()}`, ...currentPane.sshDiagnostics.filter((item) => !item.startsWith('公開鍵を接続先へ登録しました:'))],
        sshActionState: 'success',
        sshActionMessage: `公開鍵を ${pane.sshHost.trim()} の接続先へ登録しました`,
        status: 'completed',
        statusText: '公開鍵を接続先に登録しました',
        runningSince: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt,
        lastError: null,
        sshPasswordPulseAt: 0,
        streamEntries: appendStreamEntry(currentPane.streamEntries, 'system', `公開鍵を接続先へ登録しました: ${pane.sshHost.trim()}`, finishedAt)
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failedAt = Date.now()
      params.updatePane(paneId, {
        status: 'error',
        statusText: '公開鍵の登録に失敗しました',
        runningSince: null,
        lastActivityAt: failedAt,
        lastFinishedAt: failedAt,
        lastError: message,
        sshActionState: 'error',
        sshActionMessage: `公開鍵の登録に失敗しました: ${message}`,
        sshPasswordPulseAt: 0
      })
    }
  }

  const handleTransferSshPath = async (
    paneId: string,
    direction: 'upload' | 'download',
    options?: { localPath?: string; remotePath?: string; remoteLabel?: string; isDirectory?: boolean }
  ) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane || !pane.sshHost.trim()) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'SSH 接続先を確認してください',
        lastError: '転送先の SSH 接続が未設定です。'
      })
      return
    }

    let localPath = options?.localPath?.trim() || pane.sshLocalPath.trim()
    let remotePath = options?.remotePath?.trim() || pane.sshRemotePath.trim()

    if (direction === 'download' && remotePath && !localPath) {
      if (options?.isDirectory) {
        const picked = await pickLocalWorkspace()
        localPath = picked.paths[0] ?? ''
      } else {
        const fallbackName = options?.remoteLabel?.trim() || remotePath.split('/').filter(Boolean).pop() || 'download.txt'
        const picked = await pickSaveFilePath(fallbackName)
        localPath = picked.path ?? ''
      }
    }

    if (!localPath || !remotePath) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: direction === 'upload' ? '送信元と送信先を確認してください' : '取得元と保存先を確認してください',
        lastError: '転送に必要な情報が不足しています。'
      })
      return
    }

    params.updatePane(paneId, {
      sshLocalPath: localPath,
      sshRemotePath: remotePath,
      status: 'running',
      statusText: direction === 'upload' ? '送信中' : '受信中',
      lastError: null
    })

    try {
      await transferSshPath(
        direction,
        pane.sshHost.trim(),
        localPath,
        remotePath,
        buildSshConnectionFromPane(pane, params.bootstrap?.sshHosts ?? [], params.panesRef.current)
      )
      params.appendPaneSystemMessage(
        paneId,
        direction === 'upload' ? `送信完了: ${localPath} -> ${remotePath}` : `受信完了: ${remotePath} -> ${localPath}`
      )
      const finishedAt = Date.now()
      params.updatePane(paneId, {
        status: 'completed',
        statusText: direction === 'upload' ? '送信完了' : '受信完了',
        sshLocalPath: localPath,
        sshRemotePath: remotePath,
        lastError: null,
        lastActivityAt: finishedAt,
        lastFinishedAt: finishedAt
      })

      if (direction === 'upload') {
        void handleBrowseRemote(paneId, pane.remoteBrowserPath || pane.remoteWorkspacePath || undefined)
      }
    } catch (error) {
      params.updatePane(paneId, {
        status: 'error',
        statusText: '転送に失敗しました',
        sshLocalPath: localPath,
        sshRemotePath: remotePath,
        lastError: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return {
    handleBrowseLocal,
    handleSelectLocalWorkspace,
    handleBrowseRemote,
    scheduleWorkspaceContentsRefresh,
    handleRefreshWorkspaceContents,
    handleBrowseWorkspacePicker,
    handleOpenWorkspacePicker,
    handleOpenRemoteWorkspacePicker,
    handleConfirmWorkspacePicker,
    handleAddLocalWorkspace,
    handleCreateWorkspacePickerDirectory,
    handleOpenWorkspace,
    handleOpenFileManager,
    handleOpenCommandPrompt,
    handleOpenPathInVsCode,
    handleLoadRemote,
    handleCreateRemoteDirectory,
    handleGenerateSshKey,
    handleDeleteSshKey,
    handleRemoveKnownHost,
    handleInstallSshPublicKey,
    handleTransferSshPath
  }
}