[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('PreCutover','Final')][string]$Mode,
  [Parameter(Mandatory)][string]$ProjectId
)

$ErrorActionPreference = 'Stop'
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }

$legacyPushSa = "resolvia-pubsub-push@$ProjectId.iam.gserviceaccount.com"
$providerPushSa = "resolvia-provider-push@$ProjectId.iam.gserviceaccount.com"
$partnerPushSa = "resolvia-partner-push@$ProjectId.iam.gserviceaccount.com"
$projectNumber = (& $gcloud projects describe $ProjectId --format='value(projectNumber)').Trim()
$pubsubAgent = "serviceAccount:service-$projectNumber@gcp-sa-pubsub.iam.gserviceaccount.com"
$tokenCreator = 'roles/iam.serviceAccountTokenCreator'

function Test-ServiceAccountExists([string]$ServiceAccount) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $gcloud iam service-accounts describe $ServiceAccount "--project=$ProjectId" 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Get-ServiceAccountPolicy([string]$ServiceAccount) {
  $json = & $gcloud iam service-accounts get-iam-policy $ServiceAccount "--project=$ProjectId" --format=json
  if ($LASTEXITCODE -ne 0) { throw "Failed to read IAM policy for $ServiceAccount" }
  return ($json | ConvertFrom-Json)
}

function Assert-ExactCanonicalTokenCreatorOnly([string]$ServiceAccount, [string]$MissingCode) {
  $doc = Get-ServiceAccountPolicy $ServiceAccount
  $members = @()
  foreach ($binding in @($doc.bindings)) {
    $role = [string]$binding.role
    if ($role -ne $tokenCreator) {
      throw "UNEXPECTED_TOKEN_CREATOR_BINDING: $ServiceAccount has unexpected role $role"
    }
    foreach ($member in @($binding.members)) {
      if ($member -ne $pubsubAgent) {
        throw "UNEXPECTED_TOKEN_CREATOR_BINDING: $ServiceAccount has $member"
      }
      $members += $member
    }
  }
  if ($members -notcontains $pubsubAgent) {
    throw "${MissingCode}: requires exact Pub/Sub agent TokenCreator on $ServiceAccount"
  }
}

Write-Output "c1-authority mode=$Mode project=$ProjectId"

if ($Mode -eq 'PreCutover') {
  # PreCutover (post-PrepareOnly, pre-M1): exact canonical Pub/Sub agent
  # TokenCreator on legacy + provider + partner. Exact-set only.
  if (-not (Test-ServiceAccountExists $legacyPushSa)) {
    throw 'MISSING_LEGACY_TOKEN_CREATOR: PreCutover requires legacy push SA with exact Pub/Sub agent TokenCreator.'
  }
  Assert-ExactCanonicalTokenCreatorOnly $legacyPushSa 'MISSING_LEGACY_TOKEN_CREATOR'

  foreach ($sa in @($providerPushSa, $partnerPushSa)) {
    if (-not (Test-ServiceAccountExists $sa)) {
      throw "MISSING_DEDICATED_TOKEN_CREATOR: PreCutover requires prepared push SA $sa"
    }
    Assert-ExactCanonicalTokenCreatorOnly $sa 'MISSING_DEDICATED_TOKEN_CREATOR'
  }

  Write-Output 'c1-authority: PASS PreCutover (legacy+provider+partner TokenCreator)'
  return
}

# Final requires legacy TokenCreator absent; provider + partner exact bindings present.
if (Test-ServiceAccountExists $legacyPushSa) {
  $legacyDoc = Get-ServiceAccountPolicy $legacyPushSa
  foreach ($binding in @($legacyDoc.bindings)) {
    if ([string]$binding.role -eq $tokenCreator -and @($binding.members).Count -gt 0) {
      throw 'LEGACY_TOKEN_CREATOR_PRESENT: Final requires legacy push TokenCreator absent.'
    }
  }
}

foreach ($sa in @($providerPushSa, $partnerPushSa)) {
  if (-not (Test-ServiceAccountExists $sa)) {
    throw "MISSING_DEDICATED_TOKEN_CREATOR: Final requires Pub/Sub agent TokenCreator on $sa"
  }
  Assert-ExactCanonicalTokenCreatorOnly $sa 'MISSING_DEDICATED_TOKEN_CREATOR'
}

Write-Output 'c1-authority: PASS Final (provider+partner TokenCreator; legacy absent)'
