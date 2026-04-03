import { execFile } from 'child_process'
import path from 'path'

function getPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShellJson(script: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile(
      getPowerShellPath(),
      ['-NoProfile', '-STA', '-Command', script],
      {
        windowsHide: true,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message))
          return
        }

        const trimmed = stdout.trim()
        if (!trimmed) {
          resolve(null)
          return
        }

        try {
          resolve(JSON.parse(trimmed))
        } catch (parseError) {
          reject(new Error(`Dialog response parse failed: ${String(parseError)}`))
        }
      }
    )
  })
}

export async function pickFolderDialog(initialPath?: string): Promise<string[]> {
  if (process.platform !== 'win32') {
    throw new Error('\u30cd\u30a4\u30c6\u30a3\u30d6\u306e\u30d5\u30a9\u30eb\u30c0\u9078\u629e\u306f Windows \u306e\u307f\u5bfe\u5fdc\u3067\u3059\u3002')
  }

  const safeInitialPath = JSON.stringify(initialPath?.trim() || '')
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '\u4fdd\u5b58\u5148\u306b\u4f7f\u3046\u30d5\u30a9\u30eb\u30c0\u3092\u9078\u629e'
    $dialog.ShowNewFolderButton = $true
    $initialPath = ${safeInitialPath}
    if ($initialPath -and (Test-Path -LiteralPath $initialPath -PathType Container)) {
      $dialog.SelectedPath = (Resolve-Path -LiteralPath $initialPath).Path
    } else {
      $dialog.SelectedPath = [Environment]::GetFolderPath('Desktop')
    }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      @((Resolve-Path -LiteralPath $dialog.SelectedPath).Path) | ConvertTo-Json -Compress
    } else {
      @() | ConvertTo-Json -Compress
    }
  `

  const result = await runPowerShellJson(script)
  if (Array.isArray(result)) {
    return result.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  }

  return []
}

export async function pickSaveFileDialog(defaultName: string): Promise<string | null> {
  if (process.platform !== 'win32') {
    throw new Error('\u4fdd\u5b58\u5148\u306e\u9078\u629e\u306f Windows \u306e\u307f\u5bfe\u5fdc\u3067\u3059\u3002')
  }

  const safeDefaultName = JSON.stringify(defaultName || 'download.txt')
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.SaveFileDialog
    $dialog.Title = '\u4fdd\u5b58\u5148\u3092\u9078\u629e'
    $dialog.FileName = ${safeDefaultName}
    $dialog.InitialDirectory = [Environment]::GetFolderPath('Desktop')
    $dialog.OverwritePrompt = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $dialog.FileName | ConvertTo-Json -Compress
    } else {
      $null | ConvertTo-Json -Compress
    }
  `

  const result = await runPowerShellJson(script)
  return typeof result === 'string' && result.trim() ? result.trim() : null
}
