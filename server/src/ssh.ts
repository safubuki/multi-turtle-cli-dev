import { existsSync } from 'fs'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import type {
  LocalSshKey,
  ProviderId,
  RemoteDirectoryEntry,
  RemoteWorkspace,
  SshConnectionOptions,
  SshHost
} from './types.js'
import { dedupeStrings, getPathName, shellEscapePosix, toWorkspaceId } from './util.js'

const DEFAULT_REMOTE_ROOTS = ['~/workspaces', '~/projects', '~/src', '.']
const SSH_TIMEOUT_MS = 20_000

interface SshTargetConfig {
  host: string
  connection?: SshConnectionOptions
}

interface CommandRunOptions {
  stdinContent?: string
  timeoutMs?: number
  password?: string
}

function getSshConfigPath(): string {
  return path.join(os.homedir(), '.ssh', 'config')
}

function getSshDirectory(): string {
  return path.join(os.homedir(), '.ssh')
}

function createHostRecord(alias: string, currentMeta: Partial<SshHost>): SshHost {
  return {
    id: `ssh-${toWorkspaceId(alias)}`,
    alias,
    hostname: currentMeta.hostname,
    user: currentMeta.user,
    port: currentMeta.port,
    identityFile: currentMeta.identityFile,
    proxyJump: currentMeta.proxyJump,
    proxyCommand: currentMeta.proxyCommand,
    source: 'ssh-config'
  }
}

function splitSshArgs(raw: string | undefined): string[] {
  const input = raw?.trim() ?? ''
  if (!input) {
    return []
  }

  const args: string[] = []
  let current = ''
  let quote: 'single' | 'double' | null = null

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]

    if (quote === 'single') {
      if (char === "'") {
        quote = null
      } else {
        current += char
      }
      continue
    }

    if (quote === 'double') {
      if (char === '"') {
        quote = null
      } else if (char === '\\' && index + 1 < input.length) {
        index += 1
        current += input[index]
      } else {
        current += char
      }
      continue
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current)
        current = ''
      }
      continue
    }

    if (char === "'") {
      quote = 'single'
      continue
    }

    if (char === '"') {
      quote = 'double'
      continue
    }

    if (char === '\\' && index + 1 < input.length) {
      index += 1
      current += input[index]
      continue
    }

    current += char
  }

  if (current) {
    args.push(current)
  }

  return args
}

async function createAskPassEnv(password: string): Promise<{
  env: NodeJS.ProcessEnv
  cleanup: () => Promise<void>
}> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'multi-turtle-askpass-'))
  const passwordBase64 = Buffer.from(password, 'utf8').toString('base64')
  const scriptPath = path.join(tempDir, 'askpass.ps1')
  const wrapperPath = path.join(tempDir, 'askpass.cmd')

  await fs.writeFile(
    scriptPath,
    [
      '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
      `[Console]::Write([System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${passwordBase64}')))`
    ].join('\r\n'),
    'utf8'
  )

  await fs.writeFile(
    wrapperPath,
    '@echo off\r\npowershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0askpass.ps1"\r\n',
    'utf8'
  )

  return {
    env: {
      ...process.env,
      SSH_ASKPASS: wrapperPath,
      SSH_ASKPASS_REQUIRE: 'force',
      DISPLAY: process.env.DISPLAY || 'codex:0'
    },
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  }
}

async function runCommand(command: string, args: string[], options: CommandRunOptions = {}): Promise<string> {
  const askPass = options.password?.trim() ? await createAskPassEnv(options.password.trim()) : null

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: askPass?.env ?? process.env
      })

      let stdout = ''
      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`${command} command timed out`))
      }, options.timeoutMs ?? SSH_TIMEOUT_MS)

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
          reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`))
          return
        }

        resolve(stdout.trim())
      })

      child.stdin.end(options.stdinContent ?? '')
    })
  } finally {
    await askPass?.cleanup()
  }
}

function resolveConnection(target: SshTargetConfig, knownHosts: SshHost[] = []): Required<Omit<SshConnectionOptions, 'password'>> & { password: string; host: string } {
  const hostAlias = target.host.trim()
  const matched = knownHosts.find((item) => item.alias === hostAlias) ?? null
  const connection = target.connection ?? {}

  return {
    host: hostAlias,
    username: connection.username?.trim() || matched?.user || '',
    port: connection.port?.trim() || matched?.port || '',
    password: connection.password?.trim() || '',
    identityFile: connection.identityFile?.trim() || matched?.identityFile || '',
    proxyJump: connection.proxyJump?.trim() || matched?.proxyJump || '',
    proxyCommand: connection.proxyCommand?.trim() || matched?.proxyCommand || '',
    extraArgs: connection.extraArgs?.trim() || ''
  }
}

function buildHostSpecifier(host: string, username: string): string {
  if (!host) {
    return ''
  }

  if (!username || host.includes('@')) {
    return host
  }

  return `${username}@${host}`
}

function getSharedSshArgs(target: SshTargetConfig, portFlag: '-p' | '-P'): string[] {
  const connection = resolveConnection(target)
  const args = [
    '-o',
    'ConnectTimeout=12',
    '-o',
    'ServerAliveInterval=20',
    '-o',
    'ServerAliveCountMax=2',
    '-o',
    'PreferredAuthentications=publickey,password,keyboard-interactive',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    connection.password ? 'BatchMode=no' : 'BatchMode=yes',
    '-o',
    'NumberOfPasswordPrompts=1'
  ]

  if (connection.port) {
    args.push(portFlag, connection.port)
  }

  if (connection.identityFile) {
    args.push('-i', connection.identityFile)
  }

  if (connection.proxyJump) {
    args.push('-J', connection.proxyJump)
  }

  if (connection.proxyCommand) {
    args.push('-o', `ProxyCommand=${connection.proxyCommand}`)
  }

  args.push(...splitSshArgs(connection.extraArgs))
  return args
}

export function buildSshCommandArgs(target: SshTargetConfig, remoteArgs: string[]): string[] {
  const connection = resolveConnection(target)
  const host = buildHostSpecifier(connection.host, connection.username)
  return [...getSharedSshArgs(target, '-p'), host, ...remoteArgs]
}

async function runSsh(target: SshTargetConfig, remoteArgs: string[], stdinContent = '', timeoutMs = SSH_TIMEOUT_MS): Promise<string> {
  const connection = resolveConnection(target)
  return runCommand('ssh', buildSshCommandArgs(target, remoteArgs), {
    stdinContent,
    timeoutMs,
    password: connection.password
  })
}

function buildScpCommandArgs(
  direction: 'upload' | 'download',
  target: SshTargetConfig,
  localPath: string,
  remotePath: string
): string[] {
  const connection = resolveConnection(target)
  const host = buildHostSpecifier(connection.host, connection.username)
  const sharedArgs = getSharedSshArgs(target, '-P')
  const remoteSpec = `${host}:${remotePath}`

  return direction === 'upload'
    ? [...sharedArgs, '-r', localPath, remoteSpec]
    : [...sharedArgs, '-r', remoteSpec, localPath]
}

export async function scpTransfer(
  direction: 'upload' | 'download',
  target: SshTargetConfig,
  localPath: string,
  remotePath: string
): Promise<void> {
  const connection = resolveConnection(target)
  await runCommand('scp', buildScpCommandArgs(direction, target, localPath, remotePath), {
    timeoutMs: 60_000,
    password: connection.password
  })
}

export function getRemoteWorkspaceRoots(): string[] {
  return dedupeStrings([process.env.MULTI_TURTLE_REMOTE_ROOTS, DEFAULT_REMOTE_ROOTS.join(';')]).flatMap((entry) =>
    entry
      .split(/[;,]/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
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

      hosts.push(createHostRecord(alias, currentMeta))
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
    } else if (/^IdentityFile$/i.test(keyword)) {
      currentMeta.identityFile = value
    } else if (/^ProxyJump$/i.test(keyword)) {
      currentMeta.proxyJump = value
    } else if (/^ProxyCommand$/i.test(keyword)) {
      currentMeta.proxyCommand = value
    }
  }

  flush()
  return hosts
}

export async function findLocalSshKeys(): Promise<LocalSshKey[]> {
  const sshDirectory = getSshDirectory()
  if (!existsSync(sshDirectory)) {
    return []
  }

  const entries = await fs.readdir(sshDirectory, { withFileTypes: true })
  const keys: LocalSshKey[] = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.pub')) {
      continue
    }

    const publicKeyPath = path.join(sshDirectory, entry.name)
    const privateKeyPath = publicKeyPath.slice(0, -4)
    if (!existsSync(privateKeyPath)) {
      continue
    }

    const publicKey = (await fs.readFile(publicKeyPath, 'utf8')).trim()
    if (!publicKey) {
      continue
    }

    keys.push({
      id: `ssh-key-${toWorkspaceId(privateKeyPath)}`,
      name: path.basename(privateKeyPath),
      publicKeyPath,
      privateKeyPath,
      publicKey,
      algorithm: publicKey.split(/\s+/)[0] ?? 'ssh'
    })
  }

  return keys.sort((left, right) => {
    if (left.name === 'id_ed25519') {
      return -1
    }
    if (right.name === 'id_ed25519') {
      return 1
    }
    return left.name.localeCompare(right.name, 'ja')
  })
}

export async function generateSshKeyPair(keyName: string, comment: string, passphrase: string): Promise<LocalSshKey> {
  const sshDirectory = getSshDirectory()
  await fs.mkdir(sshDirectory, { recursive: true })

  const safeName = (keyName.trim() || 'id_ed25519').replace(/[^a-zA-Z0-9_.-]/g, '-')
  const privateKeyPath = path.join(sshDirectory, safeName)
  const publicKeyPath = `${privateKeyPath}.pub`
  if (existsSync(privateKeyPath) || existsSync(publicKeyPath)) {
    throw new Error(`SSH key already exists: ${privateKeyPath}`)
  }

  const keyComment = comment.trim() || `${os.userInfo().username}@${os.hostname()}`
  await runCommand('ssh-keygen', ['-t', 'ed25519', '-f', privateKeyPath, '-C', keyComment, '-N', passphrase], {
    timeoutMs: 25_000
  })

  const [created] = (await findLocalSshKeys()).filter((item) => item.privateKeyPath === privateKeyPath)
  if (!created) {
    throw new Error('SSH key was generated but could not be loaded')
  }

  return created
}

export async function listRemoteWorkspaces(host: string, connection?: SshConnectionOptions): Promise<RemoteWorkspace[]> {
  const roots = getRemoteWorkspaceRoots()
  const script = `
roots=("$@")
for root in "${'${roots[@]}'}"; do
  expanded="${'${root/#\\~/$HOME}'}"
  [ -d "$expanded" ] || continue
  find "$expanded" -maxdepth 2 -mindepth 1 -type d \\( -exec test -d "{}/.git" \\; -o -exec test -f "{}/package.json" \\; -o -exec test -f "{}/pnpm-workspace.yaml" \\; -o -exec test -f "{}/turbo.json" \\; \\) -print 2>/dev/null
done | awk '!seen[$0]++'
`

  const stdout = await runSsh({ host, connection }, ['bash', '-s', '--', ...roots], script)
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((workspacePath) => ({
      label: getPathName(workspacePath),
      path: workspacePath
    }))
}

export async function inspectRemoteHost(
  host: string,
  connection?: SshConnectionOptions
): Promise<{
  availableProviders: ProviderId[]
  homeDirectory: string | null
  diagnostics: string[]
  localKeys: LocalSshKey[]
  suggestedUser: string | null
  suggestedPort: string | null
  suggestedIdentityFile: string | null
  suggestedProxyJump: string | null
  suggestedProxyCommand: string | null
}> {
  const knownHosts = await discoverSshHosts()
  const resolved = resolveConnection({ host, connection }, knownHosts)
  const localKeys = await findLocalSshKeys()
  const script = `
printf 'HOME\t%s\n' "$HOME"
printf 'SHELL\t%s\n' "${'${SHELL:-}'}"
printf 'PATH\t%s\n' "$PATH"
for cmd in bash node git python3 python codex gemini copilot; do
  if command -v "$cmd" >/dev/null 2>&1; then
    printf 'BIN\t%s\t%s\n' "$cmd" "$(command -v "$cmd")"
  fi
done
if command -v codex >/dev/null 2>&1; then
  printf 'VER\tcodex\t%s\n' "$(codex --version 2>/dev/null | head -n 1)"
fi
if command -v gemini >/dev/null 2>&1; then
  printf 'VER\tgemini\t%s\n' "$(gemini --version 2>/dev/null | head -n 1)"
fi
if command -v copilot >/dev/null 2>&1; then
  printf 'VER\tcopilot\t%s\n' "$(copilot --version 2>/dev/null | head -n 1)"
fi
`

  const stdout = await runSsh({ host, connection }, ['bash', '-lc', script])
  const availableProviders: ProviderId[] = []
  const diagnostics: string[] = []
  let homeDirectory: string | null = null
  let hasBash = false

  for (const line of stdout.split(/\r?\n/)) {
    const [kind, value, extra] = line.trim().split('\t')
    if (kind === 'HOME' && value) {
      homeDirectory = value
      diagnostics.push(`HOME: ${value}`)
      continue
    }

    if (kind === 'SHELL' && value) {
      diagnostics.push(`Shell: ${value}`)
      continue
    }

    if (kind === 'PATH' && value) {
      diagnostics.push(`PATH: ${value}`)
      continue
    }

    if (kind === 'BIN' && value) {
      diagnostics.push(`${value}: ${extra}`)
      if (value === 'bash') {
        hasBash = true
      }
      if (value === 'codex' || value === 'gemini' || value === 'copilot') {
        availableProviders.push(value)
      }
      continue
    }

    if (kind === 'VER' && value) {
      diagnostics.push(`${value} version: ${extra || 'unknown'}`)
    }
  }

  if (!hasBash) {
    diagnostics.push('bash が見つかりません。リモート CLI 実行が失敗する可能性があります。')
  }
  if (availableProviders.length === 0) {
    diagnostics.push('Codex / Gemini / Copilot CLI が接続先で見つかりません。')
  }
  if (localKeys.length === 0) {
    diagnostics.push('ローカルの ~/.ssh に利用可能な鍵がありません。必要ならここから生成してください。')
  }
  if (!resolved.identityFile && localKeys[0]) {
    diagnostics.push(`推奨鍵: ${localKeys[0].privateKeyPath}`)
  }

  return {
    availableProviders,
    homeDirectory,
    diagnostics,
    localKeys,
    suggestedUser: resolved.username || null,
    suggestedPort: resolved.port || null,
    suggestedIdentityFile: resolved.identityFile || localKeys[0]?.privateKeyPath || null,
    suggestedProxyJump: resolved.proxyJump || null,
    suggestedProxyCommand: resolved.proxyCommand || null
  }
}

export async function browseRemoteDirectory(
  host: string,
  connection?: SshConnectionOptions,
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
expanded="${'${target/#\~/$HOME}'}"
if [ ! -d "$expanded" ]; then
  echo "Directory not found: $expanded" >&2
  exit 1
fi
resolved="$(cd "$expanded" && pwd)"
printf 'PATH\t%s\n' "$resolved"
printf 'HOME\t%s\n' "$HOME"
if [ "$resolved" != "/" ]; then
  printf 'PARENT\t%s\n' "$(dirname "$resolved")"
fi
find "$resolved" -mindepth 1 -maxdepth 1 \( -type d -o -type f \) -print 2>/dev/null | LC_ALL=C sort | while IFS= read -r entry; do
  [ -e "$entry" ] || continue
  name="$(basename "$entry")"
  if [ -d "$entry" ]; then
    workspace=0
    if [ -d "$entry/.git" ] || [ -f "$entry/package.json" ] || [ -f "$entry/pnpm-workspace.yaml" ] || [ -f "$entry/turbo.json" ]; then
      workspace=1
    fi
    printf 'ENTRY\tDIR\t%s\t%s\t%s\n' "$name" "$entry" "$workspace"
  else
    printf 'ENTRY\tFILE\t%s\t%s\t0\n' "$name" "$entry"
  fi
done
`

  const stdout = await runSsh({ host, connection }, ['bash', '-s', '--', targetPath?.trim() ?? ''], script)
  const entries: RemoteDirectoryEntry[] = []
  let currentPath = targetPath?.trim() || ''
  let parentPath: string | null = null
  let homeDirectory: string | null = null

  for (const line of stdout.split(/\r?\n/)) {
    const [kind, entryType, value, extra, flag] = line.split('\t')
    if (kind === 'PATH' && entryType) {
      currentPath = entryType
      continue
    }
    if (kind === 'PARENT') {
      parentPath = entryType || null
      continue
    }
    if (kind === 'HOME') {
      homeDirectory = entryType || null
      continue
    }
    if (kind === 'ENTRY' && value && extra) {
      entries.push({
        label: value,
        path: extra,
        isDirectory: entryType === 'DIR',
        isWorkspace: entryType === 'DIR' && flag === '1'
      })
    }
  }

  entries.sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1
    }

    return left.label.localeCompare(right.label, 'ja')
  })

  return {
    path: currentPath,
    parentPath,
    entries,
    homeDirectory
  }
}
export async function createRemoteDirectory(
  host: string,
  connection: SshConnectionOptions | undefined,
  parentPath: string,
  directoryName: string
): Promise<string> {
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
expanded="${'${parent/#\\~/$HOME}'}"
if [ ! -d "$expanded" ]; then
  echo "Parent directory not found: $expanded" >&2
  exit 1
fi
mkdir -p "$expanded/$name"
cd "$expanded/$name" && pwd
`

  const stdout = await runSsh({ host, connection }, ['bash', '-s', '--', parentPath.trim(), directoryName.trim()], script)
  return stdout.split(/\r?\n/).pop()?.trim() ?? ''
}

export async function installSshPublicKey(host: string, connection: SshConnectionOptions | undefined, publicKey: string): Promise<void> {
  const normalizedKey = publicKey.trim()
  if (!normalizedKey) {
    throw new Error('public key is required')
  }

  const script = `
key="$1"
umask 077
mkdir -p "$HOME/.ssh"
touch "$HOME/.ssh/authorized_keys"
chmod 700 "$HOME/.ssh"
chmod 600 "$HOME/.ssh/authorized_keys"
grep -qxF "$key" "$HOME/.ssh/authorized_keys" || printf '%s\n' "$key" >> "$HOME/.ssh/authorized_keys"
`

  await runSsh({ host, connection }, ['bash', '-s', '--', normalizedKey], script)
}
