import { spawn } from 'child_process'
import type { AgentCliProvider } from './cliRunner'

export interface ProviderInstallSpec {
  provider: AgentCliProvider
  label: string
  command: string
  args: string[]
  displayCommand: string
}

export interface ProviderInstallRuntimeStatus {
  nodeVersion: string | null
  npmCommand: string
  npmVersion: string | null
  npmAvailable: boolean
}

function getNpmCommand(): string {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm'
}

async function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${command} ${args.join(' ')} failed with code ${code}`))
        return
      }

      resolve(stdout.trim() || stderr.trim())
    })
  })
}

export async function getProviderInstallRuntimeStatus(): Promise<ProviderInstallRuntimeStatus> {
  const npmCommand = getNpmCommand()
  let npmVersion: string | null = null

  try {
    npmVersion = await runCommand(npmCommand, ['--version'])
  } catch {
    npmVersion = null
  }

  return {
    nodeVersion: process.version ?? null,
    npmCommand,
    npmVersion,
    npmAvailable: Boolean(npmVersion)
  }
}

export function getProviderInstallSpec(provider: AgentCliProvider): ProviderInstallSpec {
  const npmCommand = getNpmCommand()

  switch (provider) {
    case 'codex':
      return {
        provider,
        label: 'Codex CLI',
        command: npmCommand,
        args: ['install', '-g', '@openai/codex'],
        displayCommand: `${npmCommand} install -g @openai/codex`
      }
    case 'gemini':
      return {
        provider,
        label: 'Gemini CLI',
        command: npmCommand,
        args: ['install', '-g', '@google/gemini-cli'],
        displayCommand: `${npmCommand} install -g @google/gemini-cli`
      }
    case 'copilot':
      return {
        provider,
        label: 'GitHub Copilot CLI',
        command: npmCommand,
        args: ['install', '-g', '@github/copilot'],
        displayCommand: `${npmCommand} install -g @github/copilot`
      }
  }
}

export async function installProviderCli(provider: AgentCliProvider): Promise<{
  spec: ProviderInstallSpec
  stdout: string
  stderr: string
}> {
  const spec = getProviderInstallSpec(provider)
  const runtimeStatus = await getProviderInstallRuntimeStatus()

  if (!runtimeStatus.npmAvailable) {
    throw new Error('NODE_SETUP_REQUIRED')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      windowsHide: true,
      env: {
        ...process.env,
        npm_config_ignore_scripts: 'false'
      }
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `${spec.displayCommand} failed with code ${code}`))
        return
      }

      resolve({
        spec,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      })
    })
  })
}
