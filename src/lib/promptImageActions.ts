import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import { stagePromptImage, unstagePromptImages } from './api'
import { createId, normalizePromptImageFile, readFileAsBase64 } from './appCore'
import type { PaneState, PromptImageAttachment, PromptImageAttachmentSource } from '../types'

type PaneUpdater = (paneId: string, updates: Partial<PaneState>) => void

interface PromptImageActionsParams {
  panesRef: MutableRefObject<PaneState[]>
  paneImageAttachmentsRef: MutableRefObject<Record<string, PromptImageAttachment[]>>
  promptImageCleanupPathsRef: MutableRefObject<Record<string, string[]>>
  setPaneImageAttachments: Dispatch<SetStateAction<Record<string, PromptImageAttachment[]>>>
  updatePane: PaneUpdater
}

export function createPromptImageActions(params: PromptImageActionsParams) {
  const revokePromptImagePreview = (attachment: Pick<PromptImageAttachment, 'previewUrl'>) => {
    if (attachment.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }

  const cleanupPromptImageFiles = (localPaths: string[]) => {
    const normalizedPaths = [...new Set(localPaths.map((entry) => entry.trim()).filter(Boolean))]
    if (normalizedPaths.length === 0) {
      return
    }

    void unstagePromptImages(normalizedPaths).catch(() => undefined)
  }

  const queuePromptImageCleanup = (paneId: string, localPaths: string[]) => {
    const normalizedPaths = [...new Set(localPaths.map((entry) => entry.trim()).filter(Boolean))]
    if (normalizedPaths.length === 0) {
      return
    }

    const existing = params.promptImageCleanupPathsRef.current[paneId] ?? []
    params.promptImageCleanupPathsRef.current[paneId] = [...new Set([...existing, ...normalizedPaths])]
  }

  const flushQueuedPromptImageCleanup = (paneId: string) => {
    const queuedPaths = params.promptImageCleanupPathsRef.current[paneId] ?? []
    if (queuedPaths.length === 0) {
      return
    }

    delete params.promptImageCleanupPathsRef.current[paneId]
    cleanupPromptImageFiles(queuedPaths)
  }

  const updatePanePromptImages = (
    paneId: string,
    updater: (current: PromptImageAttachment[]) => PromptImageAttachment[]
  ) => {
    params.setPaneImageAttachments((current) => {
      const existing = current[paneId] ?? []
      const next = updater(existing)
      if (next.length === 0) {
        if (!(paneId in current)) {
          return current
        }

        const snapshot = { ...current }
        delete snapshot[paneId]
        return snapshot
      }

      return {
        ...current,
        [paneId]: next
      }
    })
  }

  const clearPanePromptImages = (paneId: string, options: { cleanupFiles?: boolean } = {}) => {
    const existing = params.paneImageAttachmentsRef.current[paneId] ?? []
    if (options.cleanupFiles !== false) {
      cleanupPromptImageFiles(existing.flatMap((attachment) => attachment.localPath ? [attachment.localPath] : []))
    }

    params.setPaneImageAttachments((current) => {
      for (const attachment of existing) {
        revokePromptImagePreview(attachment)
      }

      if (!(paneId in current)) {
        return current
      }

      const snapshot = { ...current }
      delete snapshot[paneId]
      return snapshot
    })
  }

  const clearMultiplePanePromptImages = (paneIds: string[], options: { cleanupFiles?: boolean } = {}) => {
    const paneIdSet = new Set(paneIds)
    if (paneIdSet.size === 0) {
      return
    }

    if (options.cleanupFiles !== false) {
      const localPaths = [...paneIdSet].flatMap((paneId) => (params.paneImageAttachmentsRef.current[paneId] ?? []).flatMap((attachment) => attachment.localPath ? [attachment.localPath] : []))
      cleanupPromptImageFiles(localPaths)
    }

    params.setPaneImageAttachments((current) => {
      let changed = false
      const snapshot = { ...current }

      for (const paneId of paneIdSet) {
        const existing = snapshot[paneId] ?? []
        if (existing.length === 0) {
          continue
        }

        changed = true
        for (const attachment of existing) {
          revokePromptImagePreview(attachment)
        }
        delete snapshot[paneId]
      }

      return changed ? snapshot : current
    })
  }

  const cleanupAllPromptImageResources = () => {
    const pendingPaths = Object.values(params.promptImageCleanupPathsRef.current).flat()
    cleanupPromptImageFiles([
      ...pendingPaths,
      ...Object.values(params.paneImageAttachmentsRef.current).flatMap((attachments) => attachments.flatMap((attachment) => attachment.localPath ? [attachment.localPath] : []))
    ])
    for (const attachments of Object.values(params.paneImageAttachmentsRef.current)) {
      for (const attachment of attachments) {
        revokePromptImagePreview(attachment)
      }
    }
  }

  const handleAddPromptImages = async (paneId: string, files: File[], source: PromptImageAttachmentSource) => {
    const pane = params.panesRef.current.find((item) => item.id === paneId)
    if (!pane) {
      return
    }

    if (pane.provider === 'copilot') {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: 'Copilot では画像添付を使えません',
        lastError: 'GitHub Copilot CLI は画像入力未対応です。Codex CLI または Gemini CLI を選択してください。'
      })
      return
    }

    const normalizedFiles = files
      .map((file) => normalizePromptImageFile(file, source))
      .filter((item): item is { file: File; fileName: string; mimeType: string } => Boolean(item))

    if (normalizedFiles.length === 0) {
      params.updatePane(paneId, {
        status: 'attention',
        statusText: '画像ファイルを選択してください',
        lastError: '添付できるのは画像ファイルのみです。'
      })
      return
    }

    const draftAttachments: PromptImageAttachment[] = normalizedFiles.map(({ file, fileName, mimeType }) => ({
      id: createId('prompt-image'),
      fileName,
      mimeType,
      size: file.size,
      localPath: null,
      previewUrl: URL.createObjectURL(file),
      status: 'uploading',
      source,
      error: null
    }))

    updatePanePromptImages(paneId, (current) => [...current, ...draftAttachments])

    await Promise.all(draftAttachments.map(async (attachment, index) => {
      const sourceFile = normalizedFiles[index]
      if (!sourceFile) {
        return
      }

      try {
        const contentBase64 = await readFileAsBase64(sourceFile.file)
        const response = await stagePromptImage({
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          contentBase64
        })

        updatePanePromptImages(paneId, (current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  status: 'ready',
                  localPath: response.attachment.localPath,
                  error: null
                }
              : item
          )
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        updatePanePromptImages(paneId, (current) =>
          current.map((item) =>
            item.id === attachment.id
              ? {
                  ...item,
                  status: 'error',
                  localPath: null,
                  error: message
                }
              : item
          )
        )
        params.updatePane(paneId, {
          status: 'attention',
          statusText: '画像添付を確認してください',
          lastError: `画像を準備できませんでした: ${attachment.fileName}`
        })
      }
    }))
  }

  const handleRemovePromptImage = (paneId: string, attachmentId: string) => {
    const existing = params.paneImageAttachmentsRef.current[paneId] ?? []
    const targetAttachment = existing.find((attachment) => attachment.id === attachmentId)
    if (!targetAttachment) {
      return
    }

    if (targetAttachment.localPath) {
      cleanupPromptImageFiles([targetAttachment.localPath])
    }

    revokePromptImagePreview(targetAttachment)
    updatePanePromptImages(paneId, (current) => current.filter((attachment) => attachment.id !== attachmentId))
  }

  return {
    cleanupAllPromptImageResources,
    clearPanePromptImages,
    clearMultiplePanePromptImages,
    queuePromptImageCleanup,
    flushQueuedPromptImageCleanup,
    handleAddPromptImages,
    handleRemovePromptImage
  }
}