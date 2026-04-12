import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { STORAGE_KEYS } from '../lib/storage'
import type {
  BootstrapPayload,
  LocalBrowseResponse,
  LocalBrowseRootsResponse,
  PaneState,
  PreviewRunCommandResponse,
  ProviderCatalogResponse,
  RemoteBrowseResponse,
  RemoteWorkspaceResponse,
  SshInspectionResponse
} from '../types'

const apiMocks = vi.hoisted(() => ({
  fetchBootstrap: vi.fn(),
  fetchLocalBrowseRoots: vi.fn(),
  browseLocalDirectory: vi.fn(),
  createLocalDirectory: vi.fn(),
  browseRemoteDirectory: vi.fn(),
  fetchRemoteWorkspaces: vi.fn(),
  inspectSshHost: vi.fn(),
  previewRunCommand: vi.fn()
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    fetchBootstrap: apiMocks.fetchBootstrap,
    fetchLocalBrowseRoots: apiMocks.fetchLocalBrowseRoots,
    browseLocalDirectory: apiMocks.browseLocalDirectory,
    createLocalDirectory: apiMocks.createLocalDirectory,
    browseRemoteDirectory: apiMocks.browseRemoteDirectory,
    fetchRemoteWorkspaces: apiMocks.fetchRemoteWorkspaces,
    inspectSshHost: apiMocks.inspectSshHost,
    previewRunCommand: apiMocks.previewRunCommand
  }
})

function createProvider(provider: ProviderCatalogResponse['provider'], label: string): ProviderCatalogResponse {
  return {
    provider,
    label,
    source: 'test',
    fetchedAt: null,
    available: true,
    models: [
      {
        id: `${provider}-model`,
        name: `${label} Model`,
        supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
        defaultReasoningEffort: 'medium'
      }
    ],
    versionInfo: {
      packageName: `${provider}-cli`,
      installedVersion: '1.0.0',
      latestVersion: '1.0.0',
      updateAvailable: false,
      updateCommand: `npm install -g ${provider}-cli@latest`,
      latestCheckError: null
    },
    error: null
  }
}

function createBootstrapPayload(): BootstrapPayload {
  return {
    success: true,
    providers: {
      codex: createProvider('codex', 'Codex'),
      copilot: createProvider('copilot', 'Copilot'),
      gemini: createProvider('gemini', 'Gemini')
    },
    localWorkspaces: [],
    sshHosts: [],
    remoteRoots: ['/workspace'],
    hostPlatform: 'windows',
    features: {
      vscode: true,
      ssh: true,
      remoteDiscovery: true,
      remoteBrowser: true,
      shell: true
    },
    spec: []
  }
}

function seedPersistedPanes(panes: Array<Partial<PaneState>>) {
  window.localStorage.clear()
  window.localStorage.setItem(STORAGE_KEYS.panes, JSON.stringify(panes))
  window.localStorage.setItem(STORAGE_KEYS.sharedContext, JSON.stringify([]))
  window.localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify('triple'))
  window.localStorage.setItem(STORAGE_KEYS.localWorkspaces, JSON.stringify([]))
  window.localStorage.setItem(STORAGE_KEYS.focusedPane, JSON.stringify(panes[0]?.id ?? null))
}

function localBrowsePayload(path: string, entries: LocalBrowseResponse['entries']): LocalBrowseResponse {
  return {
    success: true,
    path,
    entries
  }
}

function remoteBrowsePayload(path: string, parentPath: string | null, entries: RemoteBrowseResponse['entries']): RemoteBrowseResponse {
  return {
    success: true,
    host: 'devbox',
    path,
    parentPath,
    homeDirectory: '/home/alice',
    entries
  }
}

function renderApp() {
  return render(<App />)
}

function getWorkspacePickerModal(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /ワークスペースを選択|リモート一覧\/リモートワークスペース選択/ })
  return heading.closest('.output-modal') as HTMLElement
}

function getEntryButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const target = within(container).getByText(text)
  return target.closest('button') as HTMLButtonElement
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  apiMocks.fetchBootstrap.mockResolvedValue(createBootstrapPayload())
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('App workspace picker and command preview flows', () => {
  it('ローカル workspace picker で選択・再読込・新規フォルダ作成を行える', async () => {
    seedPersistedPanes([
      {
        id: 'pane-local',
        title: 'Local Pane',
        workspaceOpen: true,
        workspaceMode: 'local',
        provider: 'codex'
      }
    ])

    apiMocks.fetchLocalBrowseRoots.mockResolvedValue({
      success: true,
      roots: [{ label: 'C', path: 'C:\\' }]
    } satisfies LocalBrowseRootsResponse)

    apiMocks.browseLocalDirectory.mockImplementation(async (path: string) => {
      if (path === 'C:\\') {
        return localBrowsePayload('C:\\', [
          { label: 'Projects', path: 'C:\\Projects', isDirectory: true },
          { label: 'Temp', path: 'C:\\Temp', isDirectory: true }
        ])
      }

      if (path === 'C:\\Projects') {
        return localBrowsePayload('C:\\Projects', [
          { label: 'Existing', path: 'C:\\Projects\\Existing', isDirectory: true }
        ])
      }

      if (path === 'C:\\Projects\\NewFolder') {
        return localBrowsePayload('C:\\Projects\\NewFolder', [])
      }

      throw new Error(`Unexpected local path: ${path}`)
    })

    apiMocks.createLocalDirectory.mockResolvedValue({
      success: true,
      path: 'C:\\Projects\\NewFolder',
      created: true
    })

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('NewFolder')

    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'ワークスペースを選択' }))

    const modal = await waitFor(() => getWorkspacePickerModal())
    fireEvent.click(getEntryButtonByText(modal, 'Projects'))

    await waitFor(() => {
      expect(apiMocks.browseLocalDirectory).toHaveBeenCalledWith('C:\\Projects')
    })

    fireEvent.click(within(modal).getByRole('button', { name: '再読込' }))

    await waitFor(() => {
      const projectCalls = apiMocks.browseLocalDirectory.mock.calls.filter(([path]) => path === 'C:\\Projects')
      expect(projectCalls.length).toBeGreaterThanOrEqual(2)
    })

    fireEvent.click(within(modal).getByRole('button', { name: '新しいフォルダ' }))

    await waitFor(() => {
      expect(apiMocks.createLocalDirectory).toHaveBeenCalledWith('C:\\Projects', 'NewFolder')
      expect(screen.getByText('C:\\Projects\\NewFolder')).toBeInTheDocument()
    })

    fireEvent.click(within(modal).getByRole('button', { name: 'このフォルダを使う' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'ワークスペースを選択' })).not.toBeInTheDocument()
      expect(screen.getAllByText('C:\\Projects\\NewFolder').length).toBeGreaterThan(0)
    })

    promptSpy.mockRestore()
  })

  it('SSH workspace picker で選択と遷移を行える', async () => {
    seedPersistedPanes([
      {
        id: 'pane-ssh',
        title: 'SSH Pane',
        workspaceOpen: true,
        workspaceMode: 'ssh',
        provider: 'codex',
        sshHost: 'devbox',
        sshUser: 'alice'
      }
    ])

    apiMocks.browseRemoteDirectory.mockImplementation(async (_host: string, path?: string) => {
      if (!path || path === '/home/alice') {
        return remoteBrowsePayload('/home/alice', '/home', [
          { label: 'project', path: '/home/alice/project', isDirectory: true, isWorkspace: true },
          { label: 'notes', path: '/home/alice/notes', isDirectory: true, isWorkspace: false }
        ])
      }

      if (path === '/home/alice/project') {
        return remoteBrowsePayload('/home/alice/project', '/home/alice', [
          { label: 'src', path: '/home/alice/project/src', isDirectory: true, isWorkspace: false }
        ])
      }

      throw new Error(`Unexpected remote path: ${path}`)
    })

    apiMocks.fetchRemoteWorkspaces.mockResolvedValue({
      success: true,
      host: 'devbox',
      workspaces: [{ label: 'project', path: '/home/alice/project' }]
    } satisfies RemoteWorkspaceResponse)

    apiMocks.inspectSshHost.mockResolvedValue({
      success: true,
      host: 'devbox',
      availableProviders: ['codex', 'copilot', 'gemini'],
      homeDirectory: '/home/alice',
      diagnostics: ['SSH OK'],
      localKeys: [],
      suggestedUser: 'alice',
      suggestedPort: null,
      suggestedIdentityFile: null,
      suggestedProxyJump: null,
      suggestedProxyCommand: null
    } satisfies SshInspectionResponse)

    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'リモートに接続' }))

    await waitFor(() => {
      expect(apiMocks.browseRemoteDirectory).toHaveBeenCalledWith('devbox', undefined, expect.objectContaining({ username: 'alice' }))
    })

    const chooseRemoteWorkspaceButton = await screen.findByRole('button', { name: 'ワークスペースを選択' })
    expect(chooseRemoteWorkspaceButton).toBeEnabled()

    fireEvent.click(chooseRemoteWorkspaceButton)

    const modal = await waitFor(() => getWorkspacePickerModal())
    fireEvent.click(getEntryButtonByText(modal, 'project'))

    await waitFor(() => {
      expect(apiMocks.browseRemoteDirectory).toHaveBeenCalledWith('devbox', '/home/alice/project', expect.anything())
      expect(screen.getByText('/home/alice/project')).toBeInTheDocument()
    })

    fireEvent.click(within(modal).getByRole('button', { name: '一つ上へ' }))

    await waitFor(() => {
      const homeCalls = apiMocks.browseRemoteDirectory.mock.calls.filter(([, path]) => path === '/home/alice')
      expect(homeCalls.length).toBeGreaterThanOrEqual(2)
      expect(screen.getAllByText('/home/alice').length).toBeGreaterThan(0)
    })

    fireEvent.click(getEntryButtonByText(modal, 'project'))
    await waitFor(() => expect(screen.getByText('/home/alice/project')).toBeInTheDocument())

    fireEvent.click(within(modal).getByRole('button', { name: 'このリモートフォルダを使う' }))

    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'リモート一覧/リモートワークスペース選択' })).not.toBeInTheDocument()
      expect(screen.getAllByText('/home/alice/project').length).toBeGreaterThan(0)
    })
  })

  it('実行プレビューで pane context を従来どおり表示する', async () => {
    seedPersistedPanes([
      {
        id: 'pane-preview',
        title: 'Preview Pane',
        provider: 'codex',
        model: 'codex-model',
        workspaceMode: 'local',
        localWorkspacePath: 'C:\\Preview',
        prompt: 'プレビュー確認',
        logs: [
          { id: 'log-1', role: 'user', text: 'first user prompt', createdAt: 1_700_000_000_000 },
          { id: 'log-2', role: 'assistant', text: 'assistant response', createdAt: 1_700_000_010_000, provider: 'codex', model: 'codex-model' }
        ]
      }
    ])

    apiMocks.previewRunCommand.mockResolvedValue({
      success: true,
      commandLine: 'codex --model codex-model',
      stdinPrompt: null,
      effectivePrompt: 'プレビュー確認',
      workingDirectory: 'C:\\Preview',
      notes: []
    } satisfies PreviewRunCommandResponse)

    renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'コマンドを確認' }))

    await waitFor(() => {
      expect(apiMocks.previewRunCommand).toHaveBeenCalledTimes(1)
      expect(apiMocks.previewRunCommand.mock.calls[0]?.[0].memory).toHaveLength(2)
      expect(apiMocks.previewRunCommand.mock.calls[0]?.[0].memory[0]?.text).toBe('first user prompt')
      expect(apiMocks.previewRunCommand.mock.calls[0]?.[0].memory[1]?.text).toBe('assistant response')
    })

    expect(await screen.findByText('同一ペイン補助コンテキスト')).toBeInTheDocument()
    expect(screen.getByText(/first user prompt/)).toBeInTheDocument()
    expect(screen.getByText(/assistant response/)).toBeInTheDocument()
  })
})