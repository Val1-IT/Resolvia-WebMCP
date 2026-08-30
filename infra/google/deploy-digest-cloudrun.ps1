[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('provider-ingress','partner-portal')][string]$Service,
  [Parameter(Mandatory)][string]$ImageDigest,
  [string]$ProjectId = 'your-gcp-project',
  [string]$Region = 'asia-southeast2',
  [string]$ServiceAccount = "resolvia-web@$ProjectId.iam.gserviceaccount.com",
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
if ($ImageDigest -notmatch '@sha256:[a-f0-9]{64}$') {
  throw 'DIGEST_REQUIRED_NO_TAG: image must be an exact digest reference (no tags).'
}
if ($ImageDigest -match ':[^/]+$' -and $ImageDigest -notmatch '@sha256:') {
  throw 'DIGEST_REQUIRED_NO_TAG: tag-based images are forbidden.'
}

$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }

$args = @(
  'run','deploy',$Service,
  "--image=$ImageDigest",
  "--region=$Region",
  "--project=$ProjectId",
  "--service-account=$ServiceAccount",
  '--no-allow-unauthenticated',
  '--ingress=internal-and-cloud-load-balancing'
)

if ($WhatIf) {
  Write-Output ('PLAN gcloud ' + ($args -join ' '))
  return
}

& $gcloud @args
if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($args -join ' ')" }

# M3 immutable proof helpers (operator must capture Ready/digest/traffic).
Write-Output "service=$Service"
Write-Output "image=$ImageDigest"
Write-Output 'privateOnly=true'
Write-Output 'tagForbidden=true'
Write-Output 'audit: require Ready=True, exact digest match, exclusive 100% traffic'
