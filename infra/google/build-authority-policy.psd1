@{
  SchemaVersion = 1
  BuildServiceAccountName = 'resolvia-build'
  ArtifactRepository = 'resolvia'
  ForbiddenProjectRoles = @(
    'roles/cloudbuild.builds.builder'
    'roles/artifactregistry.writer'
    'roles/logging.logWriter'
    'roles/storage.objectViewer'
  )
  BuildRoleDefinitions = @(
    @{
      Name = 'resolviaBuildArtifactWriter'
      Permissions = @(
        'artifactregistry.repositories.uploadArtifacts'
        'artifactregistry.repositories.downloadArtifacts'
      )
    }
    @{
      Name = 'resolviaBuildSourceReader'
      Permissions = @('storage.objects.get')
    }
    @{
      Name = 'resolviaBuildLogWriter'
      Permissions = @('storage.objects.create')
    }
  )
}
