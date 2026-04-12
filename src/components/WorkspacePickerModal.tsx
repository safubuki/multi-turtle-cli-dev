import {
  X,
  XCircle
} from 'lucide-react'
import type { WorkspacePickerState } from '../types'
import {
  getWorkspacePickerParentPath,
  isLocalWorkspacePickerRootVisible,
  isWorkspacePickerRootActive
} from '../lib/workspacePaths'

interface WorkspacePickerModalProps {
  workspacePicker: WorkspacePickerState
  onBrowse: (path: string) => void
  onClose: () => void
  onCreateDirectory: () => void
  onConfirm: () => void
}

export function WorkspacePickerModal({
  workspacePicker,
  onBrowse,
  onClose,
  onCreateDirectory,
  onConfirm
}: WorkspacePickerModalProps) {
  const parentPath = getWorkspacePickerParentPath(workspacePicker)

  return (
    <div className="output-modal-backdrop">
      <div className="output-modal workspace-picker-modal">
        <div className="panel-header slim">
          <div>
            <h3>{workspacePicker.mode === 'local' ? 'ワークスペースを選択' : 'リモート一覧/リモートワークスペース選択'}</h3>
            <p className="workspace-picker-current-path">
              {workspacePicker.path || (workspacePicker.mode === 'local'
                ? '使いたいフォルダを選んでください。'
                : '使いたいリモートフォルダを選んでください。')}
            </p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} title="閉じる" aria-label="閉じる"><X size={16} /></button>
        </div>

        <div className="workspace-picker-toolbar">
          <div className="workspace-picker-roots">
            {workspacePicker.roots
              .filter((root) => workspacePicker.mode !== 'local' || isLocalWorkspacePickerRootVisible(root))
              .map((root) => (
                <button key={root.path} type="button" className={isWorkspacePickerRootActive(workspacePicker, root.path) ? 'switch-button active' : 'switch-button'} onClick={() => onBrowse(root.path)}>
                  {root.label}
                </button>
              ))}
            {parentPath && (
              <button type="button" className="switch-button workspace-picker-up-button" disabled={workspacePicker.loading} onClick={() => onBrowse(parentPath)}>
                {'一つ上へ'}
              </button>
            )}
          </div>
          <div className="workspace-picker-actions">
            <button type="button" className="secondary-button" disabled={!workspacePicker.path || workspacePicker.loading} onClick={onCreateDirectory}>
              {'新しいフォルダ'}
            </button>
            <button type="button" className="secondary-button" disabled={!workspacePicker.path || workspacePicker.loading} onClick={() => onBrowse(workspacePicker.path)}>
              {'再読込'}
            </button>
          </div>
        </div>

        {workspacePicker.error && (
          <div className="global-error compact-error">
            <XCircle size={16} />
            <span>{workspacePicker.error}</span>
          </div>
        )}

        <div className="workspace-picker-list">
          {workspacePicker.loading ? (
            <div className="panel-placeholder">{workspacePicker.mode === 'local' ? 'フォルダ一覧を読み込み中です。' : 'リモートフォルダ一覧を読み込み中です。'}</div>
          ) : workspacePicker.entries.length > 0 ? (
            workspacePicker.entries.map((entry) => (
              <button key={entry.path} type="button" className="workspace-picker-entry" onClick={() => onBrowse(entry.path)}>
                <strong>{entry.label}</strong>
                <span>{entry.path}</span>
                {entry.isWorkspace ? <span>{'ワークスペース候補'}</span> : null}
              </button>
            ))
          ) : (
            <div className="panel-placeholder">{workspacePicker.mode === 'local' ? 'この場所に表示できるフォルダがありません。' : 'この場所に表示できるリモートフォルダがありません。'}</div>
          )}
        </div>

        <div className="output-modal-footer workspace-picker-footer">
          <button type="button" className="secondary-button" onClick={onClose}>{'キャンセル'}</button>
          <button type="button" className="primary-button" disabled={!workspacePicker.path || workspacePicker.loading} onClick={onConfirm}>
            {workspacePicker.mode === 'local' ? 'このフォルダを使う' : 'このリモートフォルダを使う'}
          </button>
        </div>
      </div>
    </div>
  )
}