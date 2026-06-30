[CmdletBinding()]
param(
  [string]$DumpRoot,
  [string]$DumpDate,
  [string]$AuthDump,
  [string]$RepoDump,
  [string]$UploadsArchive,
  [string]$PgBin,
  [string]$Host = "127.0.0.1",
  [int]$Port = 5432,
  [string]$AdminUser = "postgres",
  [string]$AdminPassword,
  [string]$DatabaseUser,
  [string]$DatabasePassword,
  [string]$AuthDatabase = "repo_auth_system",
  [string]$RepoDatabase = "repository_system",
  [string]$UploadsDestination,
  [switch]$SkipAuth,
  [switch]$SkipRepo,
  [switch]$SkipUploads,
  [switch]$KeepExistingDatabases
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:RepoRoot = Split-Path -Parent $PSScriptRoot
$script:TempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("repo-restore-" + [DateTime]::Now.ToString("yyyyMMdd-HHmmss"))

function Write-Step {
  param([string]$Message)

  Write-Host ("[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message)
}

function Quote-SqlIdentifier {
  param([Parameter(Mandatory = $true)][string]$Value)

  return '"' + $Value.Replace('"', '""') + '"'
}

function Resolve-ExistingPath {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $resolved = Resolve-Path -LiteralPath $Path -ErrorAction SilentlyContinue
  if (-not $resolved) {
    throw "$Label not found: $Path"
  }

  return $resolved.Path
}

function Resolve-PostgresBin {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    $binPath = Resolve-ExistingPath -Path $ExplicitPath -Label "PostgreSQL bin directory"
    if (-not (Test-Path -LiteralPath (Join-Path $binPath "psql.exe"))) {
      throw "psql.exe was not found in PostgreSQL bin directory: $binPath"
    }
    return $binPath
  }

  $psqlCommand = Get-Command psql.exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($psqlCommand) {
    return Split-Path -Parent $psqlCommand.Source
  }

  $postgresBase = "C:\Program Files\PostgreSQL"
  if (Test-Path -LiteralPath $postgresBase) {
    $candidates = Get-ChildItem -LiteralPath $postgresBase -Directory |
      Sort-Object { [version]($_.Name -replace '[^\d\.]', '') } -Descending

    foreach ($candidate in $candidates) {
      $binPath = Join-Path $candidate.FullName "bin"
      if (Test-Path -LiteralPath (Join-Path $binPath "psql.exe")) {
        return $binPath
      }
    }
  }

  throw "PostgreSQL client tools were not found. Pass -PgBin, for example 'C:\Program Files\PostgreSQL\17\bin'."
}

function Invoke-ExternalCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [string]$Password
  )

  $previousPassword = $env:PGPASSWORD
  try {
    if ($null -ne $Password) {
      $env:PGPASSWORD = $Password
    } elseif ($null -eq $previousPassword) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    if ($null -ne $previousPassword) {
      $env:PGPASSWORD = $previousPassword
    } else {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    }
  }
}

function Invoke-PsqlSql {
  param(
    [Parameter(Mandatory = $true)][string]$PsqlPath,
    [Parameter(Mandatory = $true)][string]$User,
    [string]$Password,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$Sql
  )

  Invoke-ExternalCommand -FilePath $PsqlPath -Arguments @(
    "-h", $Host,
    "-p", "$Port",
    "-U", $User,
    "-d", $Database,
    "-v", "ON_ERROR_STOP=1",
    "-c", $Sql
  ) -Password $Password
}

function Invoke-PsqlFile {
  param(
    [Parameter(Mandatory = $true)][string]$PsqlPath,
    [Parameter(Mandatory = $true)][string]$User,
    [string]$Password,
    [Parameter(Mandatory = $true)][string]$Database,
    [Parameter(Mandatory = $true)][string]$SqlFile
  )

  Invoke-ExternalCommand -FilePath $PsqlPath -Arguments @(
    "-h", $Host,
    "-p", "$Port",
    "-U", $User,
    "-d", $Database,
    "-v", "ON_ERROR_STOP=1",
    "-f", $SqlFile
  ) -Password $Password
}

function Get-BackupFileFromRoot {
  param(
    [Parameter(Mandatory = $true)][string]$RootPath,
    [Parameter(Mandatory = $true)][string]$SubDirectory,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$Label
  )

  $basePath = Join-Path $RootPath $SubDirectory
  if (-not (Test-Path -LiteralPath $basePath)) {
    throw "$Label directory was not found under dump root: $basePath"
  }

  $files = Get-ChildItem -LiteralPath $basePath -Recurse -File | Where-Object { $_.Name -match $Pattern }
  if ($DumpDate) {
    $escapedDate = [regex]::Escape($DumpDate)
    $files = $files | Where-Object { $_.FullName -match $escapedDate }
  }

  $selected = $files | Sort-Object FullName | Select-Object -Last 1
  if (-not $selected) {
    if ($DumpDate) {
      throw "$Label dump was not found for date $DumpDate under $basePath"
    }
    throw "$Label dump was not found under $basePath"
  }

  return $selected.FullName
}

function Open-DumpTextReader {
  param([Parameter(Mandatory = $true)][string]$Path)

  $fileStream = [System.IO.File]::OpenRead($Path)
  if ($Path.EndsWith(".gz", [System.StringComparison]::OrdinalIgnoreCase)) {
    $gzipStream = [System.IO.Compression.GzipStream]::new($fileStream, [System.IO.Compression.CompressionMode]::Decompress)
    $reader = [System.IO.StreamReader]::new($gzipStream)
    return [pscustomobject]@{
      Reader = $reader
      Dispose = {
        $reader.Dispose()
        $gzipStream.Dispose()
        $fileStream.Dispose()
      }
    }
  }

  $reader = [System.IO.StreamReader]::new($fileStream)
  return [pscustomobject]@{
    Reader = $reader
    Dispose = {
      $reader.Dispose()
      $fileStream.Dispose()
    }
  }
}

function Assert-DumpContainsPattern {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Pattern,
    [Parameter(Mandatory = $true)][string]$DumpLabel
  )

  $handle = Open-DumpTextReader -Path $Path
  try {
    while (($line = $handle.Reader.ReadLine()) -ne $null) {
      if ($line -match $Pattern) {
        return
      }
    }
  } finally {
    & $handle.Dispose
  }

  throw "$DumpLabel dump does not contain the expected marker '$Pattern'. Check that auth_db and repo_db dumps were not mixed up."
}

function Expand-GzipFile {
  param(
    [Parameter(Mandatory = $true)][string]$SourcePath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  $input = [System.IO.File]::OpenRead($SourcePath)
  try {
    $gzip = [System.IO.Compression.GzipStream]::new($input, [System.IO.Compression.CompressionMode]::Decompress)
    try {
      $output = [System.IO.File]::Create($DestinationPath)
      try {
        $gzip.CopyTo($output)
      } finally {
        $output.Dispose()
      }
    } finally {
      $gzip.Dispose()
    }
  } finally {
    $input.Dispose()
  }
}

function Expand-SqlDumpIfNeeded {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$LogicalName
  )

  if ($Path.EndsWith(".sql", [System.StringComparison]::OrdinalIgnoreCase)) {
    return $Path
  }

  if (-not $Path.EndsWith(".sql.gz", [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsupported SQL dump format: $Path"
  }

  New-Item -ItemType Directory -Path $script:TempRoot -Force | Out-Null
  $targetFile = Join-Path $script:TempRoot ($LogicalName + ".sql")
  Write-Step "Decompressing $LogicalName dump to $targetFile"
  Expand-GzipFile -SourcePath $Path -DestinationPath $targetFile
  return $targetFile
}

function Resolve-UploadsDestinationPath {
  param([string]$ExplicitPath)

  if ($ExplicitPath) {
    return $ExplicitPath
  }

  return (Join-Path $script:RepoRoot "backend/uploads")
}

function Backup-ExistingRepositoryUploads {
  param([Parameter(Mandatory = $true)][string]$DestinationRoot)

  $repositoryDir = Join-Path $DestinationRoot "repository"
  if (-not (Test-Path -LiteralPath $repositoryDir)) {
    return
  }

  $backupPath = "$repositoryDir.pre_restore_{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")
  Write-Step "Moving existing uploads directory to $backupPath"
  Move-Item -LiteralPath $repositoryDir -Destination $backupPath
}

function Restore-DatabaseDump {
  param(
    [Parameter(Mandatory = $true)][string]$DatabaseName,
    [Parameter(Mandatory = $true)][string]$SqlFile,
    [Parameter(Mandatory = $true)][string]$DropDbPath,
    [Parameter(Mandatory = $true)][string]$CreateDbPath,
    [Parameter(Mandatory = $true)][string]$PsqlPath
  )

  if (-not $KeepExistingDatabases) {
    Write-Step "Terminating active sessions for $DatabaseName"
    $escapedName = $DatabaseName.Replace("'", "''")
    Invoke-PsqlSql -PsqlPath $PsqlPath -User $AdminUser -Password $AdminPassword -Database "postgres" -Sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$escapedName' AND pid <> pg_backend_pid();"

    Write-Step "Dropping database $DatabaseName"
    Invoke-ExternalCommand -FilePath $DropDbPath -Arguments @(
      "--if-exists",
      "-h", $Host,
      "-p", "$Port",
      "-U", $AdminUser,
      $DatabaseName
    ) -Password $AdminPassword

    Write-Step "Creating database $DatabaseName owned by $DatabaseUser"
    Invoke-ExternalCommand -FilePath $CreateDbPath -Arguments @(
      "-h", $Host,
      "-p", "$Port",
      "-U", $AdminUser,
      "-O", $DatabaseUser,
      $DatabaseName
    ) -Password $AdminPassword
  }

  Write-Step "Restoring $DatabaseName from $SqlFile"
  Invoke-PsqlFile -PsqlPath $PsqlPath -User $DatabaseUser -Password $DatabasePassword -Database $DatabaseName -SqlFile $SqlFile
}

if (-not $DatabaseUser) {
  $DatabaseUser = $AdminUser
}

if (-not $PSBoundParameters.ContainsKey("DatabasePassword")) {
  $DatabasePassword = $AdminPassword
}

if (-not $AdminPassword -and $env:PGPASSWORD) {
  $AdminPassword = $env:PGPASSWORD
}

if (-not $DatabasePassword -and $env:PGPASSWORD) {
  $DatabasePassword = $env:PGPASSWORD
}

$pgBinPath = Resolve-PostgresBin -ExplicitPath $PgBin
$psqlPath = Join-Path $pgBinPath "psql.exe"
$dropDbPath = Join-Path $pgBinPath "dropdb.exe"
$createDbPath = Join-Path $pgBinPath "createdb.exe"

foreach ($toolPath in @($psqlPath, $dropDbPath, $createDbPath)) {
  if (-not (Test-Path -LiteralPath $toolPath)) {
    throw "Required PostgreSQL tool was not found: $toolPath"
  }
}

if (-not $SkipAuth -or -not $SkipRepo -or -not $SkipUploads) {
  if (-not $DumpRoot -and -not $AuthDump -and -not $RepoDump -and -not $UploadsArchive) {
    throw "Pass -DumpRoot or explicit -AuthDump/-RepoDump/-UploadsArchive paths."
  }
}

if (-not $SkipAuth) {
  if (-not $AuthDump) {
    if (-not $DumpRoot) {
      throw "Pass -AuthDump or -DumpRoot to restore the auth database."
    }
    $AuthDump = Get-BackupFileFromRoot -RootPath $DumpRoot -SubDirectory "auth_db" -Pattern '\.sql(\.gz)?$' -Label "Auth"
  }
  $AuthDump = Resolve-ExistingPath -Path $AuthDump -Label "Auth dump"
  Write-Step "Using auth dump: $AuthDump"
  Assert-DumpContainsPattern -Path $AuthDump -Pattern '^COPY public\.repositoryusers ' -DumpLabel "Auth"
}

if (-not $SkipRepo) {
  if (-not $RepoDump) {
    if (-not $DumpRoot) {
      throw "Pass -RepoDump or -DumpRoot to restore the repository database."
    }
    $RepoDump = Get-BackupFileFromRoot -RootPath $DumpRoot -SubDirectory "repo_db" -Pattern '\.sql(\.gz)?$' -Label "Repository"
  }
  $RepoDump = Resolve-ExistingPath -Path $RepoDump -Label "Repository dump"
  Write-Step "Using repository dump: $RepoDump"
  Assert-DumpContainsPattern -Path $RepoDump -Pattern '^COPY public\.repository_nodes ' -DumpLabel "Repository"
}

if (-not $SkipUploads) {
  if (-not $UploadsArchive) {
    if (-not $DumpRoot) {
      throw "Pass -UploadsArchive or -DumpRoot to restore uploads."
    }
    $UploadsArchive = Get-BackupFileFromRoot -RootPath $DumpRoot -SubDirectory "uploads" -Pattern '\.tar\.gz$' -Label "Uploads"
  }
  $UploadsArchive = Resolve-ExistingPath -Path $UploadsArchive -Label "Uploads archive"
  $UploadsDestination = Resolve-UploadsDestinationPath -ExplicitPath $UploadsDestination
  Write-Step "Using uploads archive: $UploadsArchive"
  Write-Step "Uploads will be restored to: $UploadsDestination"
}

New-Item -ItemType Directory -Path $script:TempRoot -Force | Out-Null
try {
  if (-not $SkipAuth) {
    $authSqlFile = Expand-SqlDumpIfNeeded -Path $AuthDump -LogicalName "auth_restore"
    Restore-DatabaseDump -DatabaseName $AuthDatabase -SqlFile $authSqlFile -DropDbPath $dropDbPath -CreateDbPath $createDbPath -PsqlPath $psqlPath
  }

  if (-not $SkipRepo) {
    $repoSqlFile = Expand-SqlDumpIfNeeded -Path $RepoDump -LogicalName "repo_restore"
    Restore-DatabaseDump -DatabaseName $RepoDatabase -SqlFile $repoSqlFile -DropDbPath $dropDbPath -CreateDbPath $createDbPath -PsqlPath $psqlPath
  }

  if (-not $SkipUploads) {
    New-Item -ItemType Directory -Path $UploadsDestination -Force | Out-Null
    Backup-ExistingRepositoryUploads -DestinationRoot $UploadsDestination

    $tarCommand = Get-Command tar.exe -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $tarCommand) {
      throw "tar.exe was not found. Install Windows bsdtar or restore uploads manually."
    }

    Write-Step "Extracting uploads archive"
    Invoke-ExternalCommand -FilePath $tarCommand.Source -Arguments @(
      "-xzf",
      $UploadsArchive,
      "-C",
      $UploadsDestination
    )
  }

  Write-Step "Restore completed successfully"
} finally {
  if (Test-Path -LiteralPath $script:TempRoot) {
    Remove-Item -LiteralPath $script:TempRoot -Recurse -Force
  }
}
