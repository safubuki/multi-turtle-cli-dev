$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $scriptDir

$port = 3001

try {
  $listenerIds = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)

  foreach ($listenerId in $listenerIds) {
    try {
      $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $listenerId"
      $commandLine = $processInfo.CommandLine

      if ($commandLine -and $commandLine -match 'turtle-brain') {
        Stop-Process -Id $listenerId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 300
      }
    } catch {
      # Ignore stale process lookup failures.
    }
  }
} catch {
  # Ignore port lookup failures and let the server startup surface any issue.
}

& .\node_modules\.bin\nodemon.cmd --watch . --ext ts,mjs --exec "ts-node index.ts"
