# Windows auto-deploy. Run by the KrosshairDeploy scheduled task every few minutes.
# Install: Copy-Item C:\krosshair\deploy\windows-deploy.ps1 C:\krosshair-deploy\deploy.ps1 -Force
# A copy is used, not this file, so the script is never overwritten while it is running.
Set-Location C:\krosshair
$log = 'C:\krosshair-logs\deploy.log'
git fetch origin main 2>&1 | Out-Null
$have = (git rev-parse HEAD).Trim()
$want = (git rev-parse origin/main).Trim()
if ($have -eq $want) { exit 0 }
Add-Content $log "$(Get-Date -Format s) new commit $have -> $want"
git reset --hard origin/main 2>&1 | Add-Content $log
$changed = git diff --name-only $have $want
if ($changed -match '^package(-lock)?\.json$') { npm.cmd install 2>&1 | Add-Content $log }

function Get-Game { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*multiplayer-server*' } }

# Windows never sends the stop signal the game listens for, so ask it with a file instead. It warns the
# players, saves, and exits; NSSM then starts it again on the new code. An older server that does not watch
# for the file leaves it in place, and that is the cue to fall back to stopping the service by force.
$flag = 'C:\krosshair\data\restart.flag'
$old = Get-Game | Select-Object -First 1
$graceful = $false
if ($old) {
  New-Item -ItemType Directory -Force -Path (Split-Path $flag) | Out-Null
  New-Item -ItemType File -Force -Path $flag | Out-Null
  Start-Sleep -Seconds 4
  if (Test-Path $flag) {
    Remove-Item $flag -Force -ErrorAction SilentlyContinue
  } else {
    $until = (Get-Date).AddSeconds(80)
    while ((Get-Process -Id $old.ProcessId -ErrorAction SilentlyContinue) -and (Get-Date) -lt $until) { Start-Sleep -Seconds 2 }
    $graceful = -not (Get-Process -Id $old.ProcessId -ErrorAction SilentlyContinue)
  }
}

if ($graceful) {
  Start-Sleep -Seconds 8
  Add-Content $log "$(Get-Date -Format s) graceful restart: players were warned"
} else {
  Add-Content $log "$(Get-Date -Format s) forced restart: no warning sent"
  nssm stop krosshair 2>&1 | Out-Null
  $until = (Get-Date).AddSeconds(30)
  while ((nssm status krosshair) -notmatch 'STOPPED' -and (Get-Date) -lt $until) { Start-Sleep -Seconds 2 }
  if ((nssm status krosshair) -notmatch 'STOPPED') {
    Get-Game | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Start-Sleep -Seconds 3
  }
  if ((nssm status krosshair) -notmatch 'STOPPED') {
    $svcPid = ((sc.exe queryex krosshair | Select-String 'PID').ToString() -replace '\D', '')
    if ($svcPid -and $svcPid -ne '0') { taskkill /F /PID $svcPid | Out-Null }
    Start-Sleep -Seconds 3
  }
}

if ((nssm status krosshair) -notmatch 'RUNNING') { nssm start krosshair 2>&1 | Out-Null }
Add-Content $log "$(Get-Date -Format s) deploy complete $want, service $(nssm status krosshair)"
