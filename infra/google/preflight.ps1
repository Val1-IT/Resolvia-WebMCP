[CmdletBinding()]
param(
  [string]$ProjectId = 'your-gcp-project',
  [string]$Region = 'asia-southeast2'
)

$ErrorActionPreference = 'Stop'
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
$requiredApis = @('run.googleapis.com','artifactregistry.googleapis.com','cloudbuild.googleapis.com','pubsub.googleapis.com','secretmanager.googleapis.com','firestore.googleapis.com')

function Require-Equal([string]$Actual, [string]$Expected, [string]$Label) {
  if ($Actual -ne $Expected) { throw "$Label must be $Expected." }
}

Require-Equal (& $gcloud config get-value project 2>$null).Trim() $ProjectId 'Active project'
if ((& $gcloud billing projects describe $ProjectId --format='value(billingEnabled)').Trim() -ne 'True') { throw 'Billing must be enabled.' }
$enabled = @(& $gcloud services list --enabled --project $ProjectId --format='value(config.name)')
foreach ($api in $requiredApis) { if ($enabled -notcontains $api) { throw "Required API is disabled: $api" } }
& $gcloud firestore databases describe --project $ProjectId --database='(default)' --format='value(name)' | Out-Null
& $gcloud secrets describe resolvia-demo-provider-hmac --project $ProjectId --format='value(name)' | Out-Null
& $gcloud run regions list --format='value(locationId)' | Select-String -SimpleMatch $Region | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Cloud Run region is unavailable: $Region" }
Write-Output 'preflight=PASS'