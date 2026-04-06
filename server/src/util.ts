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

export function buildRemoteBashBootstrap(): string {
  return [
    'tako_source() { [ -r "$1" ] && . "$1" >/dev/null 2>&1 || true; }',
    'tako_prepend_path() {',
    '  [ -d "$1" ] || return 0',
    '  case ":$PATH:" in',
    '    *":$1:"*) ;;',
    '    *) PATH="$1${PATH:+:$PATH}" ;;',
    '  esac',
    '}',
    'tako_source /etc/profile',
    'tako_source "$HOME/.profile"',
    'tako_source "$HOME/.bash_profile"',
    'tako_source "$HOME/.bash_login"',
    'tako_source "$HOME/.bashrc"',
    'tako_source "$HOME/.nvm/nvm.sh"',
    'tako_source "$HOME/.config/nvm/nvm.sh"',
    'tako_source "$HOME/.asdf/asdf.sh"',
    'tako_prepend_path "$HOME/.local/bin"',
    'tako_prepend_path "$HOME/bin"',
    'tako_prepend_path "$HOME/.npm-global/bin"',
    'tako_prepend_path "$HOME/.volta/bin"',
    'if command -v brew >/dev/null 2>&1; then',
    '  eval "$(brew shellenv)" >/dev/null 2>&1 || true',
    'fi',
    'if command -v fnm >/dev/null 2>&1; then',
    '  eval "$(fnm env --use-on-cd 2>/dev/null)" >/dev/null 2>&1 || true',
    'fi',
    'if command -v npm >/dev/null 2>&1; then',
    '  tako_npm_prefix="$(npm config get prefix 2>/dev/null || true)"',
    '  if [ -n "$tako_npm_prefix" ] && [ -d "$tako_npm_prefix/bin" ]; then',
    '    tako_prepend_path "$tako_npm_prefix/bin"',
    '  fi',
    'fi',
    'export PATH',
    'unset -f tako_source',
    'unset -f tako_prepend_path',
    'unset tako_npm_prefix'
  ].join('\n')
}
