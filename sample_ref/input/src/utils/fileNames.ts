/**
 * @file fileNames.ts
 * @description ファイル名の維持・補完に関するヘルパー。
 */

export function preserveOriginalFileName(
  fileName: string | null | undefined,
  fallbackName: string,
): string {
  const trimmed = typeof fileName === 'string' ? fileName.trim() : '';
  return trimmed.length > 0 ? trimmed : fallbackName;
}

export function resolveAiNarrationFileName(params: {
  currentName?: string | null;
  voiceLabel?: string | null;
}): string {
  const fallbackVoiceLabel = params.voiceLabel?.trim() || 'AI音声';
  return preserveOriginalFileName(
    params.currentName,
    `AIナレーション_${fallbackVoiceLabel}.wav`,
  );
}
