import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  Copy,  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Home,
  History,
  KeyRound,
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

interface TransferOptions {
  localPath?: string
  remotePath?: string
  remoteLabel?: string
  isDirectory?: boolean
}

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
  onShareToPane: (sourcePaneId: string, targetPaneId: string) => void
  onCopyOutput: (paneId: string) => void
  onCopyProviderCommand: (paneId: string, text: string, successMessage: string) => void
  onDuplicate: (paneId: string) => void
  onStartNewSession: (paneId: string) => void
  onResetSession: (paneId: string) => void
  onDelete: (paneId: string) => void
  onLoadRemote: (paneId: string) => void
  onBrowseRemote: (paneId: string, path?: string) => void
  onCreateRemoteDirectory: (paneId: string) => void
  onOpenFileManager: (paneId: string) => void
  onOpenWorkspace: (paneId: string) => void
  onOpenCommandPrompt: (paneId: string) => void
  onRunShell: (paneId: string) => void
  onStopShell: (paneId: string) => void
  onOpenPath: (paneId: string, path: string, resourceType: 'folder' | 'file') => void
  onAddLocalWorkspace: (paneId: string) => void
  onOpenRemoteWorkspacePicker: (paneId: string) => void
  onSelectLocalWorkspace: (paneId: string, workspacePath: string) => void
  onRemoveLocalWorkspace: (paneId: string) => void
  onBrowseLocal: (paneId: string, path: string) => void
  onGenerateSshKey: (paneId: string) => void
  onDeleteSshKey: (paneId: string) => void
  onInstallSshPublicKey: (paneId: string) => void
  onRemoveKnownHost: (paneId: string) => void
  onTransferSshPath: (paneId: string, direction: 'upload' | 'download', options?: TransferOptions) => void
  shareTargets: Array<{ id: string; title: string }>
  onSelectSession: (paneId: string, sessionKey: string | null) => void
}

const UI = {
  notRun: '\u672a\u5b9f\u884c',
  unselected: '\u672a\u9078\u629e',
  sshUnset: 'SSH \u672a\u8a2d\u5b9a',
  currentSession: '\u73fe\u5728\u306e\u30bb\u30c3\u30b7\u30e7\u30f3',
  currentPrefix: '\u73fe\u5728 / ',
  deleteConfirm: '\u3053\u306e\u30da\u30a4\u30f3\u3092\u524a\u9664\u3057\u3066\u3082\u826f\u3044\u3067\u3059\u304b\uff1f',
  newSession: '\u65b0\u898f\u30bb\u30c3\u30b7\u30e7\u30f3',
  paneMenu: '\u5171\u6709',
  shareGlobal: '\u6700\u65b0\u7d50\u679c\u3092\u5168\u4f53\u5171\u6709\u306b\u8ffd\u52a0',
  shareDirect: '\u76f8\u624b\u30da\u30a4\u30f3\u3078\u500b\u5225\u5171\u6709',
  copyResponse: '\u5fdc\u7b54\u3092\u30b3\u30d4\u30fc',
  copyOutput: '\u51fa\u529b\u3092\u30b3\u30d4\u30fc',
  duplicatePane: '\u30da\u30a4\u30f3\u3092\u8907\u88fd',
  resetConversation: '\u4f1a\u8a71\u3092\u521d\u671f\u5316',
  autoShare: '\u5b8c\u4e86\u6642\u306b\u6700\u65b0\u7d50\u679c\u3092\u5168\u4f53\u5171\u6709',
  autoShareShort: '\u5b8c\u4e86\u6642',
  updateCliField: 'CLI\u66f4\u65b0',
  updateCliSummaryCurrent: 'CLI \u7248\u306f\u6700\u65b0\u3067\u3059',
  updateCliSummaryOutdated: 'CLI \u7248\u306b\u5dee\u304c\u3042\u308a\u307e\u3059',
  updateCliSummaryUnknown: 'CLI \u7248\u60c5\u5831\u3092\u78ba\u8a8d',
  versionCurrent: '\u73fe\u5728\u306e npm \u7248',
  versionLatest: 'npm latest',
  versionCommand: '\u66f4\u65b0\u30b3\u30de\u30f3\u30c9',
  rollbackCommand: '\u30ed\u30fc\u30eb\u30d0\u30c3\u30af\u30b3\u30de\u30f3\u30c9',
  copyCommand: '\u30b3\u30de\u30f3\u30c9\u3092\u30b3\u30d4\u30fc',
  commandSelectable: '\u30b3\u30de\u30f3\u30c9\u306f\u305d\u306e\u307e\u307e\u9078\u629e\u3067\u304d\u307e\u3059\u3002',
  versionImpactNote: '\u66f4\u65b0\u3059\u308b\u3068\u3001\u5229\u7528\u3067\u304d\u308b\u30e2\u30c7\u30eb\u4e00\u89a7\u3084 CLI \u306e\u632f\u308b\u821e\u3044\u304c\u5909\u308f\u308b\u3053\u3068\u304c\u3042\u308a\u307e\u3059\u3002\u5fc5\u8981\u306a\u3089\u4e0b\u306e\u30ed\u30fc\u30eb\u30d0\u30c3\u30af\u30b3\u30de\u30f3\u30c9\u3067\u623b\u305b\u307e\u3059\u3002',
  versionUnknown: '\u4e0d\u660e',
  versionStatusCurrent: '\u6700\u65b0\u3067\u3059',
  versionStatusOutdated: '\u66f4\u65b0\u53ef\u80fd',
  versionStatusUnknown: '\u6700\u65b0\u78ba\u8a8d\u4e0d\u53ef',
  versionNote: '\u3053\u306e\u30c4\u30fc\u30eb\u306f npm \u30b0\u30ed\u30fc\u30d0\u30eb\u306b\u5165\u3063\u3066\u3044\u308b CLI / SDK \u3092\u53c2\u7167\u3057\u307e\u3059\u3002\u5916\u90e8\u3067\u7248\u304c\u5909\u308f\u3063\u305f\u5834\u5408\u3082\u3001\u3053\u306e\u753b\u9762\u306b\u623b\u308b\u3068\u518d\u8aad\u8fbc\u3057\u307e\u3059\u3002',
  versionMismatchNote: '\u53e4\u3044\u7248\u3092\u4f7f\u3044\u7d9a\u3051\u308b\u3068\u3001CLI \u672c\u4f53\u3067\u5229\u7528\u3067\u304d\u308b\u6700\u65b0\u30e2\u30c7\u30eb\u304c\u3053\u306e\u4e00\u89a7\u306b\u51fa\u306a\u3044\u306a\u3069\u3001\u30e2\u30c7\u30eb\u4e0d\u4e00\u81f4\u304c\u8d77\u304d\u3048\u307e\u3059\u3002',
  versionCheckError: 'npm latest \u306e\u53d6\u5f97\u306b\u5931\u6557\u3057\u307e\u3057\u305f',
  deletePane: '\u30da\u30a4\u30f3\u3092\u524a\u9664',
  openExplorer: 'Explorer\u3067\u958b\u304f',
  openVsCode: 'VSCode\u3067\u958b\u304f',
  output: 'AI\u7d50\u679c\u51fa\u529b',
  outputEmpty: '\u307e\u3060\u51fa\u529b\u306f\u3042\u308a\u307e\u305b\u3093\u3002',
  outputPlaceholder: '\u3053\u3053\u306b\u5b9f\u884c\u7d50\u679c\u3068\u6700\u65b0\u306e\u5fdc\u7b54\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002',
  outputExpand: '\u51fa\u529b\u3092\u62e1\u5927',
  instruction: 'AI\u6307\u793a\uff08\u30d7\u30ed\u30f3\u30d7\u30c8\uff09',
  workspaceUnset: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u672a\u8a2d\u5b9a',
  promptPlaceholder: '\u3084\u308a\u305f\u3044\u3053\u3068\u3092\u5165\u529b\u3057\u307e\u3059\u3002Ctrl+Enter \u3067\u5b9f\u884c\u3067\u304d\u307e\u3059\u3002',
  stalledHint: '\u51fa\u529b\u304c\u6b62\u307e\u3063\u3066\u3044\u307e\u3059\u3002\u78ba\u8a8d\u304b\u518d\u5b9f\u884c\u3092\u691c\u8a0e\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
  runningHint: 'CLI \u3092\u5b9f\u884c\u4e2d\u3067\u3059\u3002',
  updatingHint: 'AI \u3092\u66f4\u65b0\u4e2d\u3067\u3059\u3002',
  stop: '\u505c\u6b62',
  run: '\u5b9f\u884c',
  settings: 'CLI/AI\u30e2\u30c7\u30eb\u9078\u629e/\u8a2d\u5b9a',
  workspace: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u8a2d\u5b9a',
  cli: 'CLI',
  model: '\u30e2\u30c7\u30eb',
  reasoning: '\u63a8\u8ad6\u30ec\u30d9\u30eb',
  reasoningUnavailable: '\u9078\u629e\u3067\u304d\u307e\u305b\u3093',
  executionStyle: '\u81ea\u52d5\u627f\u8a8d\u30ec\u30d9\u30eb',
  readonlyCodex: 'Codex \u306f --full-auto \u56fa\u5b9a\u3067\u3059\u3002Fast\u30e2\u30fc\u30c9\u306f\u30d7\u30ed\u30f3\u30d7\u30c8\u5148\u982d\u306b /fast \u3092\u4ed8\u3051\u3066\u5b9f\u884c\u3057\u307e\u3059\u3002',
  styleHint: '\u6a19\u6e96\u306f\u901a\u5e38\u306e\u7de8\u96c6\u3068\u30c4\u30fc\u30eb\u5b9f\u884c\u3092\u81ea\u52d5\u3067\u9032\u3081\u3001\u5236\u9650\u306a\u3057\u306f\u305d\u308c\u3088\u308a\u5e83\u3044\u64cd\u4f5c\u307e\u3067\u8a31\u53ef\u3057\u307e\u3059\u3002Gemini \u306f auto_edit / yolo\u3001Copilot \u306f allow-all-tools / allow-all \u306b\u5bfe\u5fdc\u3057\u307e\u3059\u3002',
  unchanged: '\u9078\u629e\u3067\u304d\u307e\u305b\u3093',
  normal: '\u6a19\u6e96\u306e\u81ea\u52d5\u627f\u8a8d',
  active: '\u5236\u9650\u306a\u3057\u306e\u81ea\u52d5\u627f\u8a8d',
  currentWorkspace: '\u73fe\u5728\u306e\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
  chooseWorkspace: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u9078\u629e',
  chooseRemoteWorkspace: '\u30ea\u30e2\u30fc\u30c8\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u9078\u629e',
  removeFromList: '\u4e00\u89a7\u304b\u3089\u5916\u3059',
  savedWorkspaces: '\u767b\u9332\u6e08\u307f\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
  folderContents: '\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u306e\u5185\u5bb9',
  browseLoading: '\u30d5\u30a9\u30eb\u30c0\u5185\u5bb9\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002',
  browseEmpty: '\u9078\u629e\u3057\u305f\u30d5\u30a9\u30eb\u30c0\u306e\u5185\u5bb9\u304c\u3053\u3053\u306b\u8868\u793a\u3055\u308c\u307e\u3059\u3002',
  currentConnection: '\u73fe\u5728\u306e\u63a5\u7d9a',
  connectionSettings: '\u63a5\u7d9a\u8a2d\u5b9a',
  connectionConfigured: '\u63a5\u7d9a\u8a2d\u5b9aOK',
  connectionUnconfigured: '\u63a5\u7d9a\u672a\u8a2d\u5b9a',
  connectionInfo: '\u63a5\u7d9a\u60c5\u5831',
  keySettings: '\u9375\u8a2d\u5b9a',
  selectable: '\u9078\u629e\u53ef\u80fd',
  infoOnly: '\u60c5\u5831\u306e\u307f',
  passwordHint: '\u203b\u30d1\u30b9\u30ef\u30fc\u30c9\u63a5\u7d9a\u3092\u4f7f\u3046\u5834\u5408\u306e\u307f\u5165\u529b\u3057\u307e\u3059\u3002\u9375\u3092\u4f7f\u3046\u5834\u5408\u306f\u3001\u8a2d\u5b9a\u5f8c\u306f\u7a7a\u6b04\u3067\u69cb\u3044\u307e\u305b\u3093\u3002',
  userHint: '\u203bSSH config \u306e Host \u3092\u4f7f\u3046\u304b\u3001SSH Host / IP \u306b user@host \u3092\u542b\u3081\u308b\u5834\u5408\u306f\u7701\u7565\u3067\u304d\u307e\u3059\u3002\u305d\u308c\u4ee5\u5916\u306f User \u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\u3002',
  refreshConnection: '\u30ea\u30e2\u30fc\u30c8\u306b\u63a5\u7d9a',
  remoteWorkspace: '\u30ea\u30e2\u30fc\u30c8\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9',
  publicKey: '\u516c\u958b\u9375',
  publicKeyEmpty: '\u9375\u3092\u751f\u6210\u3059\u308b\u304b\u3001\u65e2\u5b58\u306e\u9375\u3092\u9078\u629e\u3059\u308b\u3068\u3001\u3053\u3053\u306b\u516c\u958b\u9375\u3092\u8868\u793a\u3057\u307e\u3059\u3002',
  selectedKey: '\u4f7f\u7528\u3059\u308b\u9375',
  keyName: '\u9375\u540d',
  keyFileName: '\u9375\u30d5\u30a1\u30a4\u30eb\u540d',
  keyComment: '\u30b3\u30e1\u30f3\u30c8',
  generateKey: '\u9375\u3092\u751f\u6210',
  deleteKey: '\u9078\u629e\u4e2d\u306e\u9375\u3092\u524a\u9664',
  installKey: '\u516c\u958b\u9375\u3092\u63a5\u7d9a\u5148\u306b\u767b\u9332',
  removeKnownHost: '\u63a5\u7d9a\u5148\u306e\u30db\u30b9\u30c8\u9375\u3092\u524a\u9664',
  keyActionHint: '\u9078\u629e\u4e2d\u306e\u9375\u3092\u524a\u9664\u3057\u305f\u5834\u5408\u306f\u3001\u65b0\u3057\u3044\u9375\u3092\u751f\u6210\u3057\u3066\u3001\u516c\u958b\u9375\u3092\u63a5\u7d9a\u5148\u306b\u767b\u9332\u3057\u3066\u304f\u3060\u3055\u3044\u3002\n\u63a5\u7d9a\u5148\u306e\u30db\u30b9\u30c8\u9375\u3092\u524a\u9664\u3057\u305f\u5834\u5408\u306f\u3001\u6b21\u56de\u63a5\u7d9a\u6642\u306b\u63a5\u7d9a\u5148\u306e\u5b89\u5168\u78ba\u8a8d\u3060\u3051\u3092\u3084\u308a\u76f4\u3057\u307e\u3059\u3002\u901a\u5e38\u306f\u516c\u958b\u9375\u306e\u518d\u767b\u9332\u306f\u4e0d\u8981\u3067\u3059\u3002',
  diagnostics: '\u63a5\u7d9a\u8a3a\u65ad / CLI\u78ba\u8a8d',
  diagnosticsOk: 'OK',
  diagnosticsNg: 'NG',
  diagnosticsPending: '\u672a\u78ba\u8a8d',
  cliAvailability: 'CLI\u5229\u7528\u72b6\u6cc1',
  remoteCliStatus: 'SSH \u63a5\u7d9a\u5148 CLI',
  remoteCliPending: '\u30ea\u30e2\u30fc\u30c8\u63a5\u7d9a\u5f8c\u306b\u8868\u793a\u3057\u307e\u3059\u3002',
  cliAvailable: '\u5229\u7528\u53ef',
  cliMissing: '\u672a\u691c\u51fa',
  dragHint: '\u30ed\u30fc\u30ab\u30eb\u4e00\u89a7\u304b\u3089\u30c9\u30e9\u30c3\u30b0\u3059\u308b\u3068\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u3067\u304d\u307e\u3059\u3002',
  remoteList: '\u30ea\u30e2\u30fc\u30c8\u4e00\u89a7',
  remoteLoading: '\u30d5\u30a9\u30eb\u30c0\u5185\u5bb9\u3092\u8aad\u307f\u8fbc\u307f\u4e2d\u3067\u3059\u3002',
  remoteEmpty: '\u30ea\u30e2\u30fc\u30c8\u30ef\u30fc\u30af\u30b9\u30da\u30fc\u30b9\u3092\u9078\u629e\u3059\u308b\u3068\u5185\u5bb9\u304c\u8868\u793a\u3055\u308c\u307e\u3059\u3002',
  oneLevelUp: '\u4e00\u3064\u4e0a\u3078',
  createFolder: '\u30d5\u30a9\u30eb\u30c0\u4f5c\u6210',
  receive: '\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9',
  downloadCurrent: '\u3053\u3053\u3092\u30c0\u30a6\u30f3\u30ed\u30fc\u30c9',
  localPc: '\u30ed\u30fc\u30ab\u30ebPC\uff08\u3053\u306ePC\uff09',
  remotePc: '\u30ea\u30e2\u30fc\u30c8PC\uff08SSH\uff09',
  useWorkspace: '\u4f7f\u3046',
  sharedContext: '\u5171\u6709\u30b3\u30f3\u30c6\u30ad\u30b9\u30c8',
  sharedFrom: '\u5171\u6709\u5143',
  sharedTo: '\u5171\u6709\u5148',
  sharedFromPrefix: 'from :',
  sharedToPrefix: 'to :',
  noSharedContext: '\u5171\u6709\u6e08\u307f\u306e\u6587\u8108\u306f\u307e\u3060\u3042\u308a\u307e\u305b\u3093\u3002',
  selectedCount: '\u4ef6\u9078\u629e',
  runLogs: '\u5b9f\u884c\u30ed\u30b0',
  runLogsEmpty: '\u307e\u3060\u5b9f\u884c\u30ed\u30b0\u306f\u3042\u308a\u307e\u305b\u3093\u3002',
  session: '\u30bb\u30c3\u30b7\u30e7\u30f3',
  sessions: '\u30bb\u30c3\u30b7\u30e7\u30f3',
  stream: '\u30b9\u30c8\u30ea\u30fc\u30e0',
  conversation: '\u4f1a\u8a71\u5c65\u6b74',
  embeddedTerminal: '\u7c21\u6613\u5185\u8535\u30bf\u30fc\u30df\u30ca\u30eb',
  fastMode: 'Fast\u30e2\u30fc\u30c9',
  fastOff: '\u901a\u5e38',
  fastOn: '\u6709\u52b9 (/fast)',
  shareHint: '\u4e00\u56de\u5171\u6709\u306e\u30dc\u30bf\u30f3\u306f\u6b21\u56de\u306e\u5b9f\u884c1\u56de\u3060\u3051\u306b\u53cd\u6620\u3057\u307e\u3059\u3002\u300c\u5b8c\u4e86\u6642\u300d\u3092 ON \u306b\u3059\u308b\u3068\u3001\u5b8c\u4e86\u306e\u305f\u3073\u306b\u6700\u65b0\u7d50\u679c\u3092\u5171\u6709\u3057\u7d9a\u3051\u307e\u3059\u3002\u4e00\u56de\u5171\u6709\u306f\u4f7f\u308f\u308c\u308b\u3068\u81ea\u52d5\u3067\u6d88\u8cbb\u3055\u308c\u3001\u4f7f\u3046\u524d\u306b\u3082\u3046\u4e00\u5ea6\u62bc\u3059\u3068\u53d6\u308a\u6d88\u305b\u307e\u3059\u3002',
  shellExpand: '\u7c21\u6613\u5185\u8535\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u62e1\u5927',
  terminalPlaceholder: '\u3053\u3053\u3067 cd / ping / git / npm / ssh \u7d4c\u7531\u306e\u30ea\u30e2\u30fc\u30c8\u5b9f\u884c\u3092\u6271\u3048\u307e\u3059\u3002',
  terminalPromptPlaceholder: '',
  terminalRun: '\u30b3\u30de\u30f3\u30c9\u5b9f\u884c',
  terminalClear: '\u30af\u30ea\u30a2',
  terminalStop: '\u505c\u6b62',
  terminalExternal: '\u5916\u90e8\u30bf\u30fc\u30df\u30ca\u30eb\u3092\u8a66\u3059',
  terminalPath: '\u73fe\u5728\u30d1\u30b9',
  workspaceTop: '\u30c8\u30c3\u30d7\u3078',
  backToTop: '\u30c8\u30c3\u30d7\u306b\u623b\u308b',
  close: '\u9589\u3058\u308b'
} as const

const LOCAL_DRAG_MIME = 'application/x-multi-turtle-local-path'
const REMOTE_PROVIDER_ORDER: ProviderId[] = ['codex', 'gemini', 'copilot']
function formatClock(timestamp: number | null): string {
  if (!timestamp) {
    return UI.notRun
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

function appendInlineShellOutput(existing: string, prompt: string): string {
  const nextLine = prompt.replace(/\r/g, '').replace(/\n$/, '')
  if (!existing) {
    return nextLine
  }

  const nextOutput = `${existing}\n${nextLine}`
  return nextOutput.length <= 48_000 ? nextOutput : `${nextOutput.slice(0, 48_000).trimEnd()}\n\n[truncated]`
}

function hasCurrentSessionContent(pane: PaneState): boolean {
  return (
    pane.logs.length > 0 ||
    pane.streamEntries.length > 0 ||
    Boolean(pane.sessionId) ||
    Boolean(pane.lastResponse?.trim()) ||
    Boolean(pane.liveOutput.trim())
  )
}

function normalizeWindowsPath(path: string): string {
  return path.replace(/[\\/]+$/, '').replace(/\//g, '\\')
}

function getLocalParentPath(currentPath: string, workspaceRoot: string): string | null {
  const current = normalizeWindowsPath(currentPath)
  const root = normalizeWindowsPath(workspaceRoot)
  if (!current || !root || current.toLowerCase() === root.toLowerCase()) {
    return null
  }

  const segments = current.split('\\')
  if (segments.length <= 1) {
    return null
  }

  segments.pop()
  let parent = segments.join('\\')
  if (/^[A-Za-z]:$/.test(parent)) {
    parent += '\\'
  }

  return parent.toLowerCase().startsWith(root.toLowerCase()) ? parent : root
}

function normalizePosixPath(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized || '/'
}

function getRemoteParentPath(currentPath: string, workspaceRoot: string): string | null {
  const current = normalizePosixPath(currentPath)
  const root = normalizePosixPath(workspaceRoot)
  if (!current || !root || current === root) {
    return null
  }

  const segments = current.split('/').filter(Boolean)
  if (segments.length === 0) {
    return null
  }

  segments.pop()
  const parent = segments.length > 0 ? `/${segments.join('/')}` : '/'
  if (root === '/') {
    return parent
  }

  return parent === root || parent.startsWith(`${root}/`) ? parent : root
}

function formatRemoteHostLabel(host: string, username: string): string {
  if (!host) {
    return 'ssh'
  }

  if (!username || host.includes('@')) {
    return host
  }

  return `${username}@${host}`
}

function formatRemoteShellPath(currentPath: string, homeDirectory: string | null): string {
  const normalizedCurrent = normalizePosixPath(currentPath || '~')
  if (!homeDirectory) {
    return normalizedCurrent
  }

  const normalizedHome = normalizePosixPath(homeDirectory)
  if (normalizedCurrent === normalizedHome) {
    return '~'
  }

  if (normalizedCurrent.startsWith(`${normalizedHome}/`)) {
    return `~${normalizedCurrent.slice(normalizedHome.length)}`
  }

  return normalizedCurrent
}

function readDraggedLocalPath(event: ReactDragEvent<HTMLElement>): string {
  return event.dataTransfer.getData(LOCAL_DRAG_MIME).trim()
}

function isLocalDevEnvironment(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
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
  onShareToPane,
  onCopyOutput,
  onCopyProviderCommand,
  onDuplicate,
  onStartNewSession,
  onDelete,
  onLoadRemote,
  onBrowseRemote,
  onCreateRemoteDirectory,
  onOpenFileManager,
  onOpenWorkspace,
  onRunShell,
  onOpenPath,
  onAddLocalWorkspace,
  onOpenRemoteWorkspacePicker,
  onSelectLocalWorkspace,
  onRemoveLocalWorkspace,
  onBrowseLocal,
  onGenerateSshKey,
  onDeleteSshKey,
  onInstallSshPublicKey,
  onRemoveKnownHost,
  onTransferSshPath,
  shareTargets,
  onSelectSession
}: TerminalPaneProps) {
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const [isRunLogsExpanded, setIsRunLogsExpanded] = useState(false)
  const [isShellExpanded, setIsShellExpanded] = useState(false)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isVersionAccordionOpen, setIsVersionAccordionOpen] = useState(false)
  const [isPasswordPulseActive, setIsPasswordPulseActive] = useState(false)
  const [remoteDropTarget, setRemoteDropTarget] = useState<string | null>(null)
  const menuRef = useRef<HTMLDetailsElement | null>(null)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const shellInputRef = useRef<HTMLInputElement | null>(null)
  const shellModalInputRef = useRef<HTMLInputElement | null>(null)
  const shellConsoleRef = useRef<HTMLDivElement | null>(null)
  const shellModalConsoleRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        if (menuRef.current) {
          menuRef.current.open = false
        }
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [isMenuOpen])

  useEffect(() => {
    const element = promptRef.current
    if (!element) {
      return
    }

    element.style.height = '0px'
    const nextHeight = Math.min(Math.max(element.scrollHeight, 118), 220)
    element.style.height = `${nextHeight}px`
    element.style.overflowY = element.scrollHeight > 220 ? 'auto' : 'hidden'
  }, [pane.prompt])



  useEffect(() => {
    const elements = [shellConsoleRef.current, shellModalConsoleRef.current].filter(Boolean) as HTMLDivElement[]
    for (const element of elements) {
      element.scrollTop = element.scrollHeight
    }
  }, [pane.shellOutput, pane.shellCommand, isShellExpanded])

  useEffect(() => {
    if (!pane.sshPasswordPulseAt) {
      return
    }

    setIsPasswordPulseActive(true)
    const timer = window.setTimeout(() => {
      setIsPasswordPulseActive(false)
    }, 1500)

    return () => {
      window.clearTimeout(timer)
    }
  }, [pane.sshPasswordPulseAt])

  useEffect(() => {
    if (pane.sshPassword.trim()) {
      setIsPasswordPulseActive(false)
    }
  }, [pane.sshPassword])

  useEffect(() => {
    if (pane.shellRunning) {
      return
    }

    const target = isShellExpanded ? shellModalInputRef.current : shellInputRef.current
    target?.focus()
  }, [pane.shellRunning, pane.shellOpen, isShellExpanded])

  const catalog = catalogs[pane.provider]
  const currentModel = catalog?.models.find((model) => model.id === pane.model) ?? catalog?.models[0]
  const reasoningOptions = currentModel?.supportedReasoningEfforts ?? []
  const canSelectReasoning = reasoningOptions.length > 0
  const isRemoteConnected = Boolean(pane.sshHost.trim() && (pane.remoteBrowserPath.trim() || pane.remoteHomeDirectory))
  const availableRemoteProviders = isRemoteConnected ? pane.remoteAvailableProviders : (['codex', 'copilot', 'gemini'] as ProviderId[])
  const selectedLocalWorkspace = localWorkspaces.find((workspace) => workspace.path === pane.localWorkspacePath)
  const canRemoveLocalWorkspace = selectedLocalWorkspace?.source === 'manual'
  const isProviderUpdating = pane.status === 'updating'
  const isRunInProgress = pane.status === 'running'
  const isBusy = isRunInProgress || isProviderUpdating
  const isStalled = pane.status === 'running' && pane.lastActivityAt !== null && now - pane.lastActivityAt > 45_000
  const canRun = pane.prompt.trim().length > 0 && (pane.workspaceMode === 'local' ? pane.localWorkspacePath.trim().length > 0 : pane.sshHost.trim().length > 0 && pane.remoteWorkspacePath.trim().length > 0)
  const outputText = getOutputText(pane)
  const hasOutput = outputText.trim().length > 0
  const matchedSshHost = sshHosts.find((item) => item.alias === pane.sshHost.trim()) ?? null
  const currentShellPath = pane.workspaceMode === 'local' ? (pane.localShellPath || pane.localWorkspacePath) : (pane.remoteShellPath || pane.remoteWorkspacePath)
  const shellPromptLabel = pane.workspaceMode === 'local'
    ? `${currentShellPath || '~'}>`
    : `${formatRemoteHostLabel(pane.sshHost.trim(), pane.sshUser.trim() || matchedSshHost?.user || '')}:${formatRemoteShellPath(currentShellPath || pane.remoteHomeDirectory || '~', pane.remoteHomeDirectory)}$`
  const canRunShell = pane.shellCommand.trim().length > 0 && (pane.workspaceMode === 'local' ? currentShellPath.trim().length > 0 : Boolean(pane.sshHost.trim() && currentShellPath.trim()))
  const localParentPath = useMemo(() => getLocalParentPath(pane.localBrowserPath || pane.localWorkspacePath, pane.localWorkspacePath), [pane.localBrowserPath, pane.localWorkspacePath])
  const isAtLocalWorkspaceTop = normalizeWindowsPath(pane.localBrowserPath || pane.localWorkspacePath) === normalizeWindowsPath(pane.localWorkspacePath)
  const remoteParentPath = useMemo(
    () => (pane.remoteWorkspacePath ? getRemoteParentPath(pane.remoteBrowserPath || pane.remoteWorkspacePath, pane.remoteWorkspacePath) : null),
    [pane.remoteBrowserPath, pane.remoteWorkspacePath]
  )
  const isAtRemoteWorkspaceTop = pane.remoteWorkspacePath
    ? normalizePosixPath(pane.remoteBrowserPath || pane.remoteWorkspacePath) === normalizePosixPath(pane.remoteWorkspacePath)
    : true
  const sshDisplayName = pane.sshUser.trim() ? `${pane.sshUser.trim()}@${pane.sshHost.trim()}` : pane.sshHost.trim()
  const workspaceLabel = pane.workspaceMode === 'local' ? selectedLocalWorkspace?.label ?? getShortPathLabel(pane.localWorkspacePath || UI.unselected) : pane.remoteWorkspacePath ? getShortPathLabel(pane.remoteWorkspacePath) : sshDisplayName || UI.sshUnset
  const currentSessionAvailable = hasCurrentSessionContent(pane)
  const fallbackArchivedSession = !currentSessionAvailable ? pane.sessionHistory[0] ?? null : null
  const selectedArchivedSession = pane.selectedSessionKey ? pane.sessionHistory.find((session) => session.key === pane.selectedSessionKey) ?? fallbackArchivedSession : fallbackArchivedSession
  const visibleSession = selectedArchivedSession
    ? { key: selectedArchivedSession.key, label: selectedArchivedSession.label, logs: selectedArchivedSession.logs, streamEntries: selectedArchivedSession.streamEntries, updatedAt: selectedArchivedSession.updatedAt, status: selectedArchivedSession.status }
    : { key: null, label: pane.sessionId ? `${UI.currentPrefix}${pane.sessionId.slice(0, 8)}` : UI.currentSession, logs: pane.logs, streamEntries: pane.streamEntries, updatedAt: pane.lastActivityAt ?? pane.lastRunAt, status: pane.status }
  const sessionOptions = [
    ...(currentSessionAvailable ? [{ key: '__current__', label: pane.sessionId ? `${UI.currentPrefix}${pane.sessionId.slice(0, 8)}` : UI.currentSession }] : []),
    ...pane.sessionHistory.map((session) => ({ key: session.key, label: session.label }))
  ]
  const hasSessionRecords = sessionOptions.length > 0
  const incomingShareSources = useMemo(() => {
    const sourceMap = new Map<string, { id: string; title: string; count: number }>()

    for (const item of sharedContext) {
      if (!item.targetPaneIds.includes(pane.id)) {
        continue
      }

      const existing = sourceMap.get(item.sourcePaneId)
      if (existing) {
        existing.count += 1
        continue
      }

      sourceMap.set(item.sourcePaneId, {
        id: item.sourcePaneId,
        title: item.sourcePaneTitle,
        count: 1
      })
    }

    return Array.from(sourceMap.values())
  }, [pane.id, sharedContext])
  const remoteWorkspaceBrowserPath = pane.remoteWorkspacePath ? (pane.remoteBrowserPath || pane.remoteWorkspacePath) : ''
  const remoteBaseDropPath = remoteWorkspaceBrowserPath
  const currentRemoteLabel = getShortPathLabel(remoteWorkspaceBrowserPath || pane.remoteWorkspacePath || '')
  const outgoingShareContexts = sharedContext.filter((item) => item.sourcePaneId === pane.id && item.targetPaneIds.length > 0)
  const outgoingShareTargets = useMemo(() => {
    const targetMap = new Map<string, { id: string; title: string; count: number }>()

    for (const item of outgoingShareContexts) {
      for (const [index, targetPaneId] of item.targetPaneIds.entries()) {
        const fallbackTitle = shareTargets.find((target) => target.id === targetPaneId)?.title ?? targetPaneId
        const nextTitle = item.targetPaneTitles[index] || fallbackTitle
        const existing = targetMap.get(targetPaneId)
        if (existing) {
          existing.count += 1
          continue
        }

        targetMap.set(targetPaneId, {
          id: targetPaneId,
          title: nextTitle,
          count: 1
        })
      }
    }

    return Array.from(targetMap.values())
  }, [outgoingShareContexts, shareTargets])
  const materializedGlobalShare = outgoingShareContexts.find((item) => item.scope === 'global') ?? null
  const isGlobalShareActive = Boolean(materializedGlobalShare) || pane.pendingShareGlobal
  const activeShareTargetIds = new Set(outgoingShareContexts.flatMap((item) => item.targetPaneIds))
  if (pane.pendingShareGlobal) {
    for (const target of shareTargets) {
      activeShareTargetIds.add(target.id)
    }
  }
  for (const targetPaneId of pane.pendingShareTargetIds) {
    activeShareTargetIds.add(targetPaneId)
  }
  const hasOutgoingShare = outgoingShareContexts.length > 0 || pane.pendingShareGlobal || pane.pendingShareTargetIds.length > 0
  const versionInfo = catalog?.versionInfo
  const providerRollbackCommand = versionInfo?.installedVersion ? `npm install -g ${versionInfo.packageName}@${versionInfo.installedVersion}` : null
  const providerVersionStatus = !versionInfo?.latestVersion
    ? 'unknown'
    : versionInfo.updateAvailable
      ? 'outdated'
      : 'current'
  const providerVersionSummaryLabel = providerVersionStatus === 'outdated'
    ? UI.updateCliSummaryOutdated
    : providerVersionStatus === 'current'
      ? UI.updateCliSummaryCurrent
      : UI.updateCliSummaryUnknown
  const providerVersionSummaryValue = providerVersionStatus === 'outdated'
    ? `${versionInfo?.installedVersion ?? UI.versionUnknown} -> ${versionInfo?.latestVersion ?? UI.versionUnknown}`
    : providerVersionStatus === 'current'
      ? `${versionInfo?.installedVersion ?? UI.versionUnknown}`
      : `${versionInfo?.installedVersion ?? UI.versionUnknown} / ${UI.versionStatusUnknown}`
  const effectiveIdentityFile = pane.sshSelectedKeyPath.trim() || pane.sshIdentityFile.trim() || matchedSshHost?.identityFile || ''
  const sshKeyLabel = getShortPathLabel(effectiveIdentityFile)
  const localCliStates = REMOTE_PROVIDER_ORDER.map((provider) => ({
    provider,
    installed: Boolean(catalogs[provider]?.available)
  }))
  const remoteCliStates = REMOTE_PROVIDER_ORDER.map((provider) => ({
    provider,
    installed: pane.remoteAvailableProviders.includes(provider)
  }))
  const currentCliStates = pane.workspaceMode === 'local' ? localCliStates : remoteCliStates
  const currentCliEnvironmentLabel = pane.workspaceMode === 'local' ? 'ローカル' : 'リモート'
  const hasRemoteConfiguration = Boolean(
    pane.sshHost.trim() ||
    pane.sshUser.trim() ||
    pane.sshPort.trim() ||
    pane.sshPassword.trim() ||
    pane.sshIdentityFile.trim() ||
    pane.sshSelectedKeyPath.trim() ||
    pane.remoteWorkspacePath.trim()
  )
  const localSettingsStatus = catalog?.available ? 'ok' : 'ng'
  const remoteSettingsStatus = isRemoteConnected && pane.remoteAvailableProviders.includes(pane.provider) ? 'ok' : 'ng'
  const localWorkspaceStatus = pane.localWorkspacePath.trim() ? 'ok' : 'pending'
  const remoteWorkspaceStatus = pane.sshHost.trim() && pane.remoteWorkspacePath.trim() ? 'ok' : 'pending'
  const currentWorkspaceStatus = pane.workspaceMode === 'local' ? localWorkspaceStatus : remoteWorkspaceStatus
  const currentWorkspaceStatusLabel = pane.workspaceMode === 'local'
    ? `ローカル ${currentWorkspaceStatus === 'ok' ? 'OK' : '未設定'}`
    : `リモート ${currentWorkspaceStatus === 'ok' ? 'OK' : '未設定'}`
  const connectionSettingsStatus = pane.sshHost.trim() ? 'ok' : 'pending'
  const connectionSettingsLabel = connectionSettingsStatus === 'ok' ? UI.connectionConfigured : UI.connectionUnconfigured
  const sshDiagnosticsStatus = !isRemoteConnected && pane.sshDiagnostics.length === 0
    ? 'pending'
    : pane.sshActionState === 'error' || pane.sshDiagnostics.some((item) => /\u898b\u3064\u304b\u308a\u307e\u305b\u3093|\u5931\u6557|\u5fc5\u8981|\u53ef\u80fd\u6027\u304c\u3042\u308a\u307e\u3059|error|failed|timed out/i.test(item))
      ? 'ng'
      : 'ok'
  const sshDiagnosticsLabel = sshDiagnosticsStatus === 'ok'
    ? UI.diagnosticsOk
    : sshDiagnosticsStatus === 'ng'
      ? UI.diagnosticsNg
      : UI.diagnosticsPending
  const sshKeySelectValue = pane.sshSelectedKeyPath || effectiveIdentityFile
  const hasSelectableSshKeys = pane.sshLocalKeys.length > 0 || Boolean(effectiveIdentityFile)

  useEffect(() => {
    setIsVersionAccordionOpen(providerVersionStatus === 'outdated')
  }, [pane.provider, providerVersionStatus])

  useEffect(() => {
    if (!isLocalDevEnvironment() || !isMenuOpen) {
      return
    }

    console.log('[share-menu-state]', {
      paneId: pane.id,
      activeGlobalShare: isGlobalShareActive,
      activeTargetPaneIds: Array.from(activeShareTargetIds),
      pendingShareGlobal: pane.pendingShareGlobal,
      pendingShareTargetIds: pane.pendingShareTargetIds,
      outgoingShareContexts: outgoingShareContexts.map((item) => ({
        id: item.id,
        scope: item.scope,
        targetPaneIds: item.targetPaneIds
      }))
    })
  }, [activeShareTargetIds, isGlobalShareActive, isMenuOpen, outgoingShareContexts, pane.id, pane.pendingShareGlobal, pane.pendingShareTargetIds])

  const updateShellCommand = (value: string) => {
    onUpdate(pane.id, { shellCommand: value, shellHistoryIndex: null })
  }

  const toggleAutoShareTarget = (targetPaneId: string, enabled: boolean) => {
    const nextTargetIds = enabled
      ? [...pane.autoShareTargetIds.filter((item) => item !== targetPaneId), targetPaneId]
      : pane.autoShareTargetIds.filter((item) => item !== targetPaneId)
    onUpdate(pane.id, { autoShareTargetIds: nextTargetIds })
  }

  const handleShellKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && !pane.shellRunning) {
      event.preventDefault()
      onUpdate(pane.id, {
        shellCommand: '',
        shellHistoryIndex: null,
        shellOutput: appendInlineShellOutput(pane.shellOutput, shellPromptLabel)
      })
      window.requestAnimationFrame(() => {
        const target = isShellExpanded ? shellModalInputRef.current : shellInputRef.current
        target?.focus()
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (pane.shellHistory.length === 0) {
        return
      }

      const nextIndex = pane.shellHistoryIndex === null
        ? pane.shellHistory.length - 1
        : Math.max(0, pane.shellHistoryIndex - 1)
      onUpdate(pane.id, {
        shellHistoryIndex: nextIndex,
        shellCommand: pane.shellHistory[nextIndex] ?? ''
      })
      return
    }

    if (event.key === 'ArrowDown') {
      if (pane.shellHistory.length === 0) {
        return
      }

      event.preventDefault()
      if (pane.shellHistoryIndex === null) {
        return
      }

      const nextIndex = pane.shellHistoryIndex + 1
      if (nextIndex >= pane.shellHistory.length) {
        onUpdate(pane.id, { shellHistoryIndex: null, shellCommand: '' })
        return
      }

      onUpdate(pane.id, {
        shellHistoryIndex: nextIndex,
        shellCommand: pane.shellHistory[nextIndex] ?? ''
      })
      return
    }

    if (event.key === 'Enter' && canRunShell && !pane.shellRunning) {
      event.preventDefault()
      onRunShell(pane.id)
    }
  }

  const startLocalDrag = (event: ReactDragEvent<HTMLElement>, path: string) => {
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData(LOCAL_DRAG_MIME, path)
    event.dataTransfer.setData('text/plain', path)
  }

  const allowRemoteDrop = (event: ReactDragEvent<HTMLElement>, targetPath: string) => {
    if (!readDraggedLocalPath(event)) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setRemoteDropTarget(targetPath)
  }

  const clearRemoteDrop = () => {
    setRemoteDropTarget(null)
  }

  const handleRemoteDrop = (event: ReactDragEvent<HTMLElement>, targetPath: string) => {
    const localPath = readDraggedLocalPath(event)
    if (!localPath) {
      return
    }

    event.preventDefault()
    setRemoteDropTarget(null)
    onTransferSshPath(pane.id, 'upload', { localPath, remotePath: targetPath })
  }

  const handleDelete = () => {
    if (window.confirm(UI.deleteConfirm)) {
      onDelete(pane.id)
    }
  }
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
              <input className="pane-title-input" value={pane.title} onChange={(event) => onUpdate(pane.id, { title: event.target.value })} />
              <p>{pane.statusText}</p>
            </div>
          </div>

          <div className="pane-header-actions pane-action-stack">
            <div className="pane-action-row icon-row">
              <button type="button" className="icon-button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} title={UI.backToTop}><ArrowUp size={16} /></button>
                            <details className="pane-menu" ref={menuRef} open={isMenuOpen} onToggle={(event) => setIsMenuOpen((event.currentTarget as HTMLDetailsElement).open)}>
                <summary className={hasOutgoingShare ? 'icon-button share-active' : 'icon-button'} aria-label={UI.paneMenu}>
                  <Share2 size={16} />
                </summary>
                <div className="pane-menu-surface share-menu-surface">
                  <div className="share-target-row">
                    <button type="button" aria-pressed={isGlobalShareActive} className={isGlobalShareActive ? 'menu-action compact-menu-action share-action-button is-sharing is-active' : 'menu-action compact-menu-action share-action-button'} onClick={() => onShare(pane.id)}><Share2 size={15} />{UI.shareGlobal}</button>
                    <label className={pane.autoShare ? 'menu-toggle share-checkbox compact-share-checkbox is-active' : 'menu-toggle share-checkbox compact-share-checkbox'}>
                      <input type="checkbox" checked={pane.autoShare} onChange={(event) => onUpdate(pane.id, { autoShare: event.target.checked })} />
                      <span>{UI.autoShareShort}</span>
                    </label>
                  </div>
                  {shareTargets.length > 0 && (
                    <div className="menu-share-group">
                      <span className="menu-section-label">{UI.shareDirect}</span>
                      <div className="menu-share-targets">
                        {shareTargets.map((target) => {
                          const isTargetActive = activeShareTargetIds.has(target.id)
                          const isAutoShareEnabled = pane.autoShareTargetIds.includes(target.id)
                          return (
                            <div key={target.id} className="share-target-row">
                              <button type="button" aria-pressed={isTargetActive} className={isTargetActive ? 'menu-action compact-menu-action share-action-button is-sharing is-active' : 'menu-action compact-menu-action share-action-button'} onClick={() => onShareToPane(pane.id, target.id)}>
                                <Share2 size={14} />
                                {target.title}
                              </button>
                              <label className={isAutoShareEnabled ? 'menu-toggle share-checkbox compact-share-checkbox is-active' : 'menu-toggle share-checkbox compact-share-checkbox'}>
                                <input type="checkbox" checked={isAutoShareEnabled} onChange={(event) => toggleAutoShareTarget(target.id, event.target.checked)} />
                                <span>{UI.autoShareShort}</span>
                              </label>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  <p className="menu-help">{UI.shareHint}</p>
                </div>
              </details>
              <button type="button" className="icon-button" disabled={!hasSessionRecords} onClick={() => setIsRunLogsExpanded(true)} title={UI.runLogs}><History size={16} /></button>
              <button type="button" className="icon-button danger" onClick={handleDelete} title={UI.deletePane}><Trash2 size={16} /></button>
            </div>

            <div className="pane-action-row launch-row">
              <button type="button" className="secondary-button pane-session-button" disabled={isBusy} onClick={() => onStartNewSession(pane.id)}><RefreshCcw size={16} />{UI.newSession}</button>
              <button type="button" className="secondary-button pane-vscode-button" disabled={isBusy} onClick={() => onDuplicate(pane.id)}><Copy size={16} />{UI.duplicatePane}</button>
              <button type="button" className="secondary-button pane-vscode-button" disabled={pane.workspaceMode !== 'local' || !pane.localWorkspacePath} onClick={() => onOpenFileManager(pane.id)}><Folder size={16} />{UI.openExplorer}</button>
              <button type="button" className="secondary-button pane-vscode-button" disabled={pane.workspaceMode === 'local' ? !pane.localWorkspacePath : !pane.sshHost || !pane.remoteWorkspacePath} onClick={() => onOpenWorkspace(pane.id)}><FolderOpen size={16} />{UI.openVsCode}</button>
            </div>
          </div>
        </header>

        <div className="status-strip compact">
          <span className="tiny-badge">{catalog?.label ?? pane.provider}</span>
          <span className="tiny-badge">{currentModel?.name ?? pane.model}</span>
          <span className="tiny-badge">{pane.workspaceMode === 'local' ? UI.localPc : UI.remotePc}</span>
          <span className="tiny-badge">{workspaceLabel}</span>
          <span className={isStalled ? 'tiny-badge warning' : 'tiny-badge'}>{isRunInProgress ? `\u5b9f\u884c ${formatElapsed(pane.runningSince, now)}` : isProviderUpdating ? `\u66f4\u65b0 ${formatElapsed(pane.runningSince, now)}` : `\u6700\u7d42 ${formatClock(pane.lastRunAt)}`}</span>
        </div>

        <section className="primary-panel output-panel">
          <div className="panel-header slim">
            <div>
              <h3>{UI.output}</h3>
              {hasOutput && pane.lastActivityAt ? <p>{`\u6700\u7d42\u66f4\u65b0 ${formatClock(pane.lastActivityAt)}`}</p> : null}
            </div>
            <div className="output-panel-actions">
              {outgoingShareTargets.length > 0 && (
                <div className="share-flow-strip outgoing" aria-label={UI.sharedTo}>
                  {outgoingShareTargets.map((target) => (
                    <span key={target.id} className="share-flow-chip outgoing" title={`${UI.sharedTo}: ${target.title}`}>
                      <ArrowUpRight size={12} />
                      <span className="share-flow-chip-prefix">{UI.sharedToPrefix}</span>
                      <span className="share-flow-chip-label">{target.title}</span>
                      {target.count > 1 ? <span className="share-flow-chip-count">x{target.count}</span> : null}
                    </span>
                  ))}
                </div>
              )}
              {incomingShareSources.length > 0 && (
                <div className="share-flow-strip incoming" aria-label={UI.sharedFrom}>
                  {incomingShareSources.map((source) => (
                    <span key={source.id} className="share-flow-chip incoming" title={`${UI.sharedFrom}: ${source.title}`}>
                      <ArrowDownLeft size={12} />
                      <span className="share-flow-chip-prefix">{UI.sharedFromPrefix}</span>
                      <span className="share-flow-chip-label">{source.title}</span>
                      {source.count > 1 ? <span className="share-flow-chip-count">x{source.count}</span> : null}
                    </span>
                  ))}
                </div>
              )}
              <button type="button" className="icon-button" onClick={() => setIsOutputExpanded(true)} title={UI.outputExpand}><Maximize2 size={16} /></button>
            </div>
          </div>
          <div className="output-surface console-output" aria-label="output-console">
            {hasOutput ? <pre>{outputText}</pre> : <p className="panel-placeholder">{UI.outputPlaceholder}</p>}
          </div>
        </section>

        <section className="composer-panel minimal-composer">
          <div className="panel-header slim">
            <div>
              <h3>{UI.instruction}</h3>
              <p>{pane.workspaceMode === 'local' ? pane.localWorkspacePath || UI.workspaceUnset : pane.remoteWorkspacePath || UI.sshUnset}</p>
            </div>
          </div>
          <textarea
            ref={promptRef}
            value={pane.prompt}
            onChange={(event) => onUpdate(pane.id, { prompt: event.target.value })}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && canRun && !isBusy) {
                event.preventDefault()
                onRun(pane.id)
              }
            }}
            placeholder={UI.promptPlaceholder}
          />
          <div className="composer-footer">
            <div className="composer-hint">
              {isRunInProgress ? (
                <><LoaderCircle size={16} className="spin" /><span>{isStalled ? UI.stalledHint : UI.runningHint}</span></>
              ) : isProviderUpdating ? (
                <><LoaderCircle size={16} className="spin" /><span>{UI.updatingHint}</span></>
              ) : pane.lastError ? (
                <><AlertTriangle size={16} /><span>{pane.lastError}</span></>
              ) : (
                <span>{workspaceLabel}</span>
              )}
            </div>
            <div className="composer-actions">
              {isRunInProgress ? (
                <button type="button" className="danger-button stable-run-button" onClick={() => onStop(pane.id)}><Square size={16} />{UI.stop}</button>
              ) : (
                <button type="button" className="primary-button stable-run-button" disabled={!canRun || isProviderUpdating} onClick={() => onRun(pane.id)}><Play size={16} />{UI.run}</button>
              )}
            </div>
          </div>
        </section>

        <div className="pane-accordion-group">
          <details className="pane-accordion settings-accordion" open={pane.settingsOpen} onToggle={(event) => onUpdate(pane.id, { settingsOpen: (event.currentTarget as HTMLDetailsElement).open })}>
            <summary className="accordion-summary">
              <span className="accordion-label accordion-label-with-statuses">
                <span className="accordion-label-main"><Settings2 size={15} />{UI.settings}</span>
                <span className="settings-env-statuses">
                  <span className={`settings-env-chip ${localSettingsStatus}`}>{`ローカル ${localSettingsStatus === 'ok' ? 'OK' : 'NG'}`}</span>
                  {hasRemoteConfiguration ? <span className={`settings-env-chip ${remoteSettingsStatus}`}>{`リモート ${remoteSettingsStatus === 'ok' ? 'OK' : 'NG'}`}</span> : null}
                </span>
              </span>
              <span className="accordion-meta">
                <span className="accordion-value">{catalog?.label ?? pane.provider} / {currentModel?.name ?? pane.model}</span>
                <span className={`accordion-caret ${pane.settingsOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
              </span>
            </summary>
            <div className="accordion-body">
              <div className="pane-meta-grid compact-grid">
                <label>
                  <span>{UI.cli}</span>
                  <select value={pane.provider} onChange={(event) => onProviderChange(pane.id, event.target.value as ProviderId)}>
                    {(['codex', 'copilot', 'gemini'] as ProviderId[]).map((provider) => {
                      const item = catalogs[provider]
                      const disabled = pane.workspaceMode === 'ssh' && !availableRemoteProviders.includes(provider)
                      return <option key={provider} value={provider} disabled={disabled}>{item.label}{disabled ? ' (SSH unavailable)' : ''}</option>
                    })}
                  </select>
                </label>
                <label>
                  <span>{UI.model}</span>
                  <select value={pane.model} onChange={(event) => onModelChange(pane.id, event.target.value)}>
                    {catalog?.models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                  </select>
                </label>
                <label>
                  <span>{UI.reasoning}</span>
                  <select value={pane.reasoningEffort} disabled={!canSelectReasoning} onChange={(event) => onUpdate(pane.id, { reasoningEffort: event.target.value as PaneState['reasoningEffort'] })}>
                    {canSelectReasoning ? reasoningOptions.map((effort) => <option key={effort} value={effort}>{effort}</option>) : <option value={pane.reasoningEffort}>{UI.reasoningUnavailable}</option>}
                  </select>
                </label>
                <label>
                  <span>{UI.executionStyle}</span>
                  <select value={pane.autonomyMode} disabled={pane.provider === 'codex'} onChange={(event) => onUpdate(pane.id, { autonomyMode: event.target.value === 'max' ? 'max' : 'balanced' })}>
                    <option value="balanced">{UI.normal}</option>
                    <option value="max">{UI.active}</option>
                  </select>
                </label>
                <label>
                  <span>{UI.fastMode}</span>
                  <select value={pane.codexFastMode} disabled={pane.provider !== 'codex'} onChange={(event) => onUpdate(pane.id, { codexFastMode: event.target.value === 'fast' ? 'fast' : 'off' })}>
                    {pane.provider === 'codex' ? (
                      <>
                        <option value="off">{UI.fastOff}</option>
                        <option value="fast">{UI.fastOn}</option>
                      </>
                    ) : (
                      <option value="off">{UI.unchanged}</option>
                    )}
                  </select>
                </label>
                <div className="settings-action-field full-span settings-cli-availability">
                  <div className="settings-cli-availability-head">
                    <span className="settings-cli-availability-label">{UI.cliAvailability}</span>
                    <span className={`settings-env-chip ${pane.workspaceMode === 'local' ? localSettingsStatus : isRemoteConnected ? 'ok' : 'pending'}`}>{currentCliEnvironmentLabel}</span>
                  </div>
                  <div className="cli-provider-grid" aria-label={UI.cliAvailability}>
                    {currentCliStates.map(({ provider, installed }) => (
                      <div key={`${pane.id}-${pane.workspaceMode}-${provider}`} className={`cli-provider-card ${installed ? 'available' : 'unavailable'}`}>
                        <span className="cli-provider-icon" aria-hidden="true">{installed ? <CheckCircle2 size={15} /> : <X size={15} />}</span>
                        <span className="cli-provider-label">{catalogs[provider].label}</span>
                      </div>
                    ))}
                  </div>
                  {pane.workspaceMode === 'ssh' && !isRemoteConnected ? <p className="field-support-note">{UI.remoteCliPending}</p> : null}
                </div>
                <div className="settings-action-field full-span">
                  <span>{UI.updateCliField}</span>
                  <details className={`pane-accordion provider-version-accordion ${providerVersionStatus}`} open={isVersionAccordionOpen} onToggle={(event) => setIsVersionAccordionOpen((event.currentTarget as HTMLDetailsElement).open)}>
                    <summary className="accordion-summary provider-version-accordion-summary">
                      <span className="accordion-label"><RefreshCcw size={15} />{providerVersionSummaryLabel}</span>
                      <span className="accordion-meta">
                        <span className="accordion-value provider-version-summary-value">{providerVersionSummaryValue}</span>
                        <span className={`accordion-caret ${isVersionAccordionOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
                      </span>
                    </summary>
                    <div className="accordion-body provider-version-accordion-body">
                      <div className={`provider-version-card ${providerVersionStatus}`}>
                        <div className={`provider-version-status ${providerVersionStatus}`}>
                          {providerVersionStatus === 'outdated' ? UI.versionStatusOutdated : providerVersionStatus === 'current' ? UI.versionStatusCurrent : UI.versionStatusUnknown}
                        </div>
                        <div className="provider-version-grid">
                          <div className="provider-version-row"><span>{UI.versionCurrent}</span><strong>{versionInfo?.installedVersion ?? UI.versionUnknown}</strong></div>
                          <div className="provider-version-row"><span>{UI.versionLatest}</span><strong>{versionInfo?.latestVersion ?? UI.versionUnknown}</strong></div>
                        </div>
                        <div className="provider-version-command-block">
                          <div className="provider-version-command-head">
                            <span>{UI.versionCommand}</span>
                            <button type="button" className="secondary-button provider-command-copy-button" disabled={!versionInfo?.updateCommand} onClick={() => onCopyProviderCommand(pane.id, versionInfo?.updateCommand ?? '', '\u66f4\u65b0\u30b3\u30de\u30f3\u30c9\u3092\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f')}>
                              <Copy size={15} />{UI.copyCommand}
                            </button>
                          </div>
                          <input className="provider-version-command-input" type="text" readOnly spellCheck={false} value={versionInfo?.updateCommand ?? UI.versionUnknown} onFocus={(event) => event.currentTarget.select()} />
                        </div>
                        {providerRollbackCommand ? (
                          <div className="provider-version-command-block">
                            <div className="provider-version-command-head">
                              <span>{UI.rollbackCommand}</span>
                              <button type="button" className="secondary-button provider-command-copy-button" onClick={() => onCopyProviderCommand(pane.id, providerRollbackCommand, '\u30ed\u30fc\u30eb\u30d0\u30c3\u30af\u30b3\u30de\u30f3\u30c9\u3092\u30af\u30ea\u30c3\u30d7\u30dc\u30fc\u30c9\u306b\u30b3\u30d4\u30fc\u3057\u307e\u3057\u305f')}>
                                <Copy size={15} />{UI.copyCommand}
                              </button>
                            </div>
                            <input className="provider-version-command-input" type="text" readOnly spellCheck={false} value={providerRollbackCommand} onFocus={(event) => event.currentTarget.select()} />
                          </div>
                        ) : null}
                        {versionInfo?.latestCheckError ? <p className="provider-version-warning">{UI.versionCheckError}</p> : null}
                        <p className="provider-version-note">{UI.versionImpactNote}</p>
                        {providerVersionStatus === 'outdated' ? <p className="provider-version-warning">{UI.versionMismatchNote}</p> : null}
                        <p className="provider-version-note">{UI.versionNote}</p>
                        <p className="provider-version-note">{UI.commandSelectable}</p>
                      </div>
                    </div>
                  </details>
                </div>
              </div>
              <p className="field-note">{pane.provider === 'codex' ? UI.readonlyCodex : UI.styleHint}</p>
            </div>
          </details>
          <details className="pane-accordion workspace-accordion" open={pane.workspaceOpen} onToggle={(event) => onUpdate(pane.id, { workspaceOpen: (event.currentTarget as HTMLDetailsElement).open })}>
            <summary className="accordion-summary">
              <span className="accordion-label accordion-label-with-statuses">
                <span className="accordion-label-main"><FolderOpen size={15} />{UI.workspace}</span>
                <span className="settings-env-statuses">
                  <span className={`settings-env-chip ${currentWorkspaceStatus}`}>{currentWorkspaceStatusLabel}</span>
                </span>
              </span>
              <span className="accordion-meta">
                <span className="accordion-value">{workspaceLabel}</span>
                <span className={`accordion-caret ${pane.workspaceOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
              </span>
            </summary>
            <div className="accordion-body">
              <div className="workspace-switch compact-switch">
                <button type="button" className={pane.workspaceMode === 'local' ? 'switch-button active' : 'switch-button'} onClick={() => onUpdate(pane.id, { workspaceMode: 'local' })}>{UI.localPc}</button>
                <button type="button" className={pane.workspaceMode === 'ssh' ? 'switch-button active' : 'switch-button'} onClick={() => onUpdate(pane.id, { workspaceMode: 'ssh' })}>{UI.remotePc}</button>
              </div>

              {pane.workspaceMode === 'local' ? (
                <div className="workspace-stack">
                  <div className="workspace-primary-action">
                    <button type="button" className="primary-button workspace-choose-button" onClick={() => onAddLocalWorkspace(pane.id)}><FolderPlus size={16} />{UI.chooseWorkspace}</button>
                  </div>
                  <div className="workspace-current">
                    <span className="workspace-caption">{UI.currentWorkspace}</span>
                    <strong>{selectedLocalWorkspace?.label ?? getShortPathLabel(pane.localWorkspacePath || UI.unselected)}</strong>
                    <span>{pane.localWorkspacePath || UI.browseEmpty}</span>
                  </div>
                  {canRemoveLocalWorkspace && (
                    <div className="inline-actions wrap-actions compact-utility-row workspace-secondary-actions">
                      <button type="button" className="danger-button" onClick={() => onRemoveLocalWorkspace(pane.id)}><Trash2 size={16} />{UI.removeFromList}</button>
                    </div>
                  )}
                  {localWorkspaces.length > 1 && (
                    <label>
                      <span>{UI.savedWorkspaces}</span>
                      <select value={pane.localWorkspacePath} onChange={(event) => onSelectLocalWorkspace(pane.id, event.target.value)}>
                        {localWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.path}>{workspace.label}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="browser-panel workspace-browser-shell">
                    <div className="section-headline compact-headline browser-headline">
                      <div><strong>{UI.folderContents}</strong><span className="browser-current-path">{getShortPathLabel(pane.localBrowserPath || pane.localWorkspacePath || '')}</span></div>
                      <div className="browser-toolbar-actions">
                        {!isAtLocalWorkspaceTop && <button type="button" className="ghost-button compact-ghost" onClick={() => onBrowseLocal(pane.id, pane.localWorkspacePath)}><Home size={14} />{UI.workspaceTop}</button>}
                        {localParentPath && <button type="button" className="ghost-button compact-ghost" onClick={() => onBrowseLocal(pane.id, localParentPath)}><ChevronLeft size={14} />{UI.oneLevelUp}</button>}
                      </div>
                    </div>
                    <div className="browser-simple-list browser-list-shell">
                      {pane.localBrowserEntries.length > 0 ? (
                        pane.localBrowserEntries.map((entry) => (
                          <div key={entry.path} className={`browser-row ${entry.isDirectory ? 'directory' : 'file'}`}>
                            <button type="button" draggable className="browser-row-main browser-simple-item" onDragStart={(event) => startLocalDrag(event, entry.path)} onClick={() => entry.isDirectory ? onBrowseLocal(pane.id, entry.path) : onOpenPath(pane.id, entry.path, 'file')}>
                              <span className="browser-row-icon">{entry.isDirectory ? <Folder size={16} /> : <FileText size={16} />}</span>
                              <span className="browser-row-label">{entry.label}</span>
                            </button>
                          </div>
                        ))
                      ) : <div className="panel-placeholder browser-placeholder">{pane.localBrowserLoading ? UI.browseLoading : UI.browseEmpty}</div>}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="workspace-stack ssh-stack compact-ssh-stack">
                  <details className="ssh-mini-accordion ssh-connection-accordion">
                    <summary className="ssh-mini-summary">
                      <span className="ssh-mini-summary-row">
                        <span className="ssh-summary-inline">
                          <span>{UI.connectionSettings}</span>
                          <span className={`ssh-panel-chip ${connectionSettingsStatus}`}>{connectionSettingsLabel}</span>
                        </span>
                        <span className="ssh-mini-caret"><ChevronDown size={14} /></span>
                      </span>
                    </summary>
                    <div className="ssh-mini-body ssh-connection-body">
                      <div className="ssh-settings-section">
                        <div className="ssh-settings-section-title">{UI.connectionInfo}</div>
                        <div className="pane-meta-grid compact-grid ssh-config-grid ssh-settings-grid">
                          <label className="full-span">
                            <span>SSH Host / IP<span className="required-mark">*</span></span>
                            <input list={`ssh-hosts-${pane.id}`} value={pane.sshHost} onChange={(event) => onUpdate(pane.id, { sshHost: event.target.value })} placeholder="server.example.com / 192.168.1.20 / ssh-config host" />
                            <datalist id={`ssh-hosts-${pane.id}`}>{sshHosts.map((host) => <option key={host.id} value={host.alias} />)}</datalist>
                          </label>
                          <label>
                            <span>User</span>
                            <input value={pane.sshUser} onChange={(event) => onUpdate(pane.id, { sshUser: event.target.value })} placeholder="yourusername / ubuntu" />
                          </label>
                          <label>
                            <span>Port</span>
                            <input value={pane.sshPort} onChange={(event) => onUpdate(pane.id, { sshPort: event.target.value })} placeholder="22" />
                          </label>
                          <p className="field-support-note ssh-inline-note ssh-inline-note-nowrap">{UI.userHint}</p>
                          <label className={`full-span ssh-password-field ${isPasswordPulseActive ? 'is-attention' : ''}`}>
                            <span>Password</span>
                            <input type="password" aria-invalid={isPasswordPulseActive} value={pane.sshPassword} onChange={(event) => onUpdate(pane.id, { sshPassword: event.target.value, sshPasswordPulseAt: 0 })} placeholder="optional" />
                            <small className="field-support-note">{UI.passwordHint}</small>
                          </label>
                        </div>
                      </div>

                      <div className="ssh-settings-section">
                        <div className="ssh-settings-section-title">{UI.keySettings}</div>
                        <div className="pane-meta-grid compact-grid ssh-config-grid ssh-settings-grid">
                          <label>
                            <span>{UI.keyFileName}</span>
                            <input value={pane.sshKeyName} onChange={(event) => onUpdate(pane.id, { sshKeyName: event.target.value })} placeholder="id_ed25519-raspi" />
                          </label>
                          <label>
                            <span>{UI.keyComment}</span>
                            <input value={pane.sshKeyComment} onChange={(event) => onUpdate(pane.id, { sshKeyComment: event.target.value })} placeholder="user@device" />
                          </label>
                        </div>

                        <div className="inline-actions wrap-actions compact-utility-row ssh-key-actions ssh-key-primary-actions">
                          <button type="button" className="secondary-button ssh-soft-button accent" disabled={pane.sshActionState === 'running'} onClick={() => onGenerateSshKey(pane.id)}><KeyRound size={16} />{UI.generateKey}</button>
                          <span className="ssh-action-separator" aria-hidden="true">→</span>
                          <button type="button" className="secondary-button ssh-soft-button accent" disabled={pane.sshActionState === 'running' || !pane.sshPublicKeyText.trim() || !pane.sshHost.trim()} onClick={() => onInstallSshPublicKey(pane.id)}><ArrowUpRight size={16} />{UI.installKey}</button>
                        </div>

                        <label className="full-span ssh-key-select-field">
                          <span className="field-label-with-chip"><span>{UI.selectedKey}</span><span className="ssh-panel-chip neutral">{UI.selectable}</span></span>
                          <select value={sshKeySelectValue} disabled={!hasSelectableSshKeys} onChange={(event) => {
                            const selectedPath = event.target.value
                            const selected = pane.sshLocalKeys.find((item) => item.privateKeyPath === selectedPath) ?? null
                            onUpdate(pane.id, {
                              sshSelectedKeyPath: selectedPath,
                              sshIdentityFile: selectedPath,
                              sshPublicKeyText: selected?.publicKey ?? '',
                              sshKeyName: selected?.name ?? pane.sshKeyName,
                              sshKeyComment: selected?.comment ?? pane.sshKeyComment
                            })
                          }}>
                            <option value="">{UI.unselected}</option>
                            {pane.sshLocalKeys.map((key) => <option key={key.privateKeyPath} value={key.privateKeyPath}>{key.name}</option>)}
                            {effectiveIdentityFile && !pane.sshLocalKeys.some((key) => key.privateKeyPath === effectiveIdentityFile) ? <option value={effectiveIdentityFile}>{`${getShortPathLabel(effectiveIdentityFile)} (SSH config / current)`}</option> : null}
                          </select>
                        </label>

                        <div className="browser-panel ssh-info-panel">
                          <div className="section-headline compact-headline ssh-panel-headline">
                            <strong>{UI.publicKey}</strong>
                            {sshKeyLabel ? <span className="ssh-panel-chip neutral">{`${UI.keyName}: ${sshKeyLabel}`}</span> : null}
                          </div>
                          <div className="output-surface inline-console-output"><pre>{pane.sshPublicKeyText || UI.publicKeyEmpty}</pre></div>
                        </div>

                        <div className="inline-actions wrap-actions compact-utility-row ssh-key-actions ssh-key-secondary-actions">
                          <button type="button" className="secondary-button ssh-soft-button danger" disabled={pane.sshActionState === 'running' || !sshKeySelectValue} onClick={() => onDeleteSshKey(pane.id)}><Trash2 size={16} />{UI.deleteKey}</button>
                          <button type="button" className="secondary-button ssh-soft-button caution" disabled={pane.sshActionState === 'running' || !pane.sshHost.trim()} onClick={() => onRemoveKnownHost(pane.id)}><X size={16} />{UI.removeKnownHost}</button>
                        </div>
                        <div className="ssh-guidance-note"><AlertTriangle size={14} /><span>{UI.keyActionHint}</span></div>

                        {pane.sshActionMessage && (
                          <div className={`ssh-action-feedback ${pane.sshActionState}`}>
                            {pane.sshActionState === 'running' ? <LoaderCircle size={15} className="spin" /> : pane.sshActionState === 'success' ? <CheckCircle2 size={15} /> : pane.sshActionState === 'error' ? <AlertTriangle size={15} /> : null}
                            <span>{pane.sshActionMessage}</span>
                          </div>
                        )}
                      </div>

                      <details className="ssh-mini-accordion ssh-diagnostics-accordion">
                        <summary className="ssh-mini-summary">
                          <span className="ssh-mini-summary-row">
                            <span className="ssh-summary-inline">
                              <span>{UI.diagnostics}</span>
                              <span className="ssh-panel-chip neutral">{UI.infoOnly}</span>
                              <span className={`ssh-panel-chip ${sshDiagnosticsStatus}`}>{sshDiagnosticsLabel}</span>
                            </span>
                            <span className="ssh-mini-caret"><ChevronDown size={14} /></span>
                          </span>
                        </summary>
                        <div className="ssh-mini-body">
                          {pane.sshDiagnostics.length > 0 ? <div className="diagnostic-list">{pane.sshDiagnostics.map((item, index) => <div key={`${pane.id}-diag-${index}`} className="diagnostic-item">{item}</div>)}</div> : <p className="panel-placeholder compact-error">{UI.remoteCliPending}</p>}
                        </div>
                      </details>
                    </div>
                  </details>

                  <div className="workspace-primary-action">
                    <button type="button" className="primary-button workspace-choose-button remote-connect-button" onClick={() => onLoadRemote(pane.id)}><Wifi size={16} />{UI.refreshConnection}</button>
                  </div>

                  <div className="workspace-primary-action">
                    <button type="button" className="primary-button workspace-choose-button remote-connect-button" disabled={!isRemoteConnected || pane.remoteBrowserLoading} onClick={() => onOpenRemoteWorkspacePicker(pane.id)}><FolderOpen size={16} />{UI.chooseRemoteWorkspace}</button>
                  </div>

                  <div className="workspace-current">
                    <span className="workspace-caption">{UI.currentWorkspace}<span className="required-mark">*</span></span>
                    <strong>{pane.remoteWorkspacePath ? getShortPathLabel(pane.remoteWorkspacePath) : UI.unselected}</strong>
                    <span>{pane.remoteWorkspacePath || UI.remoteEmpty}</span>
                  </div>

                  <div className={`browser-panel workspace-browser-shell remote-browser-shell ${remoteDropTarget === remoteBaseDropPath ? 'is-drop-active' : ''}`} onDragOver={(event) => { if (remoteBaseDropPath) { allowRemoteDrop(event, remoteBaseDropPath) } }} onDragLeave={clearRemoteDrop} onDrop={(event) => { if (remoteBaseDropPath) { handleRemoteDrop(event, remoteBaseDropPath) } }}>
                    <div className="section-headline compact-headline browser-headline">
                      <div><strong>{UI.folderContents}</strong></div>
                      <div className="browser-toolbar-actions">
                        {!isAtRemoteWorkspaceTop && pane.remoteWorkspacePath && <button type="button" className="ghost-button compact-ghost" onClick={() => onBrowseRemote(pane.id, pane.remoteWorkspacePath)}><Home size={14} />{UI.workspaceTop}</button>}
                        {remoteParentPath && <button type="button" className="ghost-button compact-ghost" onClick={() => onBrowseRemote(pane.id, remoteParentPath)}><ChevronLeft size={14} />{UI.oneLevelUp}</button>}
                        <button type="button" className="ghost-button compact-ghost" disabled={!remoteBaseDropPath} onClick={() => onCreateRemoteDirectory(pane.id)}><FolderPlus size={14} />{UI.createFolder}</button>
                        <button type="button" className="ghost-button compact-ghost" disabled={!remoteBaseDropPath} onClick={() => remoteBaseDropPath && onTransferSshPath(pane.id, 'download', { remotePath: remoteBaseDropPath, remoteLabel: currentRemoteLabel, isDirectory: true })}>{UI.downloadCurrent}</button>
                      </div>
                    </div>

                    <div className="browser-list browser-list-shell remote-browser-list-modern">
                      {pane.remoteWorkspacePath && pane.remoteBrowserEntries.length > 0 ? (
                        pane.remoteBrowserEntries.map((entry) => (
                          <div key={entry.path} className={`browser-entry remote-entry modern-remote-entry ${remoteDropTarget === entry.path ? 'drop-ready' : ''}`} onDragOver={(event) => { if (entry.isDirectory) { allowRemoteDrop(event, entry.path) } }} onDragLeave={clearRemoteDrop} onDrop={(event) => { if (entry.isDirectory) { handleRemoteDrop(event, entry.path) } }}>
                            <button type="button" className="browser-entry-main browser-entry-button modern-browser-button" onClick={() => entry.isDirectory ? onBrowseRemote(pane.id, entry.path) : onOpenPath(pane.id, entry.path, 'file')}>
                              {entry.isDirectory ? <Folder size={16} /> : <FileText size={16} />}
                              <strong>{entry.label}</strong>
                            </button>
                            <div className="browser-entry-actions">
                              <button type="button" className="ghost-button" onClick={() => onTransferSshPath(pane.id, 'download', { remotePath: entry.path, remoteLabel: entry.label, isDirectory: entry.isDirectory })}>{UI.receive}</button>
                            </div>
                          </div>
                        ))
                      ) : <div className="panel-placeholder browser-placeholder">{pane.remoteBrowserLoading ? UI.remoteLoading : UI.remoteEmpty}</div>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </details>
          <details className="pane-accordion shell-accordion" open={pane.shellOpen} onToggle={(event) => onUpdate(pane.id, { shellOpen: (event.currentTarget as HTMLDetailsElement).open })}>
            <summary className="accordion-summary">
              <span className="accordion-label"><Square size={15} />{UI.embeddedTerminal}</span>
              <span className="accordion-meta">
                <span className="accordion-value">{currentShellPath || (pane.workspaceMode === 'local' ? UI.workspaceUnset : UI.sshUnset)}</span>
                <span className={`accordion-caret ${pane.shellOpen ? 'is-open' : ''}`}><ChevronDown size={14} /></span>
              </span>
            </summary>
            <div className="accordion-body shell-panel shell-panel-inline">
              <div className="panel-header slim shell-panel-header">
                <div>
                  <h3>{UI.embeddedTerminal}</h3>
                  <p>{currentShellPath || (pane.workspaceMode === 'local' ? UI.workspaceUnset : UI.sshUnset)}</p>
                </div>
                <button type="button" className="icon-button" onClick={() => setIsShellExpanded(true)} title={UI.shellExpand}><Maximize2 size={16} /></button>
              </div>
              <div className="output-surface console-output shell-console shell-console-interactive" aria-label="embedded-terminal-output" ref={shellConsoleRef} onClick={() => shellInputRef.current?.focus()}>
                {pane.shellOutput ? <pre>{pane.shellOutput}</pre> : null}
                <div className="shell-console-entry">
                  <span className="shell-prompt">{shellPromptLabel}</span>
                  <input
                    ref={shellInputRef}
                    className="shell-inline-input"
                    value={pane.shellCommand}
                    onChange={(event) => updateShellCommand(event.target.value)}
                    onKeyDown={handleShellKeyDown}
                    disabled={pane.shellRunning}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  {pane.shellRunning ? <LoaderCircle size={14} className="spin shell-inline-spinner" /> : null}
                </div>
              </div>
            </div>
          </details>

        </div>
      </section>

      {isOutputExpanded && (
        <div className="output-modal-backdrop">
          <div className="output-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div><h3>{UI.output}</h3><p>{pane.title}</p></div>
              <button type="button" className="icon-button" onClick={() => setIsOutputExpanded(false)} title="close"><X size={16} /></button>
            </div>
            <div className="output-modal-body">{hasOutput ? <pre>{outputText}</pre> : null}</div>
            <div className="output-modal-footer"><button type="button" className="secondary-button" disabled={!outputText} onClick={() => onCopyOutput(pane.id)}><Copy size={16} />{UI.copyOutput}</button></div>
          </div>
        </div>
      )}

      {isRunLogsExpanded && (
        <div className="output-modal-backdrop">
          <div className="output-modal run-logs-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div><h3>{UI.runLogs}</h3><p>{pane.title}</p></div>
              <button type="button" className="icon-button" onClick={() => setIsRunLogsExpanded(false)} title={UI.close}><X size={16} /></button>
            </div>
            <div className="output-modal-body run-logs-modal-body">
              {hasSessionRecords ? (
                <>
                  {sessionOptions.length > 1 && (
                    <label className="session-selector">
                      <span>{UI.session}</span>
                      <select value={selectedArchivedSession?.key ?? '__current__'} onChange={(event) => onSelectSession(pane.id, event.target.value === '__current__' ? null : event.target.value)}>
                        {sessionOptions.map((session) => <option key={session.key} value={session.key}>{session.label}</option>)}
                      </select>
                    </label>
                  )}
                  <div className="session-log-meta"><strong>{visibleSession.label}</strong><span>{formatClock(visibleSession.updatedAt)}</span></div>
                  <div className="run-logs-modal-grid">
                    {visibleSession.streamEntries.length > 0 && (
                      <div className="activity-panel">
                        <div className="section-headline compact-headline"><strong>{UI.stream}</strong><span>{visibleSession.streamEntries.length}</span></div>
                        <div className="activity-feed">
                          {visibleSession.streamEntries.map((entry) => (
                            <article key={entry.id} className={`activity-entry ${entry.kind}`}>
                              <header><strong>{entry.kind}</strong><span>{formatClock(entry.createdAt)}</span></header>
                              <p>{entry.text}</p>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                    {visibleSession.logs.length > 0 && (
                      <div className="history-panel">
                        <div className="section-headline compact-headline"><strong>{UI.conversation}</strong><span>{visibleSession.logs.length}</span></div>
                        <div className="history-feed">
                          {visibleSession.logs.map((entry) => (
                            <article key={entry.id} className={`history-entry ${entry.role}`}>
                              <header><strong>{entry.role === 'assistant' ? pane.provider : entry.role}</strong><span>{formatClock(entry.createdAt)}</span></header>
                              <p>{entry.text}</p>
                            </article>
                          ))}
                        </div>
                      </div>
                    )}
                    {visibleSession.streamEntries.length === 0 && visibleSession.logs.length === 0 && <p className="panel-placeholder run-logs-empty">{UI.runLogsEmpty}</p>}
                  </div>
                </>
              ) : <p className="panel-placeholder run-logs-empty">{UI.runLogsEmpty}</p>}
            </div>
            <div className="output-modal-footer"><button type="button" className="secondary-button" onClick={() => setIsRunLogsExpanded(false)}><X size={16} />{UI.close}</button></div>
          </div>
        </div>
      )}

      {isShellExpanded && (
        <div className="output-modal-backdrop">
          <div className="output-modal shell-output-modal" onClick={(event) => event.stopPropagation()}>
            <div className="panel-header slim">
              <div><h3>{UI.embeddedTerminal}</h3><p>{pane.title}</p></div>
              <button type="button" className="icon-button" onClick={() => setIsShellExpanded(false)} title="close"><X size={16} /></button>
            </div>
            <div className="output-modal-body shell-modal-body">
              <div className="output-surface console-output shell-console shell-console-interactive" ref={shellModalConsoleRef} onClick={() => shellModalInputRef.current?.focus()}>
                {pane.shellOutput ? <pre>{pane.shellOutput}</pre> : null}
                <div className="shell-console-entry">
                  <span className="shell-prompt">{shellPromptLabel}</span>
                  <input
                    ref={shellModalInputRef}
                    className="shell-inline-input"
                    value={pane.shellCommand}
                    onChange={(event) => updateShellCommand(event.target.value)}
                    onKeyDown={handleShellKeyDown}
                    disabled={pane.shellRunning}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                  {pane.shellRunning ? <LoaderCircle size={14} className="spin shell-inline-spinner" /> : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

