[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SecretId,
  [Parameter(Mandatory)][string]$AccessorMember,
  [Parameter(Mandatory)][string]$SecretPayloadFile,
  [string]$ProjectId = 'your-gcp-project',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
if (-not (Test-Path -LiteralPath $SecretPayloadFile)) { throw "Secret payload file not found: $SecretPayloadFile" }

# M4 ordering: verify accessor proof BEFORE creating a secret version.
$policyJson = & $gcloud secrets get-iam-policy $SecretId "--project=$ProjectId" --format=json
if ($LASTEXITCODE -ne 0) { throw "Failed to read IAM policy for secret $SecretId" }
$policy = $policyJson | ConvertFrom-Json
$hasAccessor = $false
foreach ($binding in @($policy.bindings)) {
  if ($binding.role -ne 'roles/secretmanager.secretAccessor') { continue }
  if (@($binding.members) -contains $AccessorMember) { $hasAccessor = $true }
}
if (-not $hasAccessor) {
  throw "ACCESSOR_PROOF_REQUIRED_BEFORE_VERSION: $AccessorMember lacks roles/secretmanager.secretAccessor on $SecretId"
}
Write-Output "verifiedAccessor=$AccessorMember"

if ($WhatIf) {
  Write-Output "PLAN gcloud secrets versions add $SecretId --data-file=$SecretPayloadFile --project=$ProjectId"
  return
}

& $gcloud secrets versions add $SecretId "--data-file=$SecretPayloadFile" "--project=$ProjectId"
if ($LASTEXITCODE -ne 0) { throw "Failed to create secret version for $SecretId" }
Write-Output "secretVersionCreated=$SecretId"
