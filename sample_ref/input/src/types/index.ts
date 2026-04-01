/**
 * @file index.ts
 * @author Turtle Village
 * @description アプリケーション全体で使用される型定義（インターフェース、型エイリアス）。
 */

// ボイスID (定数と連動)
export type VoiceId = 'Aoede' | 'Kore' | 'Puck' | 'Fenrir' | 'Charon';
export type NarrationScriptLength = 'short' | 'medium' | 'long';

// ボイスオプション
export interface VoiceOption {
  id: VoiceId;
  label: string;
  desc: string;
}

// メディアアイテム (動画/画像)
export interface MediaItem {
  id: string;
  file: File;
  type: 'video' | 'image';
  url: string;
  volume: number;
  isMuted: boolean;
  fadeIn: boolean;
  fadeOut: boolean;
  fadeInDuration: number;   // フェードイン時間（秒）
  fadeOutDuration: number;  // フェードアウト時間（秒）
  duration: number;
  originalDuration: number;
  trimStart: number;
  trimEnd: number;
  scale: number;
  positionX: number;
  positionY: number;
  isTransformOpen: boolean;
  isLocked: boolean;
}

// オーディオトラック (BGM/ナレーション共通)
export interface AudioTrack {
  file: File | { name: string };
  url: string;
  blobUrl?: string;
  startPoint: number;
  delay: number;
  volume: number;
  fadeIn: boolean;
  fadeOut: boolean;
  fadeInDuration: number;   // フェードイン時間（秒）
  fadeOutDuration: number;  // フェードアウト時間（秒）
  duration: number;
  isAi: boolean;
}

export type NarrationSourceType = 'ai' | 'file';

export interface NarrationClip {
  id: string;
  sourceType: NarrationSourceType;
  file: File | { name: string };
  url: string;
  blobUrl?: string;
  startTime: number;
  volume: number;
  isMuted: boolean;
  trimStart: number;
  trimEnd: number;
  duration: number;
  isAiEditable: boolean;
  aiScript?: string;
  aiVoice?: VoiceId;
  aiVoiceStyle?: string;
}

// メディア要素の参照型
export type MediaElementsRef = Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>;

// オーディオノードの参照型
export type AudioNodesRef = Record<string, AudioNode>;
export type GainNodesRef = Record<string, GainNode>;
export type SourceNodesRef = Record<string, MediaElementAudioSourceNode>;

// トースト通知のProps
export interface ToastProps {
  message: string | null;
  onClose: () => void;
}

// MediaResourceLoaderのProps
export interface MediaResourceLoaderProps {
  mediaItems: MediaItem[];
  bgm: AudioTrack | null;
  narrations: NarrationClip[];
  onElementLoaded: (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => void;
  onRefAssign: (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null) => void;
  onSeeked: () => void;
  onVideoLoadedData: () => void;
}

// トラックタイプ
export type TrackType = 'bgm' | 'narration';

// エクスポート形式
export type ExportFormat = 'mp4' | 'webm';

// キャプション（字幕）
export interface Caption {
  id: string;
  text: string;
  startTime: number;  // 秒
  endTime: number;    // 秒
  fadeIn: boolean;
  fadeOut: boolean;
  fadeInDuration: number;   // フェードイン時間（秒）
  fadeOutDuration: number;  // フェードアウト時間（秒）
  // 個別スタイル設定（override）- undefinedの場合は一括設定を使用
  overridePosition?: CaptionPosition;   // 個別配置（デフォルト=undefined）
  overrideFontStyle?: CaptionFontStyle; // 個別字体（デフォルト=undefined）
  overrideFontSize?: CaptionSize;       // 個別サイズ（デフォルト=undefined）
  overrideFadeIn?: 'on' | 'off';        // 個別フェードイン（デフォルト=undefined）
  overrideFadeOut?: 'on' | 'off';       // 個別フェードアウト（デフォルト=undefined）
  overrideFadeInDuration?: number;      // 個別フェードイン時間（デフォルト=undefined）
  overrideFadeOutDuration?: number;     // 個別フェードアウト時間（デフォルト=undefined）
}

// キャプション位置
export type CaptionPosition = 'top' | 'center' | 'bottom';

// キャプションサイズ
export type CaptionSize = 'small' | 'medium' | 'large' | 'xlarge';

// キャプションフォントスタイル
export type CaptionFontStyle = 'gothic' | 'mincho';

// キャプション設定
export interface CaptionSettings {
  enabled: boolean;
  fontSize: CaptionSize;
  fontStyle: CaptionFontStyle;
  fontColor: string;
  strokeColor: string;
  strokeWidth: number;
  position: CaptionPosition;
  blur: number; // ぼかし強度（0〜5px、0=なし）
  // 一括フェード設定
  bulkFadeIn: boolean;
  bulkFadeOut: boolean;
  bulkFadeInDuration: number;
  bulkFadeOutDuration: number;
}
