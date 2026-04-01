import { execFile } from 'child_process'
import path from 'path'

function getPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShellJson(script: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const ps = execFile(
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

          if (typeof parsed === 'string' && parsed.trim()) {
            resolve([parsed.trim()])
            return
          }

          resolve([])
        } catch (parseError) {
          reject(new Error(`Dialog response parse failed: ${String(parseError)}`))
        }
      }
    )

    ps.on('error', reject)
  })
}

export async function pickFilesDialog(): Promise<string[]> {
  if (process.platform !== 'win32') {
    throw new Error('Native file dialog is only supported on Windows in the current implementation.')
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = '入力ファイルを選択'
    $dialog.Filter = 'All files (*.*)|*.*'
    $dialog.Multiselect = $true
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      $dialog.FileNames | ConvertTo-Json -Compress
    } else {
      @() | ConvertTo-Json -Compress
    }
  `

  return runPowerShellJson(script)
}

export async function pickFolderDialog(): Promise<string[]> {
  if (process.platform !== 'win32') {
    throw new Error('Native folder dialog is only supported on Windows in the current implementation.')
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '入力フォルダを選択'
    $dialog.ShowNewFolderButton = $false
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      @($dialog.SelectedPath) | ConvertTo-Json -Compress
    } else {
      @() | ConvertTo-Json -Compress
    }
  `

  return runPowerShellJson(script)
}
