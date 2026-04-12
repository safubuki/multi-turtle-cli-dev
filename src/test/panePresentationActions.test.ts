import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPanePresentationActions } from '../lib/panePresentationActions'
import { createInitialPane } from '../lib/paneState'
import type { BootstrapPayload, PaneState, PreviewRunCommandResponse, ProviderCatalogResponse } from '../types'

const browserUiMocks = vi.hoisted(() => ({
  writeClipboardText: vi.fn()
}))

vi.mock('../lib/browserUi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/browserUi')>()
  return {
    ...actual,
    writeClipboardText: browserUiMocks.writeClipboardText
  }
})

function createProvider(provider: ProviderCatalogResponse['provider'], label: string): ProviderCatalogResponse {
  return {
    provider,
    label,
    source: 'test',
    fetchedAt: null,
    available: true,
    models: [{
      id: `${provider}-model`,
      name: `${label} Model`,
      supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'],
      defaultReasoningEffort: 'medium'
    }],
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

function createBootstrap(): BootstrapPayload {
  return {
    success: true,
    providers: {
      codex: createProvider('codex', 'Codex'),
      copilot: createProvider('copilot', 'Copilot'),
      gemini: createProvider('gemini', 'Gemini')
    },
    localWorkspaces: [{
      id: 'ws-1',
      label: 'Workspace',
      path: 'C:\\workspace',
      indicators: [],
      source: 'manual'
    }],
    sshHosts: [],
    remoteRoots: [],
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

function createPane(bootstrap: BootstrapPayload, overrides: Partial<PaneState> = {}): PaneState {
  return {
    ...createInitialPane(0, bootstrap, bootstrap.localWorkspaces),
    id: 'pane-1',
    title: 'Presentation Pane',
    liveOutput: 'Generated output',
    ...overrides
  }
}

function createPresentationHarness(options: {
  paneOverrides?: Partial<PaneState>
  previewResponse?: PreviewRunCommandResponse
} = {}) {
  const bootstrap = createBootstrap()
  let panes = [createPane(bootstrap, options.paneOverrides)]

  const panesRef = { current: panes }
  const updatePane = (paneId: string, updates: Partial<PaneState>) => {
    panes = panes.map((pane) => (pane.id === paneId ? { ...pane, ...updates } : pane))
    panesRef.current = panes
  }
  const previewRunCommand = vi.fn(async (_paneId: string, _promptOverride?: string) => (
    options.previewResponse ?? {
      success: true,
      commandLine: 'codex --model codex-model',
      stdinPrompt: null,
      effectivePrompt: 'Prompt',
      workingDirectory: 'C:\\workspace',
      notes: []
    }
  ))

  const actions = createPanePresentationActions({
    panesRef,
    updatePane,
    previewRunCommand
  })

  return {
    actions,
    previewRunCommand,
    get pane() {
      return panes[0]
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPanePresentationActions', () => {
  it('output copy は pane 出力を clipboard に流す', async () => {
    browserUiMocks.writeClipboardText.mockResolvedValue(undefined)
    const harness = createPresentationHarness({
      paneOverrides: {
        liveOutput: 'Stream output',
        lastResponse: 'Final output'
      }
    })

    const copied = await harness.actions.handleCopyOutput('pane-1')

    expect(copied).toBe(true)
    expect(browserUiMocks.writeClipboardText).toHaveBeenCalledWith('Stream output')
  })

  it('copy 失敗時は pane に error 状態を反映する', async () => {
    browserUiMocks.writeClipboardText.mockRejectedValue(new Error('clipboard denied'))
    const harness = createPresentationHarness()

    const copied = await harness.actions.handleCopyText('pane-1', 'hello', 'copied')

    expect(copied).toBe(false)
    expect(harness.pane.status).toBe('error')
    expect(harness.pane.statusText).toBe('コピーに失敗しました')
    expect(harness.pane.lastError).toBe('clipboard denied')
  })

  it('preview は run preview handler に委譲する', async () => {
    const previewResponse: PreviewRunCommandResponse = {
      success: true,
      commandLine: 'gemini --model gemini-model',
      stdinPrompt: null,
      effectivePrompt: 'Preview prompt',
      workingDirectory: 'C:\\workspace',
      notes: ['note']
    }
    const harness = createPresentationHarness({ previewResponse })

    const result = await harness.actions.handlePreviewRunCommand('pane-1', 'override prompt')

    expect(harness.previewRunCommand).toHaveBeenCalledWith('pane-1', 'override prompt')
    expect(result).toEqual(previewResponse)
  })
})