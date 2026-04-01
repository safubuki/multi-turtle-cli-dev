import path from 'path'
import { fileURLToPath } from 'url'

const CURRENT_FILE = fileURLToPath(import.meta.url)
export const SERVER_ROOT = path.resolve(path.dirname(CURRENT_FILE), '..')
export const APP_ROOT = path.resolve(SERVER_ROOT, '..')

export function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
}

export function getPathName(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? value
}

export function toWorkspaceId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase()
}

export function shellEscapePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
