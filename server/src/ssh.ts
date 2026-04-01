import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import type { ProviderId, RemoteDirectoryEntry, RemoteWorkspace, SshHost } from './types.js'
import { dedupeStrings, getPathName, toWorkspaceId } from './util.js'

const DEFAULT_REMOTE_ROOTS = ['~/workspaces', '~/projects', '~/src', '.']

function getSshConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config')
}

export function getRemoteWorkspaceRoots(): string[] {
  return dedupeStrings([process.env.MULTI_TURTLE_REMOTE_ROOTS, DEFAULT_REMOTE_ROOTS.join(';')]).flatMap((entry) =>
    entry
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function runSsh(host: string, args: string[], stdinContent = '', timeoutMs = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [host, ...args], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      child.kill()
      reject(new Error('SSH command timed out'))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `ssh exited with code ${code}`))
        return
      }

      resolve(stdout.trim())
    })

    child.stdin.end(stdinContent)
  })
}

export async function discoverSshHosts(): Promise<SshHost[]> {
  const configPath = getSshConfigPath()
  if (!existsSync(configPath)) {
    return []
  }

  const raw = await fs.readFile(configPath, 'utf8')
  const lines = raw.split(/\r?\n/)
  const hosts: SshHost[] = []
  let currentAliases: string[] = []
  let currentMeta: Partial<SshHost> = {}

  const flush = () => {
    for (const alias of currentAliases) {
      if (alias.includes('*') || alias.includes('?')) {
        continue
      }

      hosts.push({
        id: `ssh-${toWorkspaceId(alias)}`,
        alias,
        hostname: currentMeta.hostname,
        user: currentMeta.user,
        port: currentMeta.port,
        source: 'ssh-config'
      })
    }
  }

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const [keyword, ...rest] = line.split(/\s+/)
    const value = rest.join(' ').trim()

    if (/^Host$/i.test(keyword)) {
      flush()
      currentAliases = value.split(/\s+/).filter(Boolean)
      currentMeta = {}
      continue
    }

    if (currentAliases.length === 0) {
      continue
    }

    if (/^HostName$/i.test(keyword)) {
      currentMeta.hostname = value
    } else if (/^User$/i.test(keyword)) {
      currentMeta.user = value
    } else if (/^Port$/i.test(keyword)) {
      currentMeta.port = value
    }
  }

  flush()
  return hosts
}

export async function listRemoteWorkspaces(host: string): Promise<RemoteWorkspace[]> {
  const roots = getRemoteWorkspaceRoots()
  const script = `
roots=("$@")
for root in "\${roots[@]}"; do
  expanded="\${root/#\\~/$HOME}"
  [ -d "$expanded" ] || continue
  find "$expanded" -maxdepth 2 -mindepth 1 -type d \\( -exec test -d "{}/.git" \\; -o -exec test -f "{}/package.json" \\; -o -exec test -f "{}/pnpm-workspace.yaml" \\; -o -exec test -f "{}/turbo.json" \\; \\) -print 2>/dev/null
done | awk '!seen[$0]++'
`

  const stdout = await runSsh(host, ['bash', '-s', '--', ...roots], script)
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((workspacePath) => ({
      label: getPathName(workspacePath),
      path: workspacePath
    }))
}

export async function inspectRemoteHost(host: string): Promise<{
  availableProviders: ProviderId[]
  homeDirectory: string | null
}> {
  const script = `
for cmd in codex gemini copilot; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf 'CLI\\t%s\\n' "$cmd"
  fi
done
printf 'HOME\\t%s\\n' "$HOME"
`

  const stdout = await runSsh(host, ['bash', '-s'], script)
  const availableProviders: ProviderId[] = []
  let homeDirectory: string | null = null

  for (const line of stdout.split(/\r?\n/)) {
    const [kind, value] = line.trim().split('\t')
    if (kind === 'CLI' && (value === 'codex' || value === 'gemini' || value === 'copilot')) {
      availableProviders.push(value)
    }
    if (kind === 'HOME' && value) {
      homeDirectory = value
    }
  }

  return {
    availableProviders,
    homeDirectory
  }
}

export async function browseRemoteDirectory(
  host: string,
  targetPath?: string
): Promise<{
  path: string
  parentPath: string | null
  entries: RemoteDirectoryEntry[]
  homeDirectory: string | null
}> {
  const script = `
target="$1"
if [ -z "$target" ]; then
  target="$HOME"
fi
expanded="\${target/#\\~/$HOME}"
if [ ! -d "$expanded" ]; then
  echo "Directory not found: $expanded" >&2
  exit 1
fi
resolved="$(cd "$expanded" && pwd)"
printf 'PATH\\t%s\\n' "$resolved"
printf 'HOME\\t%s\\n' "$HOME"
if [ "$resolved" != "/" ]; then
  printf 'PARENT\\t%s\\n' "$(dirname "$resolved")"
fi
find "$resolved" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r dir; do
  [ -d "$dir" ] || continue
  name="$(basename "$dir")"
  workspace=0
  if [ -d "$dir/.git" ] || [ -f "$dir/package.json" ] || [ -f "$dir/pnpm-workspace.yaml" ] || [ -f "$dir/turbo.json" ]; then
    workspace=1
  fi
  printf 'DIR\\t%s\\t%s\\t%s\\n' "$name" "$dir" "$workspace"
done
`

  const stdout = await runSsh(host, ['bash', '-s', '--', targetPath?.trim() ?? ''], script)
  const entries: RemoteDirectoryEntry[] = []
  let currentPath = targetPath?.trim() || ''
  let parentPath: string | null = null
  let homeDirectory: string | null = null

  for (const line of stdout.split(/\r?\n/)) {
    const [kind, value, extra, flag] = line.split('\t')
    if (kind === 'PATH' && value) {
      currentPath = value
      continue
    }
    if (kind === 'PARENT') {
      parentPath = value || null
      continue
    }
    if (kind === 'HOME') {
      homeDirectory = value || null
      continue
    }
    if (kind === 'DIR' && value && extra) {
      entries.push({
        label: value,
        path: extra,
        isWorkspace: flag === '1'
      })
    }
  }

  return {
    path: currentPath,
    parentPath,
    entries,
    homeDirectory
  }
}

export async function createRemoteDirectory(host: string, parentPath: string, directoryName: string): Promise<string> {
  const script = `
parent="$1"
name="$2"
if [ -z "$name" ]; then
  echo "Directory name is required" >&2
  exit 1
fi
case "$name" in
  *$'\\n'*|*'/'*|*'\\\\'*)
    echo "Directory name contains invalid characters" >&2
    exit 1
    ;;
esac
expanded="\${parent/#\\~/$HOME}"
if [ ! -d "$expanded" ]; then
  echo "Parent directory not found: $expanded" >&2
  exit 1
fi
mkdir -p "$expanded/$name"
cd "$expanded/$name" && pwd
`

  const stdout = await runSsh(host, ['bash', '-s', '--', parentPath.trim(), directoryName.trim()], script)
  return stdout.split(/\r?\n/).pop()?.trim() ?? ''
}
