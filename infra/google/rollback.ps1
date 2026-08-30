[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Service,
  [Parameter(Mandatory)][string]$Revision,
  [string]$ProjectId = 'your-gcp-project',
  [string]$Region = 'asia-southeast2',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
if ($WhatIf) { Write-Output "PLAN gcloud run services update-traffic $Service --to-revisions=$Revision=100"; return }
& $gcloud run services update-traffic $Service "--to-revisions=$Revision=100" "--region=$Region" "--project=$ProjectId"
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run rollback failed.' }
Write-Output "rollbackService=$Service"
Write-Output "rollbackRevision=$Revision"