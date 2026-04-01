import type { MediaRecorderProfile } from '../../utils/platform';
import type { ExportStrategyId } from './types';

export interface ExportStrategyResolutionInput {
  isIosSafari: boolean;
  supportedMediaRecorderProfile: MediaRecorderProfile | null;
}

export function resolveExportStrategyOrder(
  input: ExportStrategyResolutionInput,
): ExportStrategyId[] {
  if (input.isIosSafari && input.supportedMediaRecorderProfile) {
    return ['ios-safari-mediarecorder', 'webcodecs-mp4'];
  }

  return ['webcodecs-mp4'];
}

export interface OfflineAudioPreRenderResolutionInput {
  hasAudioSources: boolean;
}

export function shouldUseOfflineAudioPreRender(
  input: OfflineAudioPreRenderResolutionInput,
): boolean {
  return input.hasAudioSources;
}

export type WebCodecsAudioCaptureStrategy =
  | 'pre-rendered'
  | 'track-processor'
  | 'script-processor';

export interface WebCodecsAudioCaptureResolutionInput {
  offlineAudioDone: boolean;
  isIosSafari: boolean;
  hasAudioTrack: boolean;
  canUseTrackProcessor: boolean;
}

export function resolveWebCodecsAudioCaptureStrategy(
  input: WebCodecsAudioCaptureResolutionInput,
): WebCodecsAudioCaptureStrategy {
  if (input.offlineAudioDone) {
    return 'pre-rendered';
  }

  if (input.hasAudioTrack && !input.isIosSafari && input.canUseTrackProcessor) {
    return 'track-processor';
  }

  return 'script-processor';
}
