[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$EngineUrl,
  [string]$ProjectId = 'your-gcp-project',
  [string]$Region = 'asia-southeast2',
  [string]$OperatorEmail = 'competition-operator@example.com',
  [switch]$PrepareOnly,
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
$webSa = "resolvia-web@$ProjectId.iam.gserviceaccount.com"
$engineSa = "resolvia-engine@$ProjectId.iam.gserviceaccount.com"
$pushSa = "resolvia-pubsub-push@$ProjectId.iam.gserviceaccount.com"
$providerPushSaName = 'resolvia-provider-push'
$partnerPushSaName = 'resolvia-partner-push'
$providerPushSa = "$providerPushSaName@$ProjectId.iam.gserviceaccount.com"
$partnerPushSa = "$partnerPushSaName@$ProjectId.iam.gserviceaccount.com"
$repo = 'resolvia'
$topic = 'resolution-events-v1'
$subscription = 'resolution-engine-v1'
$dlqTopic = 'resolution-events-dlq-v1'
$dlqSubscription = 'resolution-events-dlq-review-v1'
$projectNumber = (& $gcloud projects describe $ProjectId --format='value(projectNumber)').Trim()
$pubsubAgent = "service-$projectNumber@gcp-sa-pubsub.iam.gserviceaccount.com"

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
function Ensure-Topic([string]$Name) {
  if (-not (Test-Gcloud @('pubsub','topics','describe',$Name,"--project=$ProjectId"))) {
    Invoke-Apply @('pubsub','topics','create',$Name,"--project=$ProjectId")
  }
}
function Ensure-PushTokenCreator([string]$PushServiceAccount) {
  # Exact managed Pub/Sub agent principal only â€” no service-* wildcards.
  Invoke-Apply @('iam','service-accounts','add-iam-policy-binding',$PushServiceAccount,"--member=serviceAccount:$pubsubAgent",'--role=roles/iam.serviceAccountTokenCreator',"--project=$ProjectId")
}

function Invoke-PrepareOnlyIdentities {
  # PrepareOnly prepares provider/partner identities without modifying push
  # subscription config or revoking legacy TokenCreator on resolvia-pubsub-push.
  Ensure-ServiceAccount $providerPushSaName 'Resolvia provider Pub/Sub push identity'
  Ensure-ServiceAccount $partnerPushSaName 'Resolvia partner Pub/Sub push identity'
  Ensure-PushTokenCreator $providerPushSa
  Ensure-PushTokenCreator $partnerPushSa
  Invoke-Apply @('run','services','add-iam-policy-binding','resolvia-engine',"--member=serviceAccount:$providerPushSa",'--role=roles/run.invoker',"--region=$Region","--project=$ProjectId")
  Invoke-Apply @('run','services','add-iam-policy-binding','resolvia-engine',"--member=serviceAccount:$partnerPushSa",'--role=roles/run.invoker',"--region=$Region","--project=$ProjectId")
  Write-Output "prepareOnly=true"
  Write-Output "providerPushServiceAccount=$providerPushSa"
  Write-Output "partnerPushServiceAccount=$partnerPushSa"
  Write-Output "legacyPushServiceAccount=$pushSa"
  Write-Output "pushConfigUnchanged=true"
  Write-Output "legacyTokenCreatorPreserved=true"
}

if ($PrepareOnly) {
  Invoke-PrepareOnlyIdentities
  return
}

Ensure-ServiceAccount 'resolvia-web' 'Resolvia web runtime'
Ensure-ServiceAccount 'resolvia-engine' 'Resolvia engine runtime'
Ensure-ServiceAccount 'resolvia-pubsub-push' 'Resolvia Pub/Sub push identity'
if (-not (Test-Gcloud @('artifacts','repositories','describe',$repo,"--location=$Region","--project=$ProjectId"))) {
  Invoke-Apply @('artifacts','repositories','create',$repo,'--repository-format=docker',"--location=$Region","--project=$ProjectId")
}
Ensure-Topic $topic
Ensure-Topic $dlqTopic
if (-not (Test-Gcloud @('pubsub','subscriptions','describe',$dlqSubscription,"--project=$ProjectId"))) {
  Invoke-Apply @('pubsub','subscriptions','create',$dlqSubscription,"--topic=$dlqTopic",'--message-retention-duration=1d',"--project=$ProjectId")
}

Invoke-Apply @('pubsub','topics','add-iam-policy-binding',$topic,"--member=serviceAccount:$webSa",'--role=roles/pubsub.publisher',"--project=$ProjectId")
Invoke-Apply @('secrets','add-iam-policy-binding','resolvia-demo-provider-hmac',"--member=serviceAccount:$webSa",'--role=roles/secretmanager.secretAccessor',"--project=$ProjectId")
Invoke-Apply @('projects','add-iam-policy-binding',$ProjectId,"--member=serviceAccount:$engineSa",'--role=roles/datastore.user')
Ensure-PushTokenCreator $pushSa
Invoke-Apply @('pubsub','topics','add-iam-policy-binding',$dlqTopic,"--member=serviceAccount:$pubsubAgent",'--role=roles/pubsub.publisher',"--project=$ProjectId")

if (-not (Test-Gcloud @('pubsub','subscriptions','describe',$subscription,"--project=$ProjectId"))) {
  Invoke-Apply @('pubsub','subscriptions','create',$subscription,"--topic=$topic",'--enable-message-ordering','--ack-deadline=60','--min-retry-delay=10s','--max-retry-delay=600s','--message-retention-duration=1d','--max-delivery-attempts=5',"--dead-letter-topic=$dlqTopic","--push-endpoint=$EngineUrl/api/internal/pubsub/resolution-events","--push-auth-service-account=$pushSa","--push-auth-token-audience=$EngineUrl","--project=$ProjectId")
}
Invoke-Apply @('run','services','add-iam-policy-binding','resolvia-engine',"--member=serviceAccount:$pushSa",'--role=roles/run.invoker',"--region=$Region","--project=$ProjectId")
Invoke-Apply @('run','services','add-iam-policy-binding','resolvia-engine',"--member=serviceAccount:$webSa",'--role=roles/run.invoker',"--region=$Region","--project=$ProjectId")
Write-Output "webServiceAccount=$webSa"
Write-Output "engineServiceAccount=$engineSa"
Write-Output "pushServiceAccount=$pushSa"
