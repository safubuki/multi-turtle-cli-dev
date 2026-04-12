export const MAX_LIVE_OUTPUT = 64_000
export const MAX_SHELL_OUTPUT = 48_000

export function clipText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength).trimEnd()}\n\n[truncated]`
}

export function sanitizeTerminalText(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
}

export function appendLiveOutputChunk(existing: string, incoming: string): string {
  const normalized = sanitizeTerminalText(incoming)
  if (!normalized) {
    return existing
  }

  return clipText(`${existing}${normalized}`, MAX_LIVE_OUTPUT)
}

export function appendShellOutputLine(existing: string, incoming: string): string {
  const normalized = sanitizeTerminalText(incoming).replace(/\r/g, '').replace(/\n$/, '')

  if (!existing) {
    return normalized
  }

  if (!normalized.length) {
    return clipText(`${existing}\n`, MAX_SHELL_OUTPUT)
  }

  return clipText(`${existing}\n${normalized}`, MAX_SHELL_OUTPUT)
}

export function appendLiveOutputLine(existing: string, incoming: string): string {
  const normalized = sanitizeTerminalText(incoming).trim()
  if (!normalized) {
    return existing
  }

  return clipText(existing.trim() ? `${existing.trimEnd()}\n${normalized}` : normalized, MAX_LIVE_OUTPUT)
}

export function summarize(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 110) {
    return normalized
  }

  return `${normalized.slice(0, 110).trim()}...`
}
