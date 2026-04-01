import { useState } from 'react'
import {
  AlertTriangle,
  Bot,
  CheckCheck,
  ChevronLeft,
  Copy,
  Ellipsis,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  LoaderCircle,
  Maximize2,
  Play,
  RefreshCcw,
  Settings2,
  Share2,
  Square,
  Trash2,
  Wifi,
  X
} from 'lucide-react'
import type { LocalWorkspace, PaneState, ProviderCatalogResponse, ProviderId, SharedContextItem, SshHost } from '../types'

interface TerminalPaneProps {
  pane: PaneState
  catalogs: Record<ProviderId, ProviderCatalogResponse>
  localWorkspaces: LocalWorkspace[]
  sshHosts: SshHost[]
  sharedContext: SharedContextItem[]
  now: number
  isFocused: boolean
  onFocus: (paneId: string) => void
  onUpdate: (paneId: string, updates: Partial<PaneState>) => void
  onProviderChange: (paneId: string, provider: ProviderId) => void
  onModelChange: (paneId: string, model: string) => void
  onRun: (paneId: string) => void
  onStop: (paneId: string) => void
  onShare: (paneId: string) => void
  onCopyLatest: (paneId: string) => void
  onDuplicate: (paneId: string) => void
  onResetSession: (paneId: string) => void
  onDelete: (paneId: string) => void
  onLoadRemote: (paneId: string) => void
  onBrowseRemote: (paneId: string, path?: string) => void
  onCreateRemoteDirectory: (paneId: string) => void
  onOpenWorkspace: (paneId: string) => void
  onAddLocalWorkspace: (paneId: string) => void
  onSelectLocalWorkspace: (paneId: string, workspacePath: string) => void
  onRemoveLocalWorkspace: (paneId: string) => void
  onToggleContext: (paneId: string, contextId: string) => void
}

function formatClock(timestamp: number | null): string {
  if (!timestamp) {
    return '未実行'
  }

  return new Date(timestamp).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatElapsed(from: number | null, now: number): string {
  if (!from) {
    return '00:00'
  }

  const totalSeconds = Math.max(0, Math.floor((now - from) / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function getShortPathLabel(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function getOutputText(pane: PaneState): string {
  if (pane.liveOutput.trim()) {
    return pane.liveOutput
  }

  if (pane.lastResponse?.trim()) {
    return pane.lastResponse
  }

  return ''
}

export function TerminalPane({
  pane,
  catalogs,
  localWorkspaces,
  sshHosts,
  sharedContext,
  now,
  isFocused,
  onFocus,
  onUpdate,
  onProviderChange,
  onModelChange,
  onRun,
  onStop,
  onShare,
  onCopyLatest,
  onDuplicate,
  onResetSession,
  onDelete,
  onLoadRemote,
  onBrowseRemote,
  onCreateRemoteDirectory,
  onOpenWorkspace,
  onAddLocalWorkspace,
  onSelectLocalWorkspace,
  onRemoveLocalWorkspace,
  onToggleContext
}: TerminalPaneProps) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)

  const catalog = catalogs[pane.provider]
  const currentModel = catalog?.models.find((model) => model.id === pane.model) ?? catalog?.models[0]
  const availableRemoteProviders =
    pane.remoteAvailableProviders.length > 0
      ? pane.remoteAvailableProviders
      : (['codex', 'copilot', 'gemini'] as ProviderId[])
  const selectedLocalWorkspace = localWorkspaces.find((workspace) => workspace.path === pane.localWorkspacePath)
  const canRemoveLocalWorkspace = selectedLocalWorkspace?.source === 'manual'
  const isStalled = pane.status === 'running' && pane.lastActivityAt !== null && now - pane.lastActivityAt > 45_000
  const canRun =
    pane.prompt.trim().length > 0 &&
    (pane.workspaceMode === 'local'
      ? pane.localWorkspacePath.trim().length > 0
      : pane.sshHost.trim().length > 0 && pane.remoteWorkspacePath.trim().length > 0)
  const outputText = getOutputText(pane)
  const workspaceLabel =
    pane.workspaceMode === 'local'
      ? selectedLocalWorkspace?.label ?? getShortPathLabel(pane.localWorkspacePath || '未選択')
      : pane.remoteWorkspacePath
        ? getShortPathLabel(pane.remoteWorkspacePath)
        : pane.sshHost || 'SSH 未設定'

  return (
    <>
      <section
        id={`pane-${pane.id}`}
        className={`terminal-pane minimal-pane status-${pane.status} ${isStalled ? 'status-stalled' : ''} ${isFocused ? 'is-focused' : ''}`}
        onMouseDownCapture={() => onFocus(pane.id)}
      >
        <header className="pane-header compact-header">
          <div className="pane-title-block">
            <div className="pane-led" />
            <div className="pane-title-stack">
              <input
                className="pane-title-input"
                value={pane.title}
                onChange={(event) => onUpdate(pane.id, { title: event.target.value })}
              />
              <p>{pane.statusText}</p>
            </div>
          </div>

          <div className="pane-header-actions">
            <details className="pane-menu">
              <summary className="icon-button" aria-label="ペイン操作">
                <Ellipsis size={16} />
              </summary>
              <div className="pane-menu-surface">
                <button type="button" className="menu-action" onClick={() => onShare(pane.id)}>
                  <Share2 size={15} />
                  結果を共有
                </button>
                <button type="button" className="menu-action" onClick={() => onCopyLatest(pane.id)}>
                  <Copy size={15} />
                  応答をコピー
                </button>
                <button type="button" className="menu-action" onClick={() => onDuplicate(pane.id)}>
                  <Copy size={15} />
                  設定を複製
                </button>
                <button
                  type="button"
                  className="menu-action"
                  disabled={pane.status === 'running'}
                  onClick={() => onResetSession(pane.id)}
                >
                  <RefreshCcw size={15} />
                  履歴を初期化
                </button>
                <label className="menu-toggle">
                  <input
                    type="checkbox"
                    checked={pane.autoShare}
                    onChange={(event) => onUpdate(pane.id, { autoShare: event.target.checked })}
                  />
                  <span>完了時に共有</span>
                </label>
              </div>
            </details>

            <button type="button" className="icon-button danger" onClick={() => onDelete(pane.id)} title="ペインを削除">
              <Trash2 size={16} />
            </button>
          </div>
        </header>

        <div className="status-strip compact">
          <span className="tiny-badge">{catalog?.label ?? pane.provider}</span>
          <span className="tiny-badge">{pane.workspaceMode === 'local' ? 'Local' : 'SSH'}</span>
          <span className="tiny-badge">{workspaceLabel}</span>
          <span className={isStalled ? 'tiny-badge warning' : 'tiny-badge'}>
            {pane.status === 'running' ? `実行 ${formatElapsed(pane.runningSince, now)}` : `最終 ${formatClock(pane.lastRunAt)}`}
          </span>
        </div>

        <section className="primary-panel output-panel output-clickable">
          <div className="panel-header slim">
            <div>
              <h3>出力</h3>
              <p>{pane.lastActivityAt ? `最終更新 ${formatClock(pane.lastActivityAt)}` : 'まだ出力はありません'}</p>
            </div>
            <button type="button" className="icon-button" onClick={() => setIsOutputExpanded(true)} title="出力を拡大">
              <Maximize2 size={16} />
            </button>
          </div>

          <button type="button" className="output-surface output-trigger" onClick={() => setIsOutputExpanded(true)}>
            {outputText ? <pre>{outputText}</pre> : <p className="panel-placeholder">ここに実行結果と最新の応答が表示されます。</p>}
          </button>
        </section>

        <section className="composer-panel minimal-composer">
          <div className="panel-header slim">
            <div>
              <h3>指示</h3>
              <p>{pane.workspaceMode === 'local' ? pane.localWorkspacePath || 'ワークスペース未設定' : pane.remoteWorkspacePath || 'SSH 未設定'}</p>
            </div>
          </div>

          <textarea
            value={pane.prompt}
            onChange={(event) => onUpdate(pane.id, { prompt: event.target.value })}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canRun && pane.status !== 'running') {
                event.preventDefault()
                onRun(pane.id)
              }
            }}
            placeholder="やりたいことを入力します。Ctrl+Enter で実行できます。"
          />

          <div className="composer-footer">
            <div className="composer-hint">
              {pane.status === 'running' ? (
                <>
                  <LoaderCircle size={16} className="spin" />
                  <span>{isStalled ? '出力が止まっています。確認か再実行を検討してください。' : 'CLI を実行中です。'}</span>
                </>
              ) : pane.lastError ? (
                <>
                  <AlertTriangle size={16} />
                  <span>{pane.lastError}</span>
                </>
              ) : (
                <span>{workspaceLabel}</span>
              )}
            </div>

            <div className="composer-actions">
              {pane.status === 'running' ? (
                <button type="button" className="danger-button" onClick={() => onStop(pane.id)}>
                  <Square size={16} />
                  停止
                </button>
              ) : (
                <button type="button" className="primary-button" disabled={!canRun} onClick={() => onRun(pane.id)}>
                  <Play size={16} />
                  実行
                </button>
              )}
            </div>
          </div>
        </section>

        <div className="pane-accordion-group">
          <details className="pane-accordion">
            <summary className="accordion-summary">
              <span className="accordion-label">
                <Settings2 size={15} />
                設定
              </span>
              <span className="accordion-value">
                {catalog?.label ?? pane.provider} / {currentModel?.name ?? pane.model}
              </span>
            </summary>

            <div className="accordion-body">
              <div className="pane-meta-grid compact-grid">
                <label>
                  <span>CLI</span>
                  <select value={pane.provider} onChange={(event) => onProviderChange(pane.id, event.target.value as ProviderId)}>
                    {(['codex', 'copilot', 'gemini'] as ProviderId[]).map((provider) => {
                      const item = catalogs[provider]
                      const disabled = pane.workspaceMode === 'ssh' && !availableRemoteProviders.includes(provider)

                      return (
                        <option key={provider} value={provider} disabled={disabled}>
                          {item.label}
                          {disabled ? ' (SSH 未対応)' : ''}
                        </option>
                      )
                    })}
                  </select>
                </label>

                <label>
                  <span>モデル</span>
                  <select value={pane.model} onChange={(event) => onModelChange(pane.id, event.target.value)}>
                    {catalog?.models.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  <span>推論レベル</span>
                  <select
                    value={pane.reasoningEffort}
                    disabled={!currentModel || currentModel.supportedReasoningEfforts.length === 0}
                    onChange={(event) =>
                      onUpdate(pane.id, {
                        reasoningEffort: event.target.value as PaneState['reasoningEffort']
                      })
                    }
                  >
                    {currentModel?.supportedReasoningEfforts.length ? (
                      currentModel.supportedReasoningEfforts.map((effort) => (
                        <option key={effort} value={effort}>
                          {effort}
                        </option>
                      ))
                    ) : (
                      <option value={pane.reasoningEffort}>変更不可</option>
                    )}
                  </select>
                </label>

                <label>
                  <span>自律度</span>
                  <select
                    value={pane.autonomyMode}
                    disabled={pane.provider === 'codex'}
                    onChange={(event) =>
                      onUpdate(pane.id, {
                        autonomyMode: event.target.value === 'max' ? 'max' : 'balanced'
                      })
                    }
                  >
                    <option value="balanced">balanced</option>
                    <option value="max">max</option>
                  </select>
                </label>
              </div>

              <p className="field-note">
                {pane.provider === 'codex'
                  ? 'Codex は現在 full-auto 固定です。'
                  : 'balanced は安全寄り、max は自動編集を強めます。'}
              </p>
            </div>
          </details>

          <details className="pane-accordion">
            <summary className="accordion-summary">
              <span className="accordion-label">
                <FolderOpen size={15} />
                ワークスペース
              </span>
              <span className="accordion-value">{workspaceLabel}</span>
            </summary>

            <div className="accordion-body">
              <div className="workspace-switch compact-switch">
                <button
                  type="button"
                  className={pane.workspaceMode === 'local' ? 'switch-button active' : 'switch-button'}
                  onClick={() => onUpdate(pane.id, { workspaceMode: 'local' })}
                >
                  Local
                </button>
                <button
                  type="button"
                  className={pane.workspaceMode === 'ssh' ? 'switch-button active' : 'switch-button'}
                  onClick={() => onUpdate(pane.id, { workspaceMode: 'ssh' })}
                >
                  SSH
                </button>
              </div>

              {pane.workspaceMode === 'local' ? (
                <div className="workspace-stack">
                  <div className="workspace-current">
                    <span className="workspace-caption">現在のワークスペース</span>
                    <strong>{selectedLocalWorkspace?.label ?? '未選択'}</strong>
                    <span>{pane.localWorkspacePath || 'フォルダを選択してください。'}</span>
                  </div>

                  <div className="inline-actions wrap-actions">
                    <button type="button" className="secondary-button" onClick={() => onAddLocalWorkspace(pane.id)}>
                      <FolderPlus size={16} />
                      ワークスペースを選択
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!pane.localWorkspacePath}
                      onClick={() => onOpenWorkspace(pane.id)}
                    >
                      <FolderOpen size={16} />
                      VSCodeで開く
                    </button>
                    {canRemoveLocalWorkspace && (
                      <button type="button" className="secondary-button" onClick={() => onRemoveLocalWorkspace(pane.id)}>
                        <Trash2 size={16} />
                        一覧から外す
                      </button>
                    )}
                  </div>

                  {localWorkspaces.length > 1 && (
                    <label>
                      <span>保存済みワークスペース</span>
                      <select
                        value={pane.localWorkspacePath}
                        onChange={(event) => onSelectLocalWorkspace(pane.id, event.target.value)}
                      >
                        {localWorkspaces.map((workspace) => (
                          <option key={workspace.id} value={workspace.path}>
                            {workspace.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <div className="browser-panel">
                    <div className="section-headline compact-headline">
                      <strong>フォルダ内容</strong>
                      <span>{pane.localBrowserLoading ? '読み込み中' : `${pane.localBrowserEntries.length}件`}</span>
                    </div>

                    <div className="browser-list">
                      {pane.localBrowserEntries.length > 0 ? (
                        pane.localBrowserEntries.map((entry) => (
                          <div key={entry.path} className="browser-entry">
                            <div className="browser-entry-main">
                              {entry.isDirectory ? <Folder size={15} /> : <FileText size={15} />}
                              <div>
                                <strong>{entry.label}</strong>
                                <span>{entry.path}</span>
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="panel-placeholder browser-placeholder">
                          {pane.localBrowserLoading ? 'フォルダ内容を読み込んでいます。' : '選択したフォルダの内容がここに表示されます。'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="workspace-stack">
                  <label>
                    <span>SSHホスト</span>
                    <input
                      list={`ssh-hosts-${pane.id}`}
                      value={pane.sshHost}
                      onChange={(event) => onUpdate(pane.id, { sshHost: event.target.value })}
                      placeholder="user@server または ssh config の Host"
                    />
                    <datalist id={`ssh-hosts-${pane.id}`}>
                      {sshHosts.map((host) => (
                        <option key={host.id} value={host.alias} />
                      ))}
                    </datalist>
                  </label>

                  <div className="inline-actions wrap-actions">
                    <button type="button" className="secondary-button" onClick={() => onLoadRemote(pane.id)}>
                      <Wifi size={16} />
                      接続を更新
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!pane.remoteHomeDirectory}
                      onClick={() => onBrowseRemote(pane.id, pane.remoteHomeDirectory || undefined)}
                    >
                      <Home size={16} />
                      Home
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!pane.remoteParentPath}
                      onClick={() => onBrowseRemote(pane.id, pane.remoteParentPath || undefined)}
                    >
                      <ChevronLeft size={16} />
                      親へ
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={!pane.sshHost || !pane.remoteWorkspacePath}
                      onClick={() => onOpenWorkspace(pane.id)}
                    >
                      <FolderOpen size={16} />
                      VSCodeで開く
                    </button>
                  </div>

                  <div className="workspace-current">
                    <span className="workspace-caption">現在の接続</span>
                    <strong>{pane.sshHost || 'SSH 未設定'}</strong>
                    <span>{pane.remoteWorkspacePath || pane.remoteBrowserPath || '接続先を選択してください。'}</span>
                  </div>

                  <label>
                    <span>リモートワークスペース</span>
                    <input
                      list={`remote-workspaces-${pane.id}`}
                      value={pane.remoteWorkspacePath}
                      onChange={(event) => onUpdate(pane.id, { remoteWorkspacePath: event.target.value })}
                      placeholder="~/projects/app など"
                    />
                    <datalist id={`remote-workspaces-${pane.id}`}>
                      {pane.remoteWorkspaces.map((workspace) => (
                        <option key={workspace.path} value={workspace.path}>
                          {workspace.label}
                        </option>
                      ))}
                    </datalist>
                  </label>

                  <label>
                    <span>新規フォルダ</span>
                    <div className="inline-actions remote-create-row">
                      <input
                        value={pane.remoteNewDirectoryName}
                        onChange={(event) => onUpdate(pane.id, { remoteNewDirectoryName: event.target.value })}
                        placeholder="folder-name"
                      />
                      <button type="button" className="secondary-button" onClick={() => onCreateRemoteDirectory(pane.id)}>
                        <FolderPlus size={16} />
                        作成
                      </button>
                    </div>
                  </label>

                  <div className="browser-panel">
                    <div className="section-headline compact-headline">
                      <strong>リモート一覧</strong>
                      <span>{pane.remoteBrowserLoading ? '読み込み中' : pane.remoteBrowserPath || pane.remoteHomeDirectory || '未接続'}</span>
                    </div>

                    <div className="browser-list">
                      {pane.remoteBrowserEntries.length > 0 ? (
                        pane.remoteBrowserEntries.map((entry) => (
                          <div key={entry.path} className={`browser-entry remote-entry ${entry.path === pane.remoteWorkspacePath ? 'active' : ''}`}>
                            <button type="button" className="browser-entry-main browser-entry-button" onClick={() => onBrowseRemote(pane.id, entry.path)}>
                              <Folder size={15} />
                              <div>
                                <strong>{entry.label}</strong>
                                <span>{entry.path}</span>
                              </div>
                            </button>
                            <button type="button" className={entry.isWorkspace ? 'ghost-button workspace' : 'ghost-button'} onClick={() => onUpdate(pane.id, { remoteWorkspacePath: entry.path })}>
                              {entry.isWorkspace ? '使用' : '指定'}
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="panel-placeholder browser-placeholder">
                          {pane.remoteBrowserLoading ? 'リモート一覧を読み込んでいます。' : '接続を更新するとリモートの候補が表示されます。'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="badge-row">
                    {pane.remoteAvailableProviders.length > 0 ? (
                      pane.remoteAvailableProviders.map((provider) => (
                        <span key={provider} className="availability-badge">
                          {catalogs[provider].label}
                        </span>
                      ))
                    ) : (
                      <span className="availability-badge muted">CLI 未検出</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </details>

          {(sharedContext.length > 0 || pane.attachedContextIds.length > 0) && (
            <details className="pane-accordion">
              <summary className="accordion-summary">
                <span className="accordion-label">
                  <Share2 size={15} />
                  共有コンテキスト
                </span>
                <span className="accordion-value">{pane.attachedContextIds.length}件選択</span>
              </summary>

              <div className="accordion-body">
                <div className="chip-list">
                  {sharedContext.length > 0 ? (
                    sharedContext.map((item) => {
                      const attached = pane.attachedContextIds.includes(item.id)

                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={attached ? 'context-chip active' : 'context-chip'}
                          onClick={() => onToggleContext(pane.id, item.id)}
                          title={item.detail}
                        >
                          <strong>{item.sourcePaneTitle}</strong>
                          <span>{item.summary}</span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="empty-chip-row">共有済みの文脈はまだありません。</div>
                  )}
                </div>
              </div>
            </details>
          )}

          {(pane.streamEntries.length > 0 || pane.logs.length > 0) && (
            <details className="pane-accordion">
              <summary className="accordion-summary">
                <span className="accordion-label">
                  <Bot size={15} />
                  実行ログ
                </span>
                <span className="accordion-value">
                  {pane.streamEntries.length + pane.logs.length}件
                </span>
              </summary>

              <div className="accordion-body stacked-panels">
                {pane.streamEntries.length > 0 && (
                  <div className="activity-panel compact-panel">
                    <div className="section-headline compact-headline">
                      <strong>ストリーム</strong>
                      <span>{formatClock(pane.lastRunAt)}</span>
                    </div>
                    <div className="activity-feed">
                      {pane.streamEntries.map((entry) => (
                        <article key={entry.id} className={`activity-entry ${entry.kind}`}>
                          <header>
                            <strong>{entry.kind}</strong>
                            <span>{formatClock(entry.createdAt)}</span>
                          </header>
                          <p>{entry.text}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                )}

                {pane.logs.length > 0 && (
                  <div className="history-panel compact-panel">
                    <div className="section-headline compact-headline">
                      <strong>会話履歴</strong>
                      <span>{pane.logs.length}件</span>
                    </div>
                    <div className="history-feed">
                      {pane.logs.map((entry) => (
                        <article key={entry.id} className={`history-entry ${entry.role}`}>
                          <header>
                            <strong>{entry.role === 'assistant' ? pane.provider : entry.role}</strong>
                            <span>{formatClock(entry.createdAt)}</span>
                          </header>
                          <p>{entry.text}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      </section>

      {isOutputExpanded && (
        <div className="output-modal-backdrop" onClick={() => setIsOutputExpanded(false)}>
          <div className="output-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div>
                <h3>出力の拡大表示</h3>
                <p>{pane.title}</p>
              </div>
              <button type="button" className="icon-button" onClick={() => setIsOutputExpanded(false)} title="閉じる">
                <X size={16} />
              </button>
            </div>

            <div className="output-modal-body">
              {outputText ? <pre>{outputText}</pre> : <p className="panel-placeholder">まだ出力はありません。</p>}
            </div>

            <div className="output-modal-footer">
              <button type="button" className="secondary-button" onClick={() => onCopyLatest(pane.id)}>
                <CheckCheck size={16} />
                応答をコピー
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
