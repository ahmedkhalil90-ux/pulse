# Pulse beta deploy: migrations -> rules -> backfill -> build -> hosting.
# Run from C:\pulse in PowerShell:  powershell -ExecutionPolicy Bypass -File scripts\deploy-beta.ps1
# Every live step shows a dry run first and waits for you to type YES.
# 'Continue', not 'Stop': Firebase and npx print progress on stderr, which
# Windows PowerShell treats as a terminating error under 'Stop'. Each step is
# checked by its exit code instead.
$ErrorActionPreference = 'Continue'
$project = 'pulse-app-66d7a'
Set-Location (Split-Path $PSScriptRoot -Parent)

function Confirm-Step($msg) {
  $a = Read-Host "$msg  Type YES to continue"
  if ($a -ne 'YES') { Write-Host 'Stopped. Nothing further was changed.' -ForegroundColor Yellow; exit 1 }
}
function Run($cmd) {
  Write-Host "> $cmd" -ForegroundColor DarkGray
  cmd /c "$cmd 2>&1"
  if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $cmd" -ForegroundColor Red; exit 1 }
}

Write-Host '1/6 Updating code and dependencies' -ForegroundColor Cyan
Run 'git pull --ff-only'
Run 'npm ci --no-audit --no-fund --loglevel=error'

Write-Host '2/6 Checking Firebase login' -ForegroundColor Cyan
cmd /c "firebase projects:list >nul 2>&1"
if ($LASTEXITCODE -ne 0) { firebase login }

Write-Host '3/6 Firebase service key (used by the migrations; stays on this laptop)' -ForegroundColor Cyan
$key = Join-Path (Get-Location) '.secrets\service-account.json'
if (-not (Test-Path $key)) {
  New-Item -ItemType Directory -Force -Path (Split-Path $key) | Out-Null
  Start-Process "https://console.firebase.google.com/project/$project/settings/serviceaccounts/adminsdk"
  Write-Host 'In the page that just opened: click "Generate new private key", then "Generate key".' -ForegroundColor Yellow
  Write-Host "Save the downloaded file as: $key" -ForegroundColor Yellow
  Read-Host 'Press Enter once it is saved there'
  if (-not (Test-Path $key)) { Write-Host "No key at $key. Stopped; nothing was changed." -ForegroundColor Red; exit 1 }
}
$env:PULSE_SA_KEY = $key

Write-Host '4/6 Group membership migration (must run BEFORE the new rules)' -ForegroundColor Cyan
Run 'npx tsx scripts/migrate-group-members.ts --dry-run'
Confirm-Step 'Dry run above. Apply the group migration to LIVE data?'
Run 'npx tsx scripts/migrate-group-members.ts'

Write-Host '5/6 Deploying security rules and indexes, then the lookup backfill' -ForegroundColor Cyan
Confirm-Step 'Deploy the new Firestore rules and indexes to LIVE?'
Run "firebase deploy --only firestore:rules,firestore:indexes --project $project"
Run 'npx tsx scripts/backfill-lookups.ts --dry-run'
Confirm-Step 'Dry run above. Apply the lookup backfill to LIVE data?'
Run 'npx tsx scripts/backfill-lookups.ts'

Write-Host '6/6 Building and publishing the web app' -ForegroundColor Cyan
Run 'npm run build'
Run "firebase deploy --only hosting --project $project"
Write-Host ''
Write-Host "LIVE: https://$project.web.app" -ForegroundColor Green
Write-Host 'Open it on your phone, then use the browser menu > Add to Home screen.' -ForegroundColor Green
