const DEFAULT_LOCAL_API_BASE_URL = 'http://localhost:3001'
const rawApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? ''
const configuredApiBaseUrl = rawApiBaseUrl.replace(/\/+$/, '')

function normalizeApiPath(path: string): string {
  if (/^https?:\/\//iu.test(path)) {
    return path
  }

  return path.startsWith('/') ? path : `/${path}`
}

export function buildApiUrl(path: string): string {
  const normalizedPath = normalizeApiPath(path)
  return configuredApiBaseUrl ? `${configuredApiBaseUrl}${normalizedPath}` : normalizedPath
}

function getApiCandidates(path: string): string[] {
  const normalizedPath = normalizeApiPath(path)
  const candidates = new Set<string>()

  if (/^https?:\/\//iu.test(normalizedPath)) {
    candidates.add(normalizedPath)
    return [...candidates]
  }

  if (configuredApiBaseUrl) {
    candidates.add(`${configuredApiBaseUrl}${normalizedPath}`)
  } else {
    candidates.add(normalizedPath)
  }

  candidates.add(`${DEFAULT_LOCAL_API_BASE_URL}${normalizedPath}`)

  return [...candidates]
}

function extractPayloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  const record = payload as Record<string, unknown>
  const candidates = [record.details, record.error, record.message]

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
}

function buildHtmlResponseError(response: Response): Error {
  const baseMessage =
    'API の代わりに HTML が返りました。フロント側の接続先を確認し、必要ならバックエンドを起動してください。'

  return new Error(`${baseMessage} (HTTP ${response.status})`)
}

async function requestJsonOnce<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const rawText = await response.text()
  const contentType = response.headers.get('content-type') ?? ''
  const looksHtml = /^\s*</u.test(rawText) || contentType.includes('text/html')

  if (looksHtml) {
    throw buildHtmlResponseError(response)
  }

  let payload: unknown = null

  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText)
    } catch {
      throw new Error(`API が不正な JSON を返しました。 (HTTP ${response.status})`)
    }
  }

  if (!response.ok) {
    throw new Error(extractPayloadMessage(payload) ?? `HTTP ${response.status}`)
  }

  return payload as T
}

export async function apiRequestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const candidates = getApiCandidates(path)
  let lastError: Error | null = null

  for (const url of candidates) {
    try {
      return await requestJsonOnce<T>(url, init)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw lastError ?? new Error('API リクエストに失敗しました。')
}
