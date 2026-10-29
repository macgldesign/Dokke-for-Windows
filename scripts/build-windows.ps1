<#
 Gera o instalador do Dokke para Windows.
   powershell -File scripts\build-windows.ps1 [-Version 0.2.10] [-NodeVersion 22.22.2] [-SkipInstaller]
 Requisitos: .NET 8 SDK, Node/npm e (para o instalador) Inno Setup 6 (iscc.exe).
 Saída: dist\app (pasta pronta para uso) e dist\Dokke-Setup-<versão>.exe
#>
param(
  [string]$Version = "",
  [string]$NodeVersion = "22.22.2",
  [switch]$SkipInstaller
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$dist = Join-Path $root "dist"
$app = Join-Path $dist "app"
$server = Join-Path $app "server"
$cache = Join-Path $root ".build-cache"

if (-not $Version) { $Version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version }
Write-Host "==> Dokke $Version (Node $NodeVersion)"

if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }
New-Item -ItemType Directory -Force $server, $cache | Out-Null

# 1) Dokke.exe: bandeja + helper (self-contained: não exige .NET instalado no PC do usuário)
Write-Host "==> dotnet publish"
dotnet publish (Join-Path $root "native\Dokke\Dokke.csproj") -c Release -r win-x64 --self-contained true `
  -p:PublishReadyToRun=true -p:DebugType=none -p:Version=$Version -o $app
if ($LASTEXITCODE -ne 0) { throw "dotnet publish falhou" }

# 2) node.exe oficial, com SHA-256 conferido
$zipName = "node-v$NodeVersion-win-x64.zip"
$zipPath = Join-Path $cache $zipName
$base = "https://nodejs.org/dist/v$NodeVersion"
if (-not (Test-Path $zipPath)) {
  Write-Host "==> baixando $zipName"
  Invoke-WebRequest "$base/$zipName" -OutFile $zipPath
}
$sums = (Invoke-WebRequest "$base/SHASUMS256.txt").Content
$expected = ($sums -split "`n" | Where-Object { $_ -match [regex]::Escape($zipName) } | Select-Object -First 1).Split(" ")[0].Trim()
$actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLower()
if (-not $expected -or $expected -ne $actual) { Remove-Item $zipPath -Force; throw "SHA-256 do Node não confere ($actual != $expected)" }
$extract = Join-Path $cache "node-$NodeVersion"
if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
Expand-Archive $zipPath -DestinationPath $extract
Copy-Item (Join-Path $extract "node-v$NodeVersion-win-x64\node.exe") (Join-Path $app "node.exe")

# 3) servidor + interface
Write-Host "==> copiando servidor"
Get-ChildItem $root -Filter *.js -File | Copy-Item -Destination $server
Copy-Item (Join-Path $root "package.json"), (Join-Path $root "package-lock.json") $server
Copy-Item (Join-Path $root "platform") (Join-Path $server "platform") -Recurse
Copy-Item (Join-Path $root "public") (Join-Path $server "public") -Recurse
Copy-Item (Join-Path $root "LICENSE"), (Join-Path $root "NOTICE") $app
Push-Location $server
try {
  npm ci --omit=dev --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm ci falhou" }
} finally { Pop-Location }

# 4) instalador
if ($SkipInstaller) { Write-Host "==> pasta pronta em $app"; exit 0 }
$iscc = (Get-Command iscc.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) {
  $iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $iscc) { throw "Inno Setup 6 não encontrado (winget install JRSoftware.InnoSetup)" }
Write-Host "==> compilando instalador"
& $iscc "/DMyAppVersion=$Version" (Join-Path $root "installer\Dokke.iss")
if ($LASTEXITCODE -ne 0) { throw "Inno Setup falhou" }
$setup = Join-Path $dist "Dokke-Setup-$Version.exe"
(Get-FileHash $setup -Algorithm SHA256).Hash.ToLower() + "  Dokke-Setup-$Version.exe" | Set-Content (Join-Path $dist "SHA256SUMS.txt")
Write-Host "==> pronto: $setup"
