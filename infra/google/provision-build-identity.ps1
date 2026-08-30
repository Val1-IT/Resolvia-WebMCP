[CmdletBinding()]
param(
  [string]$ProjectId = 'your-gcp-project',
  [string]$Region = 'asia-southeast2',
  [string]$OperatorEmail = 'competition-operator@example.com',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
# COMPETITION SNAPSHOT: placeholder only — not a production operator identity.
# Pass -OperatorEmail with your own operator before any private deploy.
$trustedOperatorEmail = 'competition-operator@example.com'
if ($OperatorEmail -cne $trustedOperatorEmail) { throw "Trusted operator must be exactly $trustedOperatorEmail." }
$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
Import-LocalizedData -BindingVariable buildAuthorityPolicy -BaseDirectory $PSScriptRoot -FileName 'build-authority-policy.psd1'

$buildAccountName = [string]$buildAuthorityPolicy.BuildServiceAccountName
if (-not $buildAccountName) { $buildAccountName = 'resolvia-build' }
$buildAccount = "$buildAccountName@$ProjectId.iam.gserviceaccount.com"
$buildMember = "serviceAccount:$buildAccount"
$operatorMember = "user:$OperatorEmail"
$repository = [string]$buildAuthorityPolicy.ArtifactRepository
if (-not $repository) { $repository = 'resolvia' }

function Read-Gcloud([string[]]$Arguments, [string]$Label) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = @(& $gcloud @Arguments 2>$null)
    if ($LASTEXITCODE -ne 0) { throw "$Label could not be inspected." }
    return @($output | ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ })
  } finally { $ErrorActionPreference = $previous }
}
function Test-GcloudResource([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $gcloud @Arguments 1>$null 2>$null
    return ($LASTEXITCODE -eq 0)
  } finally { $ErrorActionPreference = $previous }
}
function Invoke-Write([string[]]$Arguments) {
  if ($WhatIf) {
    Write-Output "PLAN gcloud $($Arguments -join ' ')"
    return
  }
  & $gcloud @Arguments
  if ($LASTEXITCODE -ne 0) { throw "gcloud mutation failed: $($Arguments -join ' ')" }
}
function Ensure-CustomRole([string]$RoleId, [string]$Title, [string]$Description, [string[]]$Permissions) {
  $roleName = "projects/$ProjectId/roles/$RoleId"
  $roleArguments = @('iam','roles','describe',$RoleId,"--project=$ProjectId",'--format=value(includedPermissions)')
  $existingRoleNames = @(Read-Gcloud @('iam','roles','list',"--project=$ProjectId",'--show-deleted',"--filter=name:$roleName",'--format=value(name)') "Custom role inventory for $RoleId")
  if ($existingRoleNames.Count -gt 1 -or ($existingRoleNames.Count -eq 1 -and $existingRoleNames[0] -ne $roleName)) {
    throw "Custom role inventory for $RoleId is inconsistent."
  }
  if ($existingRoleNames.Count -eq 1) {
    $actualPermissions = @(Read-Gcloud $roleArguments "Custom role $RoleId" | ForEach-Object { $_ -split '[,;]' } | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object -Unique)
    $expectedPermissions = @($Permissions | Sort-Object -Unique)
    if (($actualPermissions -join "`n") -ne ($expectedPermissions -join "`n")) {
      throw "Existing custom role $RoleId does not match the exact approved permission definition."
    }
    return
  }
  Invoke-Write @(
    'iam','roles','create',$RoleId,"--project=$ProjectId","--title=$Title","--description=$Description",
    "--permissions=$($Permissions -join ',')",'--stage=GA'
  )
}

$activeAccount = @(& $gcloud config get-value account 2>$null)
if ($LASTEXITCODE -ne 0 -or ($activeAccount -join '').Trim() -ne $OperatorEmail) {
  throw 'Dedicated build identity provisioning requires the exact authorized operator account.'
}
$projectNumberValues = @(Read-Gcloud @('projects','describe',$ProjectId,'--format=value(projectNumber)') 'Project number')
if ($projectNumberValues.Count -ne 1 -or $projectNumberValues[0] -notmatch '^[0-9]+$') { throw 'Project number is unavailable.' }
$projectNumber = $projectNumberValues[0]

$serviceAccountExists = Test-GcloudResource @('iam','service-accounts','describe',$buildAccount,"--project=$ProjectId")
if (-not (Test-GcloudResource @('artifacts','repositories','describe',$repository,"--location=$Region","--project=$ProjectId"))) {
  throw 'Existing Resolvia Artifact Registry repository is unavailable.'
}
$sourceBucket = "gs://$($ProjectId)_$($Region)_cloudbuild"
$logBucket = "gs://$projectNumber-$Region-cloudbuild-logs"
$sourceBucketExists = Test-GcloudResource @('storage','buckets','describe',$sourceBucket,"--project=$ProjectId")
$logBucketExists = Test-GcloudResource @('storage','buckets','describe',$logBucket,"--project=$ProjectId")

$artifactWriter = @($buildAuthorityPolicy.BuildRoleDefinitions | Where-Object { $_['Name'] -eq 'resolviaBuildArtifactWriter' })
$sourceReader = @($buildAuthorityPolicy.BuildRoleDefinitions | Where-Object { $_['Name'] -eq 'resolviaBuildSourceReader' })
$logWriter = @($buildAuthorityPolicy.BuildRoleDefinitions | Where-Object { $_['Name'] -eq 'resolviaBuildLogWriter' })
if ($artifactWriter.Count -ne 1 -or $sourceReader.Count -ne 1 -or $logWriter.Count -ne 1) {
  throw 'Build authority policy is incomplete.'
}
$artifactWriterRoleId = [string]$artifactWriter[0]['Name']
$sourceReaderRoleId = [string]$sourceReader[0]['Name']
$logWriterRoleId = [string]$logWriter[0]['Name']
Ensure-CustomRole $artifactWriterRoleId 'Resolvia Build Artifact Writer' 'Exact candidate image upload and download authority.' @($artifactWriter[0]['Permissions'])
Ensure-CustomRole $sourceReaderRoleId 'Resolvia Build Source Reader' 'Exact immutable staged source read authority.' @($sourceReader[0]['Permissions'])
Ensure-CustomRole $logWriterRoleId 'Resolvia Build Log Writer' 'Exact regional build log create authority.' @($logWriter[0]['Permissions'])

if (-not $serviceAccountExists) {
  Invoke-Write @('iam','service-accounts','create',$buildAccountName,'--display-name=Resolvia dedicated candidate build identity',"--project=$ProjectId")
}
if (-not $sourceBucketExists) {
  Invoke-Write @('storage','buckets','create',$sourceBucket,"--location=$Region",'--uniform-bucket-level-access',"--project=$ProjectId")
}
if (-not $logBucketExists) {
  Invoke-Write @('storage','buckets','create',$logBucket,"--location=$Region",'--uniform-bucket-level-access',"--project=$ProjectId")
}

Invoke-Write @('iam','service-accounts','add-iam-policy-binding',$buildAccount,"--member=$operatorMember",'--role=roles/iam.serviceAccountUser',"--project=$ProjectId")
Invoke-Write @('artifacts','repositories','add-iam-policy-binding',$repository,"--member=$buildMember","--role=projects/$ProjectId/roles/$artifactWriterRoleId","--location=$Region", "--project=$ProjectId")
Invoke-Write @('storage','buckets','add-iam-policy-binding',$sourceBucket,"--member=$buildMember","--role=projects/$ProjectId/roles/$sourceReaderRoleId","--project=$ProjectId")
Invoke-Write @('storage','buckets','add-iam-policy-binding',$logBucket,"--member=$buildMember","--role=projects/$ProjectId/roles/$logWriterRoleId","--project=$ProjectId")

Write-Output "buildServiceAccount=$buildAccount"
Write-Output "sourceBucket=$sourceBucket"
Write-Output "logBucket=$logBucket"
Write-Output "artifactRole=projects/$ProjectId/roles/$artifactWriterRoleId"
Write-Output "sourceRole=projects/$ProjectId/roles/$sourceReaderRoleId"
Write-Output "logRole=projects/$ProjectId/roles/$logWriterRoleId"
Write-Output "projectRoles=none"
