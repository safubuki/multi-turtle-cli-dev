/**
 * @file useAudioContext.ts
 * @author Turtle Village
 * @description Web Audio APIのコンテキスト管理、ノード接続（GainNode, SourceNode）を行うカスタムフック。
 */
import { useRef, useCallback } from 'react';
import { useLogStore } from '../stores/logStore';

/**
 * useAudioContext - Web Audio APIのラッパーフック
 * AudioContext, GainNode, SourceNode の管理を提供
 */
export interface UseAudioContextReturn {
  // Refs
  audioCtxRef: React.MutableRefObject<AudioContext | null>;
  sourceNodesRef: React.MutableRefObject<Record<string, MediaElementAudioSourceNode>>;
  gainNodesRef: React.MutableRefObject<Record<string, GainNode>>;
  masterDestRef: React.MutableRefObject<MediaStreamAudioDestinationNode | null>;
  mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>;

  // Methods
  getAudioContext: () => AudioContext;
  handleMediaRefAssign: (
    id: string,
    element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null
  ) => void;
  configureAudioRouting: (isExporting: boolean) => void;
  disconnectAllNodes: () => void;
  clearAllRefs: () => void;
}

export function useAudioContext(): UseAudioContextReturn {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const masterDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaElementsRef = useRef<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>({});

  // AudioContext の取得/作成
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      useLogStore.getState().info('AUDIO', 'AudioContextを作成');
      const AC = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      masterDestRef.current = ctx.createMediaStreamDestination();
      useLogStore.getState().info('AUDIO', 'AudioContext作成完了', { sampleRate: ctx.sampleRate, state: ctx.state });
    }
    return audioCtxRef.current;
  }, []);

  // メディア要素の参照設定とオーディオノード接続
  const handleMediaRefAssign = useCallback(
    (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null) => {
      if (element) {
        mediaElementsRef.current[id] = element;

        if (element.tagName === 'VIDEO' || element.tagName === 'AUDIO') {
          try {
            const ctx = getAudioContext();
            if (!sourceNodesRef.current[id]) {
              useLogStore.getState().debug('AUDIO', 'オーディオノードを接続', { id, tagName: element.tagName });
              const source = ctx.createMediaElementSource(element as HTMLMediaElement);
              const gain = ctx.createGain();
              source.connect(gain);
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(1, ctx.currentTime);
              sourceNodesRef.current[id] = source;
              gainNodesRef.current[id] = gain;
            }
          } catch (e) {
            useLogStore.getState().warn('AUDIO', 'オーディオノード接続失敗または既に接続済み', { id, error: e instanceof Error ? e.message : String(e) });
          }
        }
      } else {
        delete mediaElementsRef.current[id];
      }
    },
    [getAudioContext]
  );

  // オーディオルーティング設定（通常再生 vs エクスポート）
  const configureAudioRouting = useCallback((isExporting: boolean) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const dest = masterDestRef.current;
    const target = isExporting && dest ? dest : ctx.destination;

    useLogStore.getState().debug('AUDIO', 'オーディオルーティングを設定', { isExporting, nodeCount: Object.keys(gainNodesRef.current).length });

    Object.keys(gainNodesRef.current).forEach((id) => {
      const gain = gainNodesRef.current[id];
      try {
        gain.disconnect();
        gain.connect(target);
      } catch (e) {
        /* ignore */
      }
    });
  }, []);

  // 全ノードの切断
  const disconnectAllNodes = useCallback(() => {
    useLogStore.getState().debug('AUDIO', '全オーディオノードを切断', { 
      sourceNodeCount: Object.keys(sourceNodesRef.current).length,
      gainNodeCount: Object.keys(gainNodesRef.current).length
    });
    Object.values(sourceNodesRef.current).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    Object.values(gainNodesRef.current).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    sourceNodesRef.current = {};
    gainNodesRef.current = {};
  }, []);

  // 全参照のクリア
  const clearAllRefs = useCallback(() => {
    disconnectAllNodes();
    mediaElementsRef.current = {};
  }, [disconnectAllNodes]);

  return {
    audioCtxRef,
    sourceNodesRef,
    gainNodesRef,
    masterDestRef,
    mediaElementsRef,
    getAudioContext,
    handleMediaRefAssign,
    configureAudioRouting,
    disconnectAllNodes,
    clearAllRefs,
  };
}

export default useAudioContext;
