/**
 * ユーティリティ関数 - タートルビデオ
 */

// フォーマット関連
export {
  formatTime,
  formatTimeDetailed,
  formatPercent,
  formatFileSize,
  safeParseFloat,
} from './format';

// オーディオ関連
export {
  pcmToWav,
  base64ToArrayBuffer,
  getOrCreateAudioContext,
  calculateTrackTime,
  calculateFadeVolume,
} from './audio';

// メディア関連
export {
  generateId,
  getMediaType,
  createMediaItem,
  calculateTotalDuration,
  getActiveMediaItem,
  swapArrayItems,
  validateTrim,
  validateScale,
  validatePosition,
  revokeObjectUrl,
} from './media';

// Canvas関連
export {
  clearCanvas,
  getMediaDimensions,
  calculateFitScale,
  calculateFadeAlpha,
  drawMediaCentered,
  isMediaReady,
  safeSetVideoTime,
  captureCanvasAsImage,
} from './canvas';

// 再生タイムライン判定
export {
  findActiveTimelineItem,
  collectPlaybackBlockingVideos,
} from './playbackTimeline';

// プラットフォーム判定
export {
  detectBrowserPlatform,
  getAudioUploadAccept,
  openFilesWithPicker,
  supportsShowSaveFilePicker,
  supportsShowOpenFilePicker,
  getTrackProcessorConstructor,
  getSupportedMediaRecorderProfile,
  getPlatformCapabilities,
} from './platform';

// プレビュー制御ポリシー
export {
  getPreviewAudioOutputMode,
  getPreviewPlatformPolicy,
  getPreviewVideoSyncThreshold,
  shouldUseCaptionBlurFallback,
  shouldMuteNativeMediaElement,
  shouldResumeAudioContextOnVisibilityReturn,
  shouldReinitializeAudioRoute,
} from './previewPlatform';

// 保存経路
export {
  resolveClientFileSaveStrategy,
  saveBlobWithClientFileStrategy,
  saveObjectUrlWithClientFileStrategy,
} from './fileSave';
