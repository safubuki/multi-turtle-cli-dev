/**
 * @file index.ts
 * @author Turtle Village
 * @description アプリケーション全体で使用される定数定義（キャンバスサイズ、デフォルト値、API設定など）。
 */
import type { VoiceOption } from '../types';

// キャンバス設定
export const CANVAS_WIDTH = 1280;
export const CANVAS_HEIGHT = 720;
export const FPS = 30;

// フェード設定
export const FADE_DURATION = 1.0; // 秒
export const AUDIO_FADE_DURATION = 2.0; // 秒
export const CAPTION_FADE_DURATION = 0.5; // 秒

// フェード時間オプション
export const FADE_DURATION_OPTIONS = [0.5, 1.0, 2.0];
export const DEFAULT_FADE_DURATION = 1.0;

// 音量増幅設定
export const MAX_VOLUME = 1.5;                    // 150%まで増幅可能
export const STANDARD_VOLUME_POSITION = 0.75;     // 3/4位置 = 100%

// スケール設定
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 3.0;
export const BLACK_BORDER_REMOVAL_SCALE = 1.025;

// 画像デフォルト設定
export const DEFAULT_IMAGE_DURATION = 5; // 秒
export const MIN_IMAGE_DURATION = 0.5; // 秒
export const MAX_IMAGE_DURATION = 60; // 秒

// ボリューム設定
export const DEFAULT_VIDEO_VOLUME = 1.0;
export const DEFAULT_BGM_VOLUME = 0.5;
export const DEFAULT_NARRATION_VOLUME = 1.0;

// 同期設定
export const VIDEO_SYNC_THRESHOLD = 0.8; // 秒 - 再生中の同期ズレ許容値
export const SEEK_SYNC_THRESHOLD = 0.01; // 秒 - シーク時の同期精度
export const AUDIO_SYNC_THRESHOLD = 0.5; // 秒 - オーディオの同期ズレ許容値
export const PRELOAD_TIME = 1.5; // 秒 - 次のメディアのプリロード開始時間
export const SEEK_THROTTLE_MS = 50; // ミリ秒 - シーク操作のスロットリング間隔

// API設定
export const GEMINI_SCRIPT_MODEL = 'gemini-2.5-flash';
export const GEMINI_SCRIPT_FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
export const GEMINI_TTS_MODEL = 'gemini-2.5-flash-preview-tts';
export const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const TTS_SAMPLE_RATE = 24000;

// 利用可能なボイスリスト
export const VOICE_OPTIONS: VoiceOption[] = [
  { id: 'Aoede', label: '女性A', desc: '親しみやすい標準ボイス' },
  { id: 'Kore', label: '女性B', desc: '落ち着いたやわらかいボイス' },
  { id: 'Puck', label: '男性A', desc: '聞き取りやすいクリアボイス' },
  { id: 'Fenrir', label: '男性B', desc: '低めで深みのあるボイス' },
  { id: 'Charon', label: '男性C', desc: '力強く張りのあるボイス' },
];

// エクスポート設定
export const EXPORT_VIDEO_BITRATE = 5000000; // 5Mbps
