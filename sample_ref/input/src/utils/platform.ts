/**
 * @file platform.ts
 * @description ブラウザ/OS 依存の判定を集約する utility。
 * iOS Safari 判定、保存 API 対応、TrackProcessor 対応、
 * MediaRecorder の出力形式判定などをここでまとめて扱う。
 */
export interface BrowserPlatformInfo {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  isAndroid: boolean;
  isIOS: boolean;
  isSafari: boolean;
  isIosSafari: boolean;
}

export interface MediaRecorderProfile {
  mimeType: string | null;
  extension: 'mp4' | 'webm';
}

export type TrackProcessorConstructor = new (init: { track: MediaStreamTrack }) => {
  readable: ReadableStream<VideoFrame | AudioData>;
};

type NavigatorLike = Partial<Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'>>;

type MediaRecorderLike = {
  isTypeSupported: (mimeType: string) => boolean;
};

type OpenFilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

type OpenFilePickerOptions = {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: OpenFilePickerAcceptType[];
};

type FileSystemFileHandleLike = {
  getFile: () => Promise<File>;
};

type PlatformWindowLike = {
  showSaveFilePicker?: unknown;
  showOpenFilePicker?: unknown;
  MediaStreamTrackProcessor?: TrackProcessorConstructor;
};

export interface PlatformCapabilities extends BrowserPlatformInfo {
  supportsShowSaveFilePicker: boolean;
  supportsShowOpenFilePicker: boolean;
  supportsTrackProcessor: boolean;
  supportsMp4MediaRecorder: boolean;
  audioContextMayInterrupt: boolean;
  supportedMediaRecorderProfile: MediaRecorderProfile | null;
  trackProcessorCtor?: TrackProcessorConstructor;
}

const IOS_SAFARI_AUDIO_UPLOAD_ACCEPT =
  'audio/*,.mp3,.m4a,.wav,.aac,.flac,.ogg,.oga,.opus,.caf,.aif,.aiff,.mp4,.m4v,.mov,.webm';

const DEFAULT_AUDIO_UPLOAD_ACCEPT = 'audio/*';

// テスト時に差し替えやすいよう、実環境オブジェクトの取得を薄い関数に分離している。
function getDefaultNavigator(): NavigatorLike | undefined {
  return typeof navigator !== 'undefined' ? navigator : undefined;
}

function getDefaultWindow(): PlatformWindowLike | undefined {
  return typeof window !== 'undefined' ? (window as PlatformWindowLike) : undefined;
}

function getDefaultMediaRecorder(): MediaRecorderLike | undefined {
  return typeof MediaRecorder !== 'undefined' ? MediaRecorder : undefined;
}

/**
 * userAgent / platform / touch 情報から、iOS Safari を含む基本的なブラウザ判定を返す。
 * iPadOS の「MacIntel + touch」も iOS とみなす。
 */
export function detectBrowserPlatform(
  navigatorLike: NavigatorLike | undefined = getDefaultNavigator(),
): BrowserPlatformInfo {
  const userAgent = navigatorLike?.userAgent ?? '';
  const platform = navigatorLike?.platform ?? '';
  const maxTouchPoints = navigatorLike?.maxTouchPoints ?? 0;
  const isAndroid = /Android/i.test(userAgent);
  const isIOS = /iP(hone|ad|od)/i.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const isSafari =
    /Safari/i.test(userAgent)
    && !/CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Chrome|Chromium|Edg|OPR|SamsungBrowser/i.test(userAgent);

  return {
    userAgent,
    platform,
    maxTouchPoints,
    isAndroid,
    isIOS,
    isSafari,
    isIosSafari: isIOS && isSafari,
  };
}

/**
 * 音声アップロード input の accept 文字列を返す。
 * iOS Safari では音声が動画コンテナ経由になるケースがあるため、拡張子を広めに許可する。
 */
export function getAudioUploadAccept(platformInfo: BrowserPlatformInfo = detectBrowserPlatform()): string {
  return platformInfo.isIosSafari ? IOS_SAFARI_AUDIO_UPLOAD_ACCEPT : DEFAULT_AUDIO_UPLOAD_ACCEPT;
}

/**
 * File System Access API の保存ダイアログが使えるかを判定する。
 */
export function supportsShowSaveFilePicker(win: PlatformWindowLike | undefined = getDefaultWindow()): boolean {
  return typeof win?.showSaveFilePicker === 'function';
}

/**
 * File System Access API のファイル選択ダイアログが使えるかを判定する。
 */
export function supportsShowOpenFilePicker(win: PlatformWindowLike | undefined = getDefaultWindow()): boolean {
  return typeof win?.showOpenFilePicker === 'function';
}

export async function openFilesWithPicker(params: {
  win?: PlatformWindowLike;
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: OpenFilePickerAcceptType[];
}): Promise<File[]> {
  const win = params.win ?? getDefaultWindow();
  if (typeof win?.showOpenFilePicker !== 'function') {
    throw new Error('showOpenFilePicker is unavailable');
  }

  const showOpenFilePicker = win.showOpenFilePicker as (
    options?: OpenFilePickerOptions,
  ) => Promise<FileSystemFileHandleLike[]>;

  const handles = await showOpenFilePicker({
    multiple: params.multiple,
    excludeAcceptAllOption: params.excludeAcceptAllOption,
    types: params.types,
  });

  return Promise.all(handles.map((handle) => handle.getFile()));
}

/**
 * MediaStreamTrackProcessor のコンストラクタを取得する。
 * 未対応環境では undefined を返し、呼び出し側でフォールバックさせる。
 */
export function getTrackProcessorConstructor(
  win: PlatformWindowLike | undefined = getDefaultWindow(),
): TrackProcessorConstructor | undefined {
  const trackProcessorCtor = win?.MediaStreamTrackProcessor;
  return typeof trackProcessorCtor === 'function' ? trackProcessorCtor : undefined;
}

/**
 * 現在のブラウザで利用可能な MediaRecorder の出力形式を返す。
 * MP4 を優先し、使えなければ WebM を返す。
 */
export function getSupportedMediaRecorderProfile(
  mediaRecorderLike: MediaRecorderLike | undefined = getDefaultMediaRecorder(),
): MediaRecorderProfile | null {
  if (!mediaRecorderLike) return null;

  // Safari 系では codec 文字列の表記差で判定結果が変わることがあるため、候補を複数並べる。
  const candidates: MediaRecorderProfile[] = [
    { mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"', extension: 'mp4' },
    { mimeType: 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', extension: 'mp4' },
    { mimeType: 'video/mp4', extension: 'mp4' },
    { mimeType: 'video/webm; codecs="vp8, opus"', extension: 'webm' },
    { mimeType: 'video/webm', extension: 'webm' },
  ];

  for (const candidate of candidates) {
    try {
      if (!candidate.mimeType || mediaRecorderLike.isTypeSupported(candidate.mimeType)) {
        return candidate;
      }
    } catch {
      // 実装差で例外になるブラウザもあるため、次の候補へ進む。
    }
  }

  return null;
}

/**
 * 各種 platform 判定を 1 つのオブジェクトにまとめて返す。
 * 呼び出し側は個別の userAgent 判定を持たず、この戻り値だけを見る前提。
 */
export function getPlatformCapabilities(options?: {
  navigator?: NavigatorLike;
  win?: PlatformWindowLike;
  mediaRecorder?: MediaRecorderLike;
}): PlatformCapabilities {
  const browser = detectBrowserPlatform(options?.navigator);
  const trackProcessorCtor = getTrackProcessorConstructor(options?.win);
  const supportedMediaRecorderProfile = getSupportedMediaRecorderProfile(options?.mediaRecorder);

  return {
    ...browser,
    supportsShowSaveFilePicker: supportsShowSaveFilePicker(options?.win),
    supportsShowOpenFilePicker: supportsShowOpenFilePicker(options?.win),
    supportsTrackProcessor: !!trackProcessorCtor,
    supportsMp4MediaRecorder: supportedMediaRecorderProfile?.extension === 'mp4',
    audioContextMayInterrupt: browser.isIosSafari,
    supportedMediaRecorderProfile,
    trackProcessorCtor,
  };
}
