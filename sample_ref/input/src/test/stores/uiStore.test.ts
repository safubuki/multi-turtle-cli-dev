/**
 * uiStore のテスト
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useUIStore } from '../../stores/uiStore';

describe('uiStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Reset store before each test
    useUIStore.setState({
      toastMessage: '',
      errorMsg: '',
      errorCount: 0,
      isPlaying: false,
      currentTime: 0,
      isProcessing: false,
      exportUrl: '',
      exportExt: 'mp4',
      showAiModal: false,
      aiPrompt: '',
      aiScript: '',
      aiVoice: 'Kore',
      isAiLoading: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Toast', () => {
    it('should show toast message', () => {
      const { showToast } = useUIStore.getState();
      
      showToast('Test message');
      
      expect(useUIStore.getState().toastMessage).toBe('Test message');
    });

    it('should auto-clear toast after timeout', () => {
      const { showToast } = useUIStore.getState();
      
      showToast('Test message', 1000);
      
      expect(useUIStore.getState().toastMessage).toBe('Test message');
      
      vi.advanceTimersByTime(1000);
      
      expect(useUIStore.getState().toastMessage).toBe('');
    });

    it('should clear toast manually', () => {
      useUIStore.setState({ toastMessage: 'Test' });
      const { clearToast } = useUIStore.getState();
      
      clearToast();
      
      expect(useUIStore.getState().toastMessage).toBe('');
    });
  });

  describe('Error', () => {
    it('should set error message', () => {
      const { setError } = useUIStore.getState();
      
      setError('Error occurred', false); // autoClear無効
      
      expect(useUIStore.getState().errorMsg).toBe('Error occurred');
      expect(useUIStore.getState().errorCount).toBe(1);
    });

    it('should increment error count for same error', () => {
      const { setError } = useUIStore.getState();
      
      setError('Error occurred', false);
      expect(useUIStore.getState().errorCount).toBe(1);
      
      setError('Error occurred', false);
      expect(useUIStore.getState().errorCount).toBe(2);
      
      setError('Error occurred', false);
      expect(useUIStore.getState().errorCount).toBe(3);
    });

    it('should reset count for different error', () => {
      const { setError } = useUIStore.getState();
      
      setError('Error 1', false);
      expect(useUIStore.getState().errorCount).toBe(1);
      
      setError('Error 2', false);
      expect(useUIStore.getState().errorMsg).toBe('Error 2');
      expect(useUIStore.getState().errorCount).toBe(1);
    });

    it('should auto-clear error after timeout when enabled', () => {
      const { setError } = useUIStore.getState();
      
      setError('Error occurred', true); // autoClear有効
      
      expect(useUIStore.getState().errorMsg).toBe('Error occurred');
      expect(useUIStore.getState().errorCount).toBe(1);
      
      vi.advanceTimersByTime(10000); // ERROR_AUTO_CLEAR_TIMEOUT_MS
      
      expect(useUIStore.getState().errorMsg).toBe('');
      expect(useUIStore.getState().errorCount).toBe(0);
    });

    it('should not auto-clear error when disabled', () => {
      const { setError } = useUIStore.getState();
      
      setError('Error occurred', false);
      
      expect(useUIStore.getState().errorMsg).toBe('Error occurred');
      
      vi.advanceTimersByTime(10000); // ERROR_AUTO_CLEAR_TIMEOUT_MS経過
      
      expect(useUIStore.getState().errorMsg).toBe('Error occurred');
      expect(useUIStore.getState().errorCount).toBe(1);
    });

    it('should clear error and count manually', () => {
      useUIStore.setState({ errorMsg: 'Error', errorCount: 3 });
      const { clearError } = useUIStore.getState();
      
      clearError();
      
      expect(useUIStore.getState().errorMsg).toBe('');
      expect(useUIStore.getState().errorCount).toBe(0);
    });
  });

  describe('Playback', () => {
    it('should set playing state', () => {
      const { play, pause } = useUIStore.getState();
      
      expect(useUIStore.getState().isPlaying).toBe(false);
      
      play();
      expect(useUIStore.getState().isPlaying).toBe(true);
      
      pause();
      expect(useUIStore.getState().isPlaying).toBe(false);
    });

    it('should update current time', () => {
      const { setCurrentTime } = useUIStore.getState();
      
      setCurrentTime(30);
      
      expect(useUIStore.getState().currentTime).toBe(30);
    });
  });

  describe('Export', () => {
    it('should set export url and extension', () => {
      const { setExportUrl, setExportExt } = useUIStore.getState();
      
      setExportUrl('blob:test');
      setExportExt('mp4');
      
      expect(useUIStore.getState().exportUrl).toBe('blob:test');
      expect(useUIStore.getState().exportExt).toBe('mp4');
    });

    it('should clear export', () => {
      useUIStore.setState({ exportUrl: 'blob:test', exportExt: 'mp4' });
      const { clearExport } = useUIStore.getState();
      
      clearExport();
      
      expect(useUIStore.getState().exportUrl).toBeNull();
      // exportExt is not cleared by clearExport
      expect(useUIStore.getState().exportExt).toBe('mp4');
    });
  });

  describe('AI Modal', () => {
    it('should open AI modal', () => {
      const { openAiModal } = useUIStore.getState();
      
      openAiModal();
      
      expect(useUIStore.getState().showAiModal).toBe(true);
    });

    it('should close AI modal', () => {
      useUIStore.setState({
        showAiModal: true,
        aiPrompt: 'test prompt',
        aiScript: 'test script',
      });
      const { closeAiModal } = useUIStore.getState();
      
      closeAiModal();
      
      const state = useUIStore.getState();
      expect(state.showAiModal).toBe(false);
      // closeAiModal doesn't reset prompt/script (resetAiModal does that)
      expect(state.aiPrompt).toBe('test prompt');
      expect(state.aiScript).toBe('test script');
    });

    it('should set AI voice', () => {
      const { setAiVoice } = useUIStore.getState();
      
      setAiVoice('Puck');
      
      expect(useUIStore.getState().aiVoice).toBe('Puck');
    });
  });

  describe('resetUI', () => {
    it('should reset all UI state', () => {
      useUIStore.setState({
        toastMessage: 'Test',
        errorMsg: 'Error',
        errorCount: 5,
        isPlaying: true,
        currentTime: 30,
        isProcessing: true,
        exportUrl: 'blob:test',
        exportExt: 'mp4',
        showAiModal: true,
        aiPrompt: 'prompt',
        aiScript: 'script',
        isAiLoading: true,
      });
      
      const { resetUI } = useUIStore.getState();
      resetUI();
      
      const state = useUIStore.getState();
      expect(state.errorMsg).toBe('');
      expect(state.errorCount).toBe(0);
      expect(state.isPlaying).toBe(false);
      expect(state.currentTime).toBe(0);
      expect(state.isProcessing).toBe(false);
      expect(state.exportUrl).toBeNull();
      expect(state.showAiModal).toBe(false);
    });
  });
});
