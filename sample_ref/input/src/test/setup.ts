/**
 * Vitest セットアップファイル
 * テスト実行前のグローバル設定
 */

import '@testing-library/jest-dom';

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock AudioContext
class MockAudioContext {
  state = 'running';
  destination = {};
  
  createMediaStreamDestination() {
    return { stream: new MediaStream() };
  }
  
  createMediaElementSource() {
    return { connect: () => {} };
  }
  
  createGain() {
    return {
      gain: { value: 1, setValueAtTime: () => {}, linearRampToValueAtTime: () => {} },
      connect: () => {},
    };
  }
  
  resume() {
    return Promise.resolve();
  }
  
  close() {
    return Promise.resolve();
  }
}

Object.defineProperty(window, 'AudioContext', {
  writable: true,
  value: MockAudioContext,
});

Object.defineProperty(window, 'webkitAudioContext', {
  writable: true,
  value: MockAudioContext,
});

// Mock URL.createObjectURL / revokeObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: (_blob: Blob) => `blob:mock-url-${Math.random()}`,
});

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: () => {},
});

// Mock ResizeObserver
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});

// Mock canvas getContext
HTMLCanvasElement.prototype.getContext = (() => {
  return {
    fillRect: () => {},
    clearRect: () => {},
    getImageData: () => ({ data: new Array(4) }),
    putImageData: () => {},
    createImageData: () => [],
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    stroke: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    arc: () => {},
    fill: () => {},
    measureText: () => ({ width: 0 }),
    transform: () => {},
    rect: () => {},
    clip: () => {},
    globalAlpha: 1,
    fillStyle: '',
  };
}) as unknown as typeof HTMLCanvasElement.prototype.getContext;
