import '@testing-library/jest-dom/vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false
  })
})

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver
})

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: () => undefined
})

Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
  writable: true,
  value: () => undefined
})

Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  writable: true,
  value: () => undefined
})

Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: () => 'blob:mock-url'
})

Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: () => undefined
})

Object.defineProperty(window, 'requestAnimationFrame', {
  writable: true,
  value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)
})

Object.defineProperty(window, 'cancelAnimationFrame', {
  writable: true,
  value: (handle: number) => window.clearTimeout(handle)
})