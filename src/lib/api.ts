import type {
  BootstrapPayload,
  LocalBrowseResponse,
  LocalBrowseRootsResponse,
  LocalCreateDirectoryResponse,
  RemoteBrowseResponse,
  RemoteCreateDirectoryResponse,
  RemoteWorkspaceResponse,
  PreviewRunCommandRequest,
  PreviewRunCommandResponse,
  RunPaneRequest,
  RunPaneResponse,
  RunStatusResponse,
  RunStreamEvent,
  ShellRunEvent,
  ShellRunRequest,
  StagePromptImageRequest,
  StagePromptImageResponse,
  SshConnectionOptions,
  UnstagePromptImagesRequest,
  UnstagePromptImagesResponse,
  SshInspectionResponse,
  SshKeyDeleteResponse,
  SshKeyGenerateResponse,
  SshKeyInstallResponse,
  SshKnownHostRemoveResponse,
  SshTransferResponse,
  StopRunResponse,
  WorkspaceTarget
} from '../types'

const HTML_API_ERROR_MESSAGES = [
  {
    path: '/api/shell/stream',
    message: '簡易内蔵ターミナル API が見つかりません。TAKO のサーバーを再起動してください。'
  },
  {
    path: '/api/run/stream',
    message: 'CLI 実行 API が見つかりません。TAKO のサーバーを再起動してください。'
  },
  {
    path: '/api/system/mkdir-local',
    message: '新しいフォルダ作成 API が見つかりません。TAKO のサーバーを再起動してください。'
  },
  {
    path: '/api/system/browse-local',
    message: 'ローカルフォルダ参照 API が見つかりません。TAKO のサーバーを再起動してください。'
  },
  {
    path: '/api/ssh/keygen',
    message: 'SSH 鍵生成 API が見つかりません。TAKO のサーバーを再起動してください。'
  },
  {
    path: '/api/ssh/install-key',
    message: 'SSH 公開鍵登録 API が見つかりません。TAKO のサーバーを再起動してください。'
  },
  {
    path: '/api/system/open-explorer',
    message: 'Explorer 起動 API が見つかりません。TAKO のサーバーを再起動してください。'
  }
] as const

async function extractErrorMessage(response: Response): Promise<string> {
  const text = await response.text()
  const contentType = response.headers.get('content-type') ?? ''

  if (!text) {
    return `Request failed: ${response.status}`
  }

  if (contentType.includes('text/html')) {
    const knownApiError = HTML_API_ERROR_MESSAGES.find(
      (entry) =>
        response.url.includes(entry.path) ||
        text.includes(`Cannot POST ${entry.path}`) ||
        text.includes(`Cannot GET ${entry.path}`)
    )

    if (knownApiError) {
      return knownApiError.message
    }
    return 'TAKO \u30b5\u30fc\u30d0\u30fc\u306e\u5fdc\u7b54\u5f62\u5f0f\u304c\u4e0d\u6b63\u3067\u3059\u3002\u518d\u8d77\u52d5\u3057\u3066\u304f\u3060\u3055\u3044\u3002'
  }

  try {
    const payload = JSON.parse(text) as { details?: string; error?: string }
    if (typeof payload.details === 'string') {
      return payload.details
    }
    if (typeof payload.error === 'string') {
      return payload.error
    }
  } catch {
    // fall through
  }

  return text
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  return (await response.json()) as T
}

export function fetchBootstrap(): Promise<BootstrapPayload> {
  return requestJson<BootstrapPayload>('/api/bootstrap')
}

export function runPane(payload: RunPaneRequest): Promise<RunPaneResponse> {
  return requestJson<RunPaneResponse>('/api/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}

export function fetchPaneRunStatus(paneId: string): Promise<RunStatusResponse> {
  return requestJson<RunStatusResponse>(`/api/run/status/${encodeURIComponent(paneId)}`)
}

export async function runPaneStream(
  payload: RunPaneRequest,
  onEvent: (event: RunStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch('/api/run/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  if (!response.body) {
    throw new Error('Streaming response body is not available.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const event = JSON.parse(trimmed) as RunStreamEvent
    onEvent(event)

    if (event.type === 'error') {
      throw new Error(event.message)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      processLine(line)
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    processLine(buffer)
  }
}

export function previewRunCommand(payload: PreviewRunCommandRequest): Promise<PreviewRunCommandResponse> {
  return requestJson<PreviewRunCommandResponse>('/api/run/preview-command', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}

export function stopPaneRun(paneId: string): Promise<StopRunResponse> {
  return requestJson<StopRunResponse>('/api/run/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ paneId })
  })
}

export function unstagePromptImages(localPaths: string[]): Promise<UnstagePromptImagesResponse> {
  if (localPaths.length === 0) {
    return Promise.resolve({ success: true })
  }

  const payload: UnstagePromptImagesRequest = { localPaths }
  return requestJson<UnstagePromptImagesResponse>('/api/system/unstage-images', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}

export async function runShellStream(
  payload: ShellRunRequest,
  onEvent: (event: ShellRunEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch('/api/shell/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal
  })

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response))
  }

  if (!response.body) {
    throw new Error('Streaming response body is not available.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }

    const event = JSON.parse(trimmed) as ShellRunEvent
    onEvent(event)

    if (event.type === 'error') {
      throw new Error(event.message)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })

    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      processLine(line)
    }

    if (done) {
      break
    }
  }

  if (buffer.trim()) {
    processLine(buffer)
  }
}

export function stopShellRun(paneId: string): Promise<StopRunResponse> {
  return requestJson<StopRunResponse>('/api/shell/stop', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ paneId })
  })
}

export function openWorkspaceInVsCode(target: WorkspaceTarget): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>('/api/system/open-vscode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ target })
  })
}

export function openTargetInCommandPrompt(target: WorkspaceTarget): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>('/api/system/open-cmd', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ target })
  })
}

export function openTargetInFileManager(target: WorkspaceTarget): Promise<{ success: boolean }> {
  return requestJson<{ success: boolean }>('/api/system/open-explorer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ target })
  })
}

export function fetchLocalBrowseRoots(): Promise<LocalBrowseRootsResponse> {
  return requestJson<LocalBrowseRootsResponse>('/api/system/local-roots')
}

export function pickLocalWorkspace(startPath?: string): Promise<{ success: boolean; paths: string[] }> {
  return requestJson<{ success: boolean; paths: string[] }>('/api/system/pick-folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ startPath })
  })
}

export function pickSaveFilePath(defaultName: string): Promise<{ success: boolean; path: string | null }> {
  return requestJson<{ success: boolean; path: string | null }>('/api/system/pick-save-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ defaultName })
  })
}

export function stagePromptImage(payload: StagePromptImageRequest): Promise<StagePromptImageResponse> {
  return requestJson<StagePromptImageResponse>('/api/system/stage-image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
}

export function browseLocalDirectory(path: string): Promise<LocalBrowseResponse> {
  return requestJson<LocalBrowseResponse>('/api/system/browse-local', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ path })
  })
}

export function createLocalDirectory(parentPath: string, directoryName: string): Promise<LocalCreateDirectoryResponse> {
  return requestJson<LocalCreateDirectoryResponse>('/api/system/mkdir-local', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ parentPath, directoryName })
  })
}

export function fetchRemoteWorkspaces(host: string, connection?: SshConnectionOptions): Promise<RemoteWorkspaceResponse> {
  return requestJson<RemoteWorkspaceResponse>('/api/ssh/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, connection })
  })
}

export function inspectSshHost(host: string, connection?: SshConnectionOptions): Promise<SshInspectionResponse> {
  return requestJson<SshInspectionResponse>('/api/ssh/inspect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, connection })
  })
}

export function browseRemoteDirectory(host: string, path?: string, connection?: SshConnectionOptions): Promise<RemoteBrowseResponse> {
  return requestJson<RemoteBrowseResponse>('/api/ssh/browse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, path, connection })
  })
}

export function createRemoteDirectory(
  host: string,
  parentPath: string,
  directoryName: string,
  connection?: SshConnectionOptions
): Promise<RemoteCreateDirectoryResponse> {
  return requestJson<RemoteCreateDirectoryResponse>('/api/ssh/mkdir', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, parentPath, directoryName, connection })
  })
}

export function generateSshKey(keyName: string, comment: string, passphrase = ''): Promise<SshKeyGenerateResponse> {
  return requestJson<SshKeyGenerateResponse>('/api/ssh/keygen', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ keyName, comment, passphrase })
  })
}

export function deleteSshKey(privateKeyPath: string): Promise<SshKeyDeleteResponse> {
  return requestJson<SshKeyDeleteResponse>('/api/ssh/delete-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ privateKeyPath })
  })
}

export function installSshKey(host: string, publicKey: string, connection?: SshConnectionOptions): Promise<SshKeyInstallResponse> {
  return requestJson<SshKeyInstallResponse>('/api/ssh/install-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, publicKey, connection })
  })
}

export function removeKnownHost(host: string, connection?: SshConnectionOptions): Promise<SshKnownHostRemoveResponse> {
  return requestJson<SshKnownHostRemoveResponse>('/api/ssh/remove-known-host', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, connection })
  })
}

export function transferSshPath(
  direction: 'upload' | 'download',
  host: string,
  localPath: string,
  remotePath: string,
  connection?: SshConnectionOptions
): Promise<SshTransferResponse> {
  return requestJson<SshTransferResponse>('/api/ssh/scp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ direction, host, localPath, remotePath, connection })
  })
}

