[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ProjectId,
  [string]$Region = 'asia-southeast2',
  [string]$PolicyPath,
  [string]$OperatorEmail = 'competition-operator@example.com'
)

$ErrorActionPreference = 'Stop'
if (-not $PSScriptRoot) {
  $PSScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $PolicyPath) {
  $PolicyPath = Join-Path $PSScriptRoot 'build-authority-policy.psd1'
}

$gcloud = (Get-Command gcloud -ErrorAction SilentlyContinue).Source
if (-not $gcloud) { $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd' }
if (-not (Test-Path -LiteralPath $gcloud)) { throw 'gcloud CLI was not found.' }
if (-not (Test-Path -LiteralPath $PolicyPath)) { throw "Build authority policy not found: $PolicyPath" }

$policy = Import-PowerShellDataFile -Path $PolicyPath
$buildAccountName = [string]$policy.BuildServiceAccountName
if (-not $buildAccountName) { throw 'IAM_AUTHORITY_UNKNOWN: BuildServiceAccountName is missing from policy.' }
$repository = [string]$policy.ArtifactRepository
if (-not $repository) { $repository = 'resolvia' }
$forbiddenProjectRoles = [System.Collections.Generic.HashSet[string]]::new(
  [string[]]@($policy.ForbiddenProjectRoles)
)
if ($forbiddenProjectRoles.Count -eq 0) {
  throw 'IAM_AUTHORITY_UNKNOWN: ForbiddenProjectRoles is missing from policy.'
}
$roleDefinitions = @($policy.BuildRoleDefinitions)
if ($roleDefinitions.Count -ne 3) {
  throw 'IAM_AUTHORITY_UNKNOWN: BuildRoleDefinitions must define exactly three custom roles.'
}

$buildSa = "$buildAccountName@$ProjectId.iam.gserviceaccount.com"
$buildMember = "serviceAccount:$buildSa"
$operatorMember = "user:$OperatorEmail"

function ConvertFrom-C2Json([string]$Raw, [string]$Label) {
  if ([string]::IsNullOrWhiteSpace($Raw)) {
    throw "IAM_AUTHORITY_UNKNOWN: $Label returned no JSON."
  }
  try {
    return $Raw | ConvertFrom-Json -ErrorAction Stop
  } catch {
    throw "IAM_AUTHORITY_UNKNOWN: $Label returned malformed JSON."
  }
}

function Get-C2Bindings([object]$PolicyDoc, [string]$Label) {
  if ($null -eq $PolicyDoc) { throw "IAM_AUTHORITY_UNKNOWN: $Label is missing." }
  $bindings = @()
  $prop = $PolicyDoc.PSObject.Properties['bindings']
  if ($null -eq $prop -or $null -eq $prop.Value) { return @() }
  foreach ($binding in @($prop.Value)) {
    if ($null -ne $binding) { $bindings += $binding }
  }
  return $bindings
}

function Get-C2Role([object]$Binding) {
  $prop = $Binding.PSObject.Properties['role']
  if ($null -eq $prop -or $null -eq $prop.Value) { return '' }
  return [string]$prop.Value
}

function Get-C2Members([object]$Binding) {
  $members = @()
  $prop = $Binding.PSObject.Properties['members']
  if ($null -eq $prop -or $null -eq $prop.Value) { return @() }
  foreach ($member in @($prop.Value)) {
    if ($member) { $members += [string]$member }
  }
  return $members
}

function ConvertTo-C2CanonicalResource([string]$ResourceFullName) {
  if ([string]::IsNullOrWhiteSpace($ResourceFullName)) {
    throw 'IAM_AUTHORITY_UNKNOWN: IAM resource name is malformed.'
  }
  if ($ResourceFullName -cne '//storage.googleapis.com' -and -not $ResourceFullName.StartsWith('//storage.googleapis.com/')) {
    return $ResourceFullName
  }
  if ($ResourceFullName -cmatch '^//storage\.googleapis\.com/projects/_/buckets/([^/]+)$') {
    return "//storage.googleapis.com/projects/_/buckets/$($Matches[1])"
  }
  if ($ResourceFullName -cmatch '^//storage\.googleapis\.com/([^/]+)$' -and $Matches[1] -cne 'projects') {
    return "//storage.googleapis.com/projects/_/buckets/$($Matches[1])"
  }
  throw "IAM_AUTHORITY_UNKNOWN: Cloud Storage resource name is malformed: $ResourceFullName"
}

function Get-C2BindingKey([string]$Principal, [string]$ResourceFullName, [string]$RoleName) {
  $resource = ConvertTo-C2CanonicalResource -ResourceFullName $ResourceFullName
  return "$Principal|$resource|$RoleName|"
}

function Read-C2RolePermissions([string]$Role) {
  $arguments = $null
  if ($Role -match '^roles/[A-Za-z0-9_.]+$') {
    $arguments = @('iam','roles','describe',$Role,'--format=value(includedPermissions)')
  } elseif ($Role -match '^projects/([^/]+)/roles/([A-Za-z0-9_.]+)$') {
    $arguments = @('iam','roles','describe',$Matches[2],"--project=$($Matches[1])",'--format=value(includedPermissions)')
  } else {
    throw "IAM_AUTHORITY_UNKNOWN: IAM role $Role is malformed."
  }
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $permissions = @(& $gcloud @arguments 2>&1 |
      ForEach-Object { $_.ToString().Trim() } |
      Where-Object { $_ } |
      ForEach-Object { $_ -split '[,;]' } |
      ForEach-Object { $_.Trim() } |
      Where-Object { $_ } |
      Sort-Object -Unique)
    if ($LASTEXITCODE -ne 0 -or $permissions.Count -eq 0) {
      throw 'gcloud failed'
    }
    return $permissions
  } catch {
    throw "IAM_AUTHORITY_UNKNOWN: IAM role permissions could not be completely inspected for $Role."
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Invoke-C2AssetIamSearch {
  param(
    [Parameter(Mandatory)][string]$Scope,
    [string]$Query,
    [int]$PageSize = 100
  )
  # gcloud follows nextPageToken when aggregating --format=json. Force an
  # explicit page size so multi-page inventories are exercised rather than a
  # single ranked first page being treated as complete.
  $arguments = @(
    'asset','search-all-iam-policies',
    "--scope=$Scope",
    "--page-size=$PageSize",
    '--format=json'
  )
  if ($Query) { $arguments += "--query=$Query" }

  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $raw = & $gcloud @arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'gcloud failed' }
    $joined = ($raw | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
    $parsed = ConvertFrom-C2Json -Raw $joined -Label 'Cloud Asset IAM policy search'
    return @($parsed | ForEach-Object { $_ })
  } catch {
    if ($_.Exception.Message -like 'IAM_AUTHORITY_UNKNOWN:*') { throw }
    throw 'IAM_AUTHORITY_UNKNOWN: Cloud Asset IAM policy search could not be completed.'
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Get-C2ExactAssetResourcePolicy {
  param(
    [Parameter(Mandatory)][string]$Scope,
    [Parameter(Mandatory)][string]$CanonicalResource,
    [Parameter(Mandatory)][string]$AssetQueryResource
  )
  $results = @(Invoke-C2AssetIamSearch -Scope $Scope -Query "resource:$AssetQueryResource")
  $matches = @()
  foreach ($result in $results) {
    if (-not $result.resource -or -not $result.policy) {
      throw "IAM_AUTHORITY_UNKNOWN: Exact Cloud Asset query for $CanonicalResource returned an incomplete resource policy."
    }
    $canonical = ConvertTo-C2CanonicalResource -ResourceFullName ([string]$result.resource)
    if ($canonical -cne $CanonicalResource) {
      throw "IAM_AUTHORITY_UNKNOWN: Exact Cloud Asset query for $CanonicalResource returned a different resource $canonical."
    }
    $matches += $result
  }
  if ($matches.Count -eq 0) {
    return $null
  }
  if ($matches.Count -gt 1) {
    throw "IAM_AUTHORITY_UNKNOWN: Exact Cloud Asset query for $CanonicalResource returned multiple policies."
  }
  return $matches[0]
}

function Add-C2AuthorityObservations {
  param(
    [Parameter(Mandatory)]$Result,
    [Parameter(Mandatory)]$ActualBuildKeys,
    [Parameter(Mandatory)]$UnexpectedCandidates,
    [Parameter(Mandatory)][string[]]$ExpectedKeys,
    [Parameter(Mandatory)]$ApprovedCustomRoles,
    [Parameter(Mandatory)]$ApprovedResources,
    [Parameter(Mandatory)][string]$BuildMember
  )
  if (-not $Result.resource -or -not $Result.policy) {
    throw 'IAM_AUTHORITY_UNKNOWN: Cloud Asset IAM policy search returned an incomplete resource policy.'
  }
  $resource = ConvertTo-C2CanonicalResource -ResourceFullName ([string]$Result.resource)
  foreach ($binding in @(Get-C2Bindings $Result.policy "Cloud Asset IAM policy $($Result.resource)")) {
    $role = Get-C2Role $binding
    if (-not $role) { continue }
    if ($null -ne $binding.PSObject.Properties['condition'] -and $null -ne $binding.condition) {
      throw "IAM_AUTHORITY_UNKNOWN: Cloud Asset returned a conditional binding on $($Result.resource)."
    }
    foreach ($member in @(Get-C2Members $binding)) {
      $key = Get-C2BindingKey $member $resource $role
      if ($ExpectedKeys -contains $key) {
        [void]$ActualBuildKeys.Add($key)
        continue
      }
      $touchesApproved = $ApprovedResources.Contains($resource)
      $usesApprovedCustom = $ApprovedCustomRoles.Contains($role)
      $isProjectWideArtifactWriter = ($role -ceq 'roles/artifactregistry.writer' -and $touchesApproved)
      if ($member -ceq $BuildMember -or $usesApprovedCustom -or $isProjectWideArtifactWriter) {
        [void]$UnexpectedCandidates.Add("member=$member role=$role resource=$resource")
      }
    }
  }
}

Write-Output "Checking resource-scoped build authority for $buildSa (fail closed)."

$described = & $gcloud iam service-accounts describe $buildSa "--project=$ProjectId" --format='value(email)' 2>$null
if ($LASTEXITCODE -ne 0 -or [string]$described.Trim() -cne $buildSa) {
  throw "IAM_AUTHORITY_UNKNOWN: Dedicated build service account $buildSa is unavailable."
}

$projectNumber = (& $gcloud projects describe $ProjectId --format='value(projectNumber)' 2>$null)
if ($LASTEXITCODE -ne 0 -or $projectNumber -notmatch '^[0-9]+$') {
  throw 'IAM_AUTHORITY_UNKNOWN: Project number is unavailable.'
}
$projectNumber = [string]$projectNumber.Trim()

$userManagedKeys = @(& $gcloud iam service-accounts keys list "--iam-account=$buildSa" "--project=$ProjectId" --managed-by=user --format='value(name)' 2>$null)
if ($LASTEXITCODE -ne 0) {
  throw 'IAM_AUTHORITY_UNKNOWN: User-managed key inventory could not be completely inspected.'
}
if (@($userManagedKeys | Where-Object { $_ }).Count -ne 0) {
  throw 'USER_MANAGED_KEYS_PRESENT: Dedicated build service account must not have user-managed keys.'
}

$artifactRole = $null
$sourceRole = $null
$logRole = $null
foreach ($definition in $roleDefinitions) {
  $roleId = [string]$definition.Name
  $expectedPermissions = @($definition.Permissions | ForEach-Object { [string]$_ } | Sort-Object -Unique)
  $actualPermissions = @(Read-C2RolePermissions "projects/$ProjectId/roles/$roleId")
  if (($actualPermissions -join "`n") -ne ($expectedPermissions -join "`n")) {
    throw "CUSTOM_ROLE_PERMISSIONS_DRIFT: projects/$ProjectId/roles/$roleId includedPermissions drifted from policy."
  }
  switch ($roleId) {
    'resolviaBuildArtifactWriter' { $artifactRole = "projects/$ProjectId/roles/$roleId" }
    'resolviaBuildSourceReader' { $sourceRole = "projects/$ProjectId/roles/$roleId" }
    'resolviaBuildLogWriter' { $logRole = "projects/$ProjectId/roles/$roleId" }
    default { throw "IAM_AUTHORITY_UNKNOWN: Unexpected custom role id $roleId." }
  }
}
if (-not $artifactRole -or -not $sourceRole -or -not $logRole) {
  throw 'IAM_AUTHORITY_UNKNOWN: Build authority policy custom role ids are incomplete.'
}

$projectPolicyRaw = & $gcloud projects get-iam-policy $ProjectId --format=json 2>&1
if ($LASTEXITCODE -ne 0) { throw 'IAM_AUTHORITY_UNKNOWN: Project IAM policy could not be completely inspected.' }
$projectPolicy = ConvertFrom-C2Json -Raw ($projectPolicyRaw -join [Environment]::NewLine) -Label 'Project IAM policy'
foreach ($binding in @(Get-C2Bindings $projectPolicy 'Project IAM policy')) {
  $role = Get-C2Role $binding
  $members = @(Get-C2Members $binding)
  if ($members -notcontains $buildMember) { continue }
  if ($forbiddenProjectRoles.Contains($role)) {
    throw "FORBIDDEN_PROJECT_BUILD_ROLE: $buildMember must not hold project role $role"
  }
  throw "UNEXPECTED_PROJECT_BINDING: $buildMember must not hold project role $role"
}

$ancestorRows = @(& $gcloud projects get-ancestors $ProjectId --format='csv[no-heading](type,id)' 2>&1)
if ($LASTEXITCODE -ne 0 -or $ancestorRows.Count -eq 0) {
  throw 'IAM_AUTHORITY_UNKNOWN: Project ancestry could not be completely inspected.'
}
foreach ($row in $ancestorRows) {
  $parts = $row.ToString().Trim().Split(',', 2)
  if ($parts.Count -ne 2 -or $parts[0] -notin @('project','folder','organization') -or [string]::IsNullOrWhiteSpace($parts[1])) {
    throw 'IAM_AUTHORITY_UNKNOWN: Project ancestry contains a malformed scope.'
  }
  if ($parts[0] -eq 'project') { continue }
  $arguments = if ($parts[0] -eq 'folder') {
    @('resource-manager','folders','get-iam-policy',$parts[1],'--format=json')
  } else {
    @('organizations','get-iam-policy',$parts[1],'--format=json')
  }
  $raw = & $gcloud @arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "IAM_AUTHORITY_UNKNOWN: $($parts[0]) $($parts[1]) IAM policy could not be completely inspected."
  }
  $ancestorPolicy = ConvertFrom-C2Json -Raw ($raw -join [Environment]::NewLine) -Label "$($parts[0]) $($parts[1]) IAM policy"
  foreach ($binding in @(Get-C2Bindings $ancestorPolicy "$($parts[0]) $($parts[1]) IAM policy")) {
    if ((@(Get-C2Members $binding)) -contains $buildMember) {
      throw "UNEXPECTED_RESOURCE_BINDING: $buildMember holds inherited $($parts[0]) role $(Get-C2Role $binding)"
    }
  }
}

$arResource = "//artifactregistry.googleapis.com/projects/$ProjectId/locations/$Region/repositories/$repository"
$sourceBucketName = "$($ProjectId)_$($Region)_cloudbuild"
$logBucketName = "$projectNumber-$Region-cloudbuild-logs"
$sourceResource = "//storage.googleapis.com/projects/_/buckets/$sourceBucketName"
$logResource = "//storage.googleapis.com/projects/_/buckets/$logBucketName"
# Cloud Asset indexes GCS IAM under the short resource name; exact queries must
# use that search identity while binding keys stay on the approved long form.
$sourceAssetQueryResource = "//storage.googleapis.com/$sourceBucketName"
$logAssetQueryResource = "//storage.googleapis.com/$logBucketName"
$arAssetQueryResource = $arResource

$expectedKeys = @(
  (Get-C2BindingKey $buildMember $arResource $artifactRole)
  (Get-C2BindingKey $buildMember $sourceResource $sourceRole)
  (Get-C2BindingKey $buildMember $logResource $logRole)
) | Sort-Object -Unique
$approvedCustomRoles = [System.Collections.Generic.HashSet[string]]::new([string[]]@($artifactRole, $sourceRole, $logRole))
$approvedResources = [System.Collections.Generic.HashSet[string]]::new([string[]]@(
  (ConvertTo-C2CanonicalResource $arResource)
  (ConvertTo-C2CanonicalResource $sourceResource)
  (ConvertTo-C2CanonicalResource $logResource)
))

$assetScope = "projects/$ProjectId"
$actualBuildKeys = New-Object 'System.Collections.Generic.HashSet[string]'
$unexpectedCandidates = New-Object 'System.Collections.Generic.List[string]'

# Exact resource-scoped positive proof (not ranked broad search).
$exactSpecs = @(
  @{ Canonical = $arResource; QueryResource = $arAssetQueryResource; Label = 'Artifact Registry resolvia' }
  @{ Canonical = $sourceResource; QueryResource = $sourceAssetQueryResource; Label = 'Cloud Build source bucket' }
  @{ Canonical = $logResource; QueryResource = $logAssetQueryResource; Label = 'Cloud Build log bucket' }
)
foreach ($spec in $exactSpecs) {
  $exact = Get-C2ExactAssetResourcePolicy -Scope $assetScope -CanonicalResource $spec.Canonical -AssetQueryResource $spec.QueryResource
  if ($null -eq $exact) {
    throw "MISSING_RESOURCE_BINDING: exact Cloud Asset policy missing for $($spec.Label) ($($spec.Canonical))"
  }
  Add-C2AuthorityObservations -Result $exact -ActualBuildKeys $actualBuildKeys -UnexpectedCandidates $unexpectedCandidates `
    -ExpectedKeys $expectedKeys -ApprovedCustomRoles $approvedCustomRoles -ApprovedResources $approvedResources -BuildMember $buildMember
}

foreach ($expectedKey in $expectedKeys) {
  if (-not $actualBuildKeys.Contains($expectedKey)) {
    throw "MISSING_RESOURCE_BINDING: missing exact authority $expectedKey"
  }
}

# Exhaustive excess-authority discovery: fully paginated broad search PLUS every
# project bucket/repository exact policy. Broad omission alone never proves absence.
$broadResults = @(Invoke-C2AssetIamSearch -Scope $assetScope)
foreach ($result in $broadResults) {
  Add-C2AuthorityObservations -Result $result -ActualBuildKeys $actualBuildKeys -UnexpectedCandidates $unexpectedCandidates `
    -ExpectedKeys $expectedKeys -ApprovedCustomRoles $approvedCustomRoles -ApprovedResources $approvedResources -BuildMember $buildMember
}

try {
  $bucketNames = @(& $gcloud storage buckets list "--project=$ProjectId" --format='value(name)' 2>&1 |
    ForEach-Object { $_.ToString().Trim() } | Where-Object { $_ } | Sort-Object -Unique)
  if ($LASTEXITCODE -ne 0) { throw 'gcloud failed' }
} catch {
  throw 'IAM_AUTHORITY_UNKNOWN: Project bucket inventory could not be completely inspected.'
}
if ($bucketNames -notcontains "gs://$sourceBucketName" -and $bucketNames -notcontains $sourceBucketName) {
  throw 'IAM_AUTHORITY_UNKNOWN: Project bucket inventory is incomplete (source bucket missing).'
}
if ($bucketNames -notcontains "gs://$logBucketName" -and $bucketNames -notcontains $logBucketName) {
  throw 'IAM_AUTHORITY_UNKNOWN: Project bucket inventory is incomplete (log bucket missing).'
}
foreach ($bucketEntry in $bucketNames) {
  $bucket = $bucketEntry -replace '^gs://',''
  if (-not $bucket) { throw 'IAM_AUTHORITY_UNKNOWN: Project bucket inventory contains a malformed resource.' }
  $canonical = ConvertTo-C2CanonicalResource -ResourceFullName "//storage.googleapis.com/projects/_/buckets/$bucket"
  if ($approvedResources.Contains($canonical)) { continue }
  $extra = Get-C2ExactAssetResourcePolicy -Scope $assetScope -CanonicalResource $canonical -AssetQueryResource "//storage.googleapis.com/$bucket"
  if ($null -eq $extra) { continue }
  Add-C2AuthorityObservations -Result $extra -ActualBuildKeys $actualBuildKeys -UnexpectedCandidates $unexpectedCandidates `
    -ExpectedKeys $expectedKeys -ApprovedCustomRoles $approvedCustomRoles -ApprovedResources $approvedResources -BuildMember $buildMember
}

function ConvertTo-C2ArtifactRegistryInventory {
  param(
    [Parameter(Mandatory)][string]$ExpectedProjectId,
    [Parameter(Mandatory)][AllowNull()]$ParsedJson
  )
  $rows = @()
  if ($null -eq $ParsedJson) {
    return @()
  }
  if ($ParsedJson -is [System.Array]) {
    $rows = @($ParsedJson)
  } else {
    $rows = @($ParsedJson)
  }
  $inventory = @()
  $seen = New-Object 'System.Collections.Generic.HashSet[string]'
  foreach ($row in $rows) {
    if ($null -eq $row) {
      throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory contains a malformed resource.'
    }
    $nameProp = $row.PSObject.Properties['name']
    if ($null -eq $nameProp -or [string]::IsNullOrWhiteSpace([string]$nameProp.Value)) {
      throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory contains a malformed resource.'
    }
    $name = [string]$nameProp.Value
    if ($name -notmatch '^projects/([^/]+)/locations/([^/]+)/repositories/([^/]+)$') {
      throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory contains a malformed resource.'
    }
    $rowProject = $Matches[1]
    $rowLocation = $Matches[2]
    $rowRepository = $Matches[3]
    if ($rowProject -cne $ExpectedProjectId) {
      throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory contains a repository from another project.'
    }
    if ($rowLocation -notmatch '^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$' -or $rowRepository -notmatch '^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$') {
      throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory contains a malformed resource.'
    }
    $canonical = "//artifactregistry.googleapis.com/projects/$rowProject/locations/$rowLocation/repositories/$rowRepository"
    if (-not $seen.Add($canonical)) {
      throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory contains a duplicate repository.'
    }
    $inventory += [pscustomobject]@{
      ProjectId = $rowProject
      Location = $rowLocation
      RepositoryId = $rowRepository
      CanonicalResource = $canonical
    }
  }
  return @($inventory)
}

try {
  # Prefer structured JSON: gcloud CSV projection of (name,location) collapses the
  # fully-qualified name to the short repository ID and leaves location empty
  # (e.g. "resolvia,"), which is not authoritative inventory identity.
  $previous = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $repositoryRaw = & $gcloud artifacts repositories list "--project=$ProjectId" --format=json 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'gcloud failed' }
  } finally {
    $ErrorActionPreference = $previous
  }
  $repositoryJsonText = @($repositoryRaw | ForEach-Object { $_.ToString() } | Where-Object {
    $_ -and ($_ -notmatch '^\s*Listing items under project')
  }) -join [Environment]::NewLine
  if ([string]::IsNullOrWhiteSpace($repositoryJsonText)) {
    $repositoryInventory = @()
  } else {
    $repositoryParsed = ConvertFrom-C2Json -Raw $repositoryJsonText -Label 'Artifact Registry repository inventory'
    $repositoryInventory = @(ConvertTo-C2ArtifactRegistryInventory -ExpectedProjectId $ProjectId -ParsedJson $repositoryParsed)
  }
} catch {
  if ($_.Exception.Message -like 'IAM_AUTHORITY_UNKNOWN:*') { throw }
  throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory could not be completely inspected.'
}
$listedApprovedRepository = $false
foreach ($repoEntry in $repositoryInventory) {
  $canonical = [string]$repoEntry.CanonicalResource
  $repositoryLocation = [string]$repoEntry.Location
  $repositoryName = [string]$repoEntry.RepositoryId
  if ($repositoryName -eq $repository -and $repositoryLocation -eq $Region) {
    $listedApprovedRepository = $true
    continue
  }
  $extra = Get-C2ExactAssetResourcePolicy -Scope $assetScope -CanonicalResource $canonical -AssetQueryResource $canonical
  if ($null -eq $extra) { continue }
  Add-C2AuthorityObservations -Result $extra -ActualBuildKeys $actualBuildKeys -UnexpectedCandidates $unexpectedCandidates `
    -ExpectedKeys $expectedKeys -ApprovedCustomRoles $approvedCustomRoles -ApprovedResources $approvedResources -BuildMember $buildMember
}
if (-not $listedApprovedRepository) {
  throw 'IAM_AUTHORITY_UNKNOWN: Project Artifact Registry inventory is incomplete.'
}

if ($unexpectedCandidates.Count -gt 0) {
  throw "UNEXPECTED_RESOURCE_BINDING: unexpected effective authority $($unexpectedCandidates[0])"
}

$saPolicyRaw = & $gcloud iam service-accounts get-iam-policy $buildSa "--project=$ProjectId" --format=json 2>&1
if ($LASTEXITCODE -ne 0) {
  throw 'IAM_AUTHORITY_UNKNOWN: Build service-account IAM policy could not be completely inspected.'
}
$saPolicy = ConvertFrom-C2Json -Raw ($saPolicyRaw -join [Environment]::NewLine) -Label 'Build service-account IAM policy'
$forbiddenSaPermissions = @(
  'iam.serviceAccounts.signBlob'
  'iam.serviceAccounts.signJwt'
  'iam.serviceAccountKeys.create'
  'iam.serviceAccountKeys.delete'
)
foreach ($binding in @(Get-C2Bindings $saPolicy 'Build service-account IAM policy')) {
  $role = Get-C2Role $binding
  if (-not $role) { continue }
  $permissions = @(Read-C2RolePermissions $role)
  foreach ($member in @(Get-C2Members $binding)) {
    if ($role -ceq 'roles/iam.serviceAccountUser' -and $member -ceq $operatorMember) { continue }
    if ($role -ceq 'roles/iam.serviceAccountTokenCreator') {
      throw "UNEXPECTED_RESOURCE_BINDING: TokenCreator on build SA is not part of the approved resource-scoped model ($member)."
    }
    foreach ($permission in $permissions) {
      if ($forbiddenSaPermissions -contains $permission) {
        throw "UNEXPECTED_RESOURCE_BINDING: build SA grants $permission to $member"
      }
      if ($permission -ceq 'iam.serviceAccounts.actAs' -and $member -cne $operatorMember) {
        throw "UNEXPECTED_RESOURCE_BINDING: arbitrary actAs on build SA for $member"
      }
    }
  }
}

Write-Output 'effective-iam: PASS exact resource-scoped resolvia-build authority'
Write-Output "buildServiceAccount=$buildSa"
Write-Output "artifactRole=$artifactRole"
Write-Output "sourceRole=$sourceRole"
Write-Output "logRole=$logRole"
Write-Output 'projectRoles=none'
Write-Output 'assetRetrieval=exact-resource-positive+exhaustive-extras'
Write-Output 'buildAuthority=PASS'
