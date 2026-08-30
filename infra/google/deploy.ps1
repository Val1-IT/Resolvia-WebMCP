[CmdletBinding()]
param(
  [string]$ProjectId = 'your-gcp-project',
  [string]$Region = 'asia-southeast2',
  [string]$OperatorEmail = 'competition-operator@example.com',
  [switch]$WhatIf,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
$repo = 'resolvia'
$webService = 'resolvia-web'
$engineService = 'resolvia-engine'
$topic = 'resolution-events-v1'
$subscription = 'resolution-engine-v1'
$webSa = "resolvia-web@$ProjectId.iam.gserviceaccount.com"
$engineSa = "resolvia-engine@$ProjectId.iam.gserviceaccount.com"
$pushSa = "resolvia-pubsub-push@$ProjectId.iam.gserviceaccount.com"
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$revision = (& git -c "safe.directory=$workspace" rev-parse --short=12 HEAD).Trim()
$image = "$Region-docker.pkg.dev/$ProjectId/$repo/resolvia:$revision"

function Invoke-Apply([string[]]$Arguments) {
  if ($WhatIf) { Write-Output ('PLAN gcloud ' + ($Arguments -join ' ')); return }
  & $gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($Arguments -join ' ')" }
}
function Test-Gcloud([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $gcloud @Arguments 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } finally {
    $ErrorActionPreference = $previous
  }
}
function Ensure-ServiceAccount([string]$Name, [string]$DisplayName) {
  $email = "$Name@$ProjectId.iam.gserviceaccount.com"
  if (-not (Test-Gcloud @('iam','service-accounts','describe',$email,"--project=$ProjectId"))) {
    Invoke-Apply @('iam','service-accounts','create',$Name,"--display-name=$DisplayName","--project=$ProjectId")
  }
}
function Ensure-OperatorActAs([string]$ServiceAccount) {
  Invoke-Apply @('iam','service-accounts','add-iam-policy-binding',$ServiceAccount,"--member=user:$OperatorEmail",'--role=roles/iam.serviceAccountUser',"--project=$ProjectId")
}
function Ensure-ArtifactRepository() {
  if (-not (Test-Gcloud @('artifacts','repositories','describe',$repo,"--location=$Region","--project=$ProjectId"))) {
    Invoke-Apply @('artifacts','repositories','create',$repo,'--repository-format=docker',"--location=$Region","--project=$ProjectId")
  }
}
function Service-Url([string]$Service) {
  return (& $gcloud run services describe $Service "--region=$Region" "--project=$ProjectId" --format='value(status.url)').Trim()
}
function Deploy-Service([string]$Service, [string]$ServiceAccount, [string]$WebUrl, [string]$EngineUrl) {
  $envVars = @(
    'RESOLVIA_RUNTIME_MODE=CONNECTED',
    "GOOGLE_CLOUD_PROJECT=$ProjectId",
    "RESOLVIA_GCP_REGION=$Region",
    "RESOLVIA_PUBSUB_TOPIC=$topic",
    "RESOLVIA_PUBSUB_SUBSCRIPTION=$subscription",
    "RESOLVIA_PUBSUB_PUSH_SERVICE_ACCOUNT=$pushSa",
    "RESOLVIA_WEB_URL=$WebUrl",
    "RESOLVIA_ENGINE_AUDIENCE=$EngineUrl",
    'RESOLVIA_FIRESTORE_DATABASE=(default)'
  ) -join ','
  Invoke-Apply @('run','deploy',$Service,"--image=$image","--region=$Region","--project=$ProjectId","--service-account=$ServiceAccount",'--no-allow-unauthenticated','--min-instances=0','--max-instances=2','--cpu=1','--memory=512Mi','--concurrency=20','--timeout=60s','--cpu-throttling','--execution-environment=gen2',"--set-env-vars=$envVars")
}

Ensure-ServiceAccount 'resolvia-web' 'Resolvia web runtime'
Ensure-ServiceAccount 'resolvia-engine' 'Resolvia engine runtime'
Ensure-ServiceAccount 'resolvia-pubsub-push' 'Resolvia Pub/Sub push identity'
Ensure-OperatorActAs $webSa
Ensure-OperatorActAs $engineSa
Ensure-OperatorActAs $pushSa
Ensure-ArtifactRepository
if (-not $SkipBuild) { Invoke-Apply @('builds','submit','--pack',"image=$image","--project=$ProjectId") }
if ($WhatIf) { return }
$placeholderWebUrl = 'https://resolvia-web.invalid'
$placeholderEngineUrl = 'https://resolvia-engine.invalid'
Deploy-Service $engineService $engineSa $placeholderWebUrl $placeholderEngineUrl
$engineUrl = Service-Url $engineService
& (Join-Path $PSScriptRoot 'bootstrap-phase6.ps1') -EngineUrl $engineUrl -ProjectId $ProjectId -Region $Region -OperatorEmail $OperatorEmail
Deploy-Service $webService $webSa $placeholderWebUrl $engineUrl
Invoke-Apply @('run','services','add-iam-policy-binding',$webService,"--member=user:$OperatorEmail",'--role=roles/run.invoker',"--region=$Region","--project=$ProjectId")
$webUrl = Service-Url $webService
Deploy-Service $engineService $engineSa $webUrl $engineUrl
Deploy-Service $webService $webSa $webUrl $engineUrl
Write-Output "webUrl=$webUrl"
Write-Output "engineUrl=$engineUrl"
Write-Output "image=$image"
