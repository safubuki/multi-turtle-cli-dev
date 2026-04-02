import type {
  BootstrapPayload,
  LocalBrowseResponse,
  RemoteBrowseResponse,
  RemoteCreateDirectoryResponse,
  RemoteWorkspaceResponse,
  RunPaneRequest,
  RunPaneResponse,
  RunStreamEvent,
  SshConnectionOptions,
  SshInspectionResponse,
  SshKeyGenerateResponse,
  SshKeyInstallResponse,
  SshTransferResponse,
  StopRunResponse,
  WorkspaceTarget
} from '../types'

async function extractErrorMessage(response: Response): Promise<string> {
  const text = await response.text()

  if (!text) {
    return `Request failed: ${response.status}`
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

export function stopPaneRun(paneId: string): Promise<StopRunResponse> {
  return requestJson<StopRunResponse>('/api/run/stop', {
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

export function pickLocalWorkspace(): Promise<{ success: boolean; paths: string[] }> {
  return requestJson<{ success: boolean; paths: string[] }>('/api/system/pick-folder', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
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

export function installSshKey(host: string, publicKey: string, connection?: SshConnectionOptions): Promise<SshKeyInstallResponse> {
  return requestJson<SshKeyInstallResponse>('/api/ssh/install-key', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ host, publicKey, connection })
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
