$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$releases = if ($env:REBASE_RELEASE_BASE_URL) { $env:REBASE_RELEASE_BASE_URL } else { "https://github.com/ionalexandru99/rebase-git/releases" }
$versions = Join-Path $env:USERPROFILE ".rebase\runtime\versions"
$binDir = Join-Path $env:USERPROFILE ".rebase\bin"

$arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
  "X64" { "x64" }
  "Arm64" { "arm64" }
  default { throw "Unsupported architecture $_." }
}

$version = $env:REBASE_VERSION
if (-not $version) {
  $request = [System.Net.WebRequest]::Create("$releases/latest")
  $request.Method = "HEAD"
  $response = $request.GetResponse()
  $latest = $response.ResponseUri.AbsoluteUri
  $response.Close()
  if ($latest -notmatch "/tag/v([^/]+)$") { throw "Could not find the latest release." }
  $version = $Matches[1]
}
$version = $version.TrimStart("v")

$archive = "rebase-$version-win32-$arch.zip"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ("rebase-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temporary | Out-Null
try {
  Write-Host "Downloading Rebase $version for Windows $arch..."
  $archivePath = Join-Path $temporary $archive
  $checksumsPath = Join-Path $temporary "SHA256SUMS"
  Invoke-WebRequest -UseBasicParsing -Uri "$releases/download/v$version/$archive" -OutFile $archivePath
  Invoke-WebRequest -UseBasicParsing -Uri "$releases/download/v$version/SHA256SUMS" -OutFile $checksumsPath

  $expected = Get-Content $checksumsPath | ForEach-Object {
    $hash, $file = $_ -split "\s+\*?", 2
    if ($file -eq $archive) { $hash }
  } | Select-Object -First 1
  if (-not $expected) { throw "SHA256SUMS has no $archive." }
  if ((Get-FileHash -Algorithm SHA256 $archivePath).Hash -ne $expected) {
    throw "The checksum of $archive does not match SHA256SUMS."
  }

  New-Item -ItemType Directory -Force -Path $versions, $binDir | Out-Null
  $staging = Join-Path $versions ".$version-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Path $staging | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $staging)
  $target = Join-Path $versions $version
  if (Test-Path $target) {
    $replaced = ".$version-$([guid]::NewGuid())"
    try { Rename-Item $target $replaced }
    catch {
      Remove-Item -Recurse -Force $staging -ErrorAction SilentlyContinue
      throw "Rebase $version is running. Run rebase stop, then install again."
    }
    Remove-Item -Recurse -Force (Join-Path $versions $replaced) -ErrorAction SilentlyContinue
  }
  Move-Item $staging $target
} finally {
  Remove-Item -Recurse -Force $temporary -ErrorAction SilentlyContinue
}

$launcher = Join-Path $binDir "rebase.cmd"
$launcherTemporary = "$launcher.$([guid]::NewGuid()).tmp"
[System.IO.File]::WriteAllText($launcherTemporary, "@`"%~dp0..\runtime\versions\$version\bin\rebase.cmd`" %*`r`n")
Move-Item -Force $launcherTemporary $launcher

& $launcher --version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "The installed rebase command does not run." }
Write-Host "Installed Rebase $version. Run rebase to open it."

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $binDir)) {
  [Environment]::SetEnvironmentVariable("Path", ((@($userPath, $binDir) | Where-Object { $_ }) -join ";"), "User")
  Write-Host "Added $binDir to your PATH. Open a new terminal to run rebase."
}
