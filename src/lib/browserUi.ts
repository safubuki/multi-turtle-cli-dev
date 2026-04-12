export function getDocumentRect(element: HTMLElement): DOMRect {
  const rect = element.getBoundingClientRect()
  return new DOMRect(
    rect.left + window.scrollX,
    rect.top + window.scrollY,
    rect.width,
    rect.height
  )
}

export function animateReorder(element: HTMLElement, previousRect: DOMRect, nextRect: DOMRect): void {
  const deltaX = previousRect.left - nextRect.left
  const deltaY = previousRect.top - nextRect.top
  if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) {
    return
  }

  element.animate(
    [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: 'translate(0, 0)' }
    ],
    {
      duration: 220,
      easing: 'cubic-bezier(0.2, 0, 0, 1)'
    }
  )
}

export function acquireBodyScrollLock(): () => void {
  if (typeof document === 'undefined') {
    return () => undefined
  }

  const body = document.body
  const root = document.documentElement
  const countAttr = 'data-modal-lock-count'
  const prevBodyOverflowAttr = 'data-prev-body-overflow'
  const prevRootOverflowAttr = 'data-prev-root-overflow'
  const currentCount = Number(body.getAttribute(countAttr) ?? '0')

  if (currentCount === 0) {
    body.setAttribute(prevBodyOverflowAttr, body.style.overflow)
    root.setAttribute(prevRootOverflowAttr, root.style.overflow)
    body.style.overflow = 'hidden'
    root.style.overflow = 'hidden'
  }

  body.setAttribute(countAttr, String(currentCount + 1))

  return () => {
    const nextCount = Number(body.getAttribute(countAttr) ?? '1') - 1
    if (nextCount <= 0) {
      body.style.overflow = body.getAttribute(prevBodyOverflowAttr) ?? ''
      root.style.overflow = root.getAttribute(prevRootOverflowAttr) ?? ''
      body.removeAttribute(countAttr)
      body.removeAttribute(prevBodyOverflowAttr)
      root.removeAttribute(prevRootOverflowAttr)
      return
    }

    body.setAttribute(countAttr, String(nextCount))
  }
}

export async function writeClipboardText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fallback for environments where the async clipboard API is blocked.
    }
  }

  if (typeof document === 'undefined') {
    throw new Error('Clipboard API is unavailable')
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  textarea.setSelectionRange(0, textarea.value.length)
  const copied = document.execCommand('copy')
  document.body.removeChild(textarea)

  if (!copied) {
    throw new Error('Copy command failed')
  }
}
