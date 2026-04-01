/**
 * @file useAiNarration.ts
 * @author Turtle Village
 * @description Gemini APIを使用してAIナレーション（スクリプト生成、音声合成）を行うためのカスタムフック。
 */
import { useState, useCallback } from 'react';
import type { AudioTrack } from '../types';
import {
  GEMINI_API_BASE_URL,
  GEMINI_SCRIPT_MODEL,
  GEMINI_SCRIPT_FALLBACK_MODELS,
  GEMINI_TTS_MODEL,
  TTS_SAMPLE_RATE,
  VOICE_OPTIONS,
} from '../constants';
import { useLogStore } from '../stores/logStore';

// API キー (環境変数から取得)
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || '';

/**
 * useAiNarration - AI ナレーション生成ロジックを提供するフック
 * Gemini API を使用したスクリプト生成と音声合成
 */
export interface UseAiNarrationReturn {
  // State
  showAiModal: boolean;
  setShowAiModal: React.Dispatch<React.SetStateAction<boolean>>;
  aiPrompt: string;
  setAiPrompt: React.Dispatch<React.SetStateAction<string>>;
  aiScript: string;
  setAiScript: React.Dispatch<React.SetStateAction<string>>;
  aiVoice: string;
  setAiVoice: React.Dispatch<React.SetStateAction<string>>;
  isAiLoading: boolean;

  // Methods
  generateScript: () => Promise<void>;
  generateSpeech: (onNarrationCreated: (narration: AudioTrack) => void) => Promise<void>;
  resetAiState: () => void;
}

// PCM to WAV 変換ユーティリティ
function pcmToWav(pcmData: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (v: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      v.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const pcmView = new Uint8Array(pcmData);
  const wavView = new Uint8Array(buffer, 44);
  wavView.set(pcmView);

  return buffer;
}

export function useAiNarration(): UseAiNarrationReturn {
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiScript, setAiScript] = useState('');
  const [aiVoice, setAiVoice] = useState('Aoede');
  const [isAiLoading, setIsAiLoading] = useState(false);

  // スクリプト生成
  const generateScript = useCallback(async () => {
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt) return;
    setIsAiLoading(true);
    useLogStore.getState().info('AUDIO', 'AIスクリプト生成を開始', { prompt: trimmedPrompt.substring(0, 50) });
    try {
      const modelsToTry = [GEMINI_SCRIPT_MODEL, ...GEMINI_SCRIPT_FALLBACK_MODELS]
        .filter((model, idx, arr) => arr.indexOf(model) === idx);

      const systemInstruction = [
        'あなたは日本語の動画ナレーション原稿を作るプロです。',
        '出力は読み上げる本文のみ、1段落、1つだけ返してください。',
        '挨拶・見出し・箇条書き・注釈・引用符・絵文字は禁止です。',
        'テーマに沿って、30秒前後の短尺動画で使える自然な口語文にしてください。',
        '文字数は60〜120文字を目安にし、聞き取りやすい短文中心にしてください。',
      ].join('\n');

      const userPrompt = [
        `テーマ: ${trimmedPrompt}`,
        '用途: 短い動画のナレーション',
        '出力: ナレーション本文のみ',
      ].join('\n');

      for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        const hasNextModel = i < modelsToTry.length - 1;

        const response = await fetch(`${GEMINI_API_BASE_URL}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                parts: [{ text: userPrompt }],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as { error?: { message?: string } }));
          const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
          const isModelUnavailable = /no longer available|not found|404|model.+(available|found)/i.test(errorMessage);
          if (hasNextModel && isModelUnavailable) {
            useLogStore.getState().warn('AUDIO', 'スクリプト生成モデルをフォールバック', { model, errorMessage });
            continue;
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text === 'string' && text.trim()) {
          const normalized = text
            .replace(/\r?\n+/g, ' ')
            .replace(/^(原稿案|ナレーション|台本)\s*[:：]\s*/i, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
          useLogStore.getState().info('AUDIO', 'AIスクリプト生成成功', { scriptLength: normalized.length, model });
          setAiScript(normalized);
          return;
        }
      }

      throw new Error('スクリプトの生成結果が空です');
    } catch (e) {
      useLogStore.getState().error('AUDIO', 'AIスクリプト生成失敗', { error: e instanceof Error ? e.message : String(e) });
      console.error('スクリプト生成エラー:', e);
      throw new Error('スクリプト生成に失敗しました');
    } finally {
      setIsAiLoading(false);
    }
  }, [aiPrompt]);

  // 音声合成
  const generateSpeech = useCallback(
    async (onNarrationCreated: (narration: AudioTrack) => void) => {
      if (!aiScript) return;
      setIsAiLoading(true);
      useLogStore.getState().info('AUDIO', 'AI音声合成を開始', { voice: aiVoice, scriptLength: aiScript.length });
      try {
        const response = await fetch(`${GEMINI_API_BASE_URL}/${GEMINI_TTS_MODEL}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            contents: [{ parts: [{ text: aiScript }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: aiVoice },
                },
              },
            },
          }),
        });

        const data = await response.json();
        const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

        if (inlineData) {
          const binaryString = window.atob(inlineData.data);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          const wavBuffer = pcmToWav(bytes.buffer, TTS_SAMPLE_RATE);
          const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
          const blobUrl = URL.createObjectURL(wavBlob);

          const audio = new Audio(blobUrl);
          audio.onloadedmetadata = () => {
            const voiceLabel = VOICE_OPTIONS.find((v) => v.id === aiVoice)?.label || 'AI音声';
            useLogStore.getState().info('AUDIO', 'AI音声合成成功', { voice: aiVoice, duration: audio.duration });
            const narration: AudioTrack = {
              file: { name: `AIナレーション_${voiceLabel}.wav` },
              url: blobUrl,
              blobUrl: blobUrl,
              startPoint: 0,
              delay: 0,
              volume: 1.0,
              fadeIn: false,
              fadeOut: false,
              fadeInDuration: 2.0,
              fadeOutDuration: 2.0,
              duration: audio.duration,
              isAi: true,
            };
            onNarrationCreated(narration);
            setShowAiModal(false);
          };
        }
      } catch (e) {
        useLogStore.getState().error('AUDIO', 'AI音声合成失敗', { error: e instanceof Error ? e.message : String(e) });
        console.error('音声生成エラー:', e);
        throw new Error('音声生成に失敗しました');
      } finally {
        setIsAiLoading(false);
      }
    },
    [aiScript, aiVoice]
  );

  // 状態リセット
  const resetAiState = useCallback(() => {
    setAiPrompt('');
    setAiScript('');
    setAiVoice('Aoede');
    setShowAiModal(false);
    setIsAiLoading(false);
  }, []);

  return {
    showAiModal,
    setShowAiModal,
    aiPrompt,
    setAiPrompt,
    aiScript,
    setAiScript,
    aiVoice,
    setAiVoice,
    isAiLoading,
    generateScript,
    generateSpeech,
    resetAiState,
  };
}

export default useAiNarration;
