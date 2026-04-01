import { execFile } from 'child_process'
import path from 'path'

function getPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShellJson(script: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(
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
          resolve([])
          return
        }

        try {
          const parsed = JSON.parse(trimmed)
          if (Array.isArray(parsed)) {
            resolve(parsed.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))
            return
          }

          resolve(typeof parsed === 'string' && parsed.trim() ? [parsed.trim()] : [])
        } catch (parseError) {
          reject(new Error(`Dialog response parse failed: ${String(parseError)}`))
        }
      }
    )

    child.on('error', reject)
  })
}

export async function pickFolderDialog(): Promise<string[]> {
  if (process.platform !== 'win32') {
    throw new Error('ネイティブフォルダ選択は Windows 実装のみです。')
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = 'ワークスペースとして使うフォルダを選択'
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      @($dialog.SelectedPath) | ConvertTo-Json -Compress
    } else {
      @() | ConvertTo-Json -Compress
    }
  `

  return runPowerShellJson(script)
}
