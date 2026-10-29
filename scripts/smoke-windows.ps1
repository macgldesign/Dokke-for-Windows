<#
 Teste de fumaça do pacote em dist\app, rodando num Windows de verdade:
 helper (janelas, foco, ícones), servidor + inventário real de apps e a bandeja.
#>
param([string]$App = "dist\app")
$ErrorActionPreference = "Stop"
$App = (Resolve-Path $App).Path
$exe = Join-Path $App "Dokke.exe"
$fails = 0
function Check($name, $ok, $detail = "") {
  if ($ok) { Write-Host "  ok   $name" } else { Write-Host "  FALHA $name $detail"; $script:fails++ }
}
# Dokke.exe é um app de janela: o PowerShell não captura a saída de "& exe", então usamos Process.
function Run-Helper([string[]]$Arguments, [int]$TimeoutMs = 20000) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo $exe
  foreach ($a in $Arguments) { $psi.ArgumentList.Add($a) }
  $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $out = $p.StandardOutput.ReadToEnd(); $err = $p.StandardError.ReadToEnd()
  if (-not $p.WaitForExit($TimeoutMs)) { $p.Kill(); return @{ Code = -999; Out = $out; Err = "timeout" } }
  return @{ Code = $p.ExitCode; Out = $out.Trim(); Err = $err.Trim() }
}

Write-Host "== helper"
$r = Run-Helper @("running")
$list = $null; try { $list = $r.Out | ConvertFrom-Json } catch {}
Check "running sai 0 com JSON" ($r.Code -eq 0 -and $r.Out.StartsWith("[")) $r.Err
$sw = [Diagnostics.Stopwatch]::StartNew(); [void](Run-Helper @("running")); $sw.Stop()
Write-Host ("  info running levou {0} ms" -f $sw.ElapsedMilliseconds)

$r = Run-Helper @("focus", "0");        Check "focus 0 => error"        ((($r.Out | ConvertFrom-Json).result) -eq "error")
$r = Run-Helper @("focus", "7654321");  Check "focus inexistente => not-found" ((($r.Out | ConvertFrom-Json).result) -eq "not-found") $r.Out
$r = Run-Helper @("launch", "relativo.exe"); Check "launch relativo é recusado" ($r.Code -eq 2)
$r = Run-Helper @("launch-packaged", "foo; calc"); Check "launch-packaged inválido é recusado" ($r.Code -eq 2)
$r = Run-Helper @("icon", "C:\Windows\System32\notepad.exe", "")
$png = $null; try { $png = ($r.Out | ConvertFrom-Json).png } catch {}
Check "icon do notepad devolve PNG" ($png -and $png.StartsWith("iVBOR")) $r.Err

Write-Host "== servidor"
$data = Join-Path $env:TEMP ("dokke-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory $data | Out-Null
$psi = New-Object System.Diagnostics.ProcessStartInfo (Join-Path $App "node.exe")
$psi.WorkingDirectory = Join-Path $App "server"; $psi.ArgumentList.Add("server.js")
$psi.Environment["DOKKE_HELPER"] = $exe; $psi.Environment["DOKKE_DATA_DIR"] = $data; $psi.Environment["DOKKE_PORT_FALLBACK"] = "1"
$psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
$server = [System.Diagnostics.Process]::Start($psi)
$port = 0
try {
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not $port) {
    $line = $server.StandardOutput.ReadLine()
    if ($line -match "127\.0\.0\.1:(\d+)") { $port = [int]$Matches[1] }
  }
  Check "servidor iniciou" ($port -gt 0)
  if ($port -gt 0) {
    $base = "http://127.0.0.1:$port"
    Check "/health" ((Invoke-RestMethod "$base/health").ok -eq $true)
    $page = Invoke-WebRequest "$base/host" -UseBasicParsing
    Check "/host serve a tela" ($page.StatusCode -eq 200 -and $page.Content -match "Dokke")
    $info = Invoke-RestMethod "$base/api/host/info"
    Check "/api/host/info com PIN" ($info.pin -match "^\d{4}$")
    $sw = [Diagnostics.Stopwatch]::StartNew()
    $apps = Invoke-RestMethod "$base/api/apps/installed"
    $sw.Stop()
    Check "inventário real de apps responde" ($apps.ok -eq $true)
    Write-Host ("  info {0} apps instalados detectados em {1} ms" -f @($apps.apps).Count, $sw.ElapsedMilliseconds)
    $first = @($apps.apps) | Select-Object -First 1
    if ($first) {
      $icon = Invoke-WebRequest ("$base/api/apps/" + [uri]::EscapeDataString($first.name) + "/icon") -UseBasicParsing
      Check "ícone do primeiro app ($($first.name))" ($icon.StatusCode -eq 200 -and $icon.Headers["Content-Type"] -match "image/")
    }
    $run = Invoke-RestMethod "$base/api/apps"
    Check "/api/apps responde com 'running'" ($null -ne $run.running)
    $miss = $null; try { Invoke-RestMethod "$base/api/apps/NaoExiste-$(Get-Random)/activate" -Method Post -Body "{}" -ContentType "application/json" } catch { $miss = $_.Exception.Response.StatusCode.value__ }
    Check "ativar app inexistente => 404" ($miss -eq 404) "$miss"
  }
} finally {
  if (-not $server.HasExited) { $server.Kill($true) }
  Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "== bandeja"
$r = Run-Helper @("--smoke-test") 60000
Check "bandeja sobe o servidor sozinha" ($r.Out -match "TRAY OK port=\d+" -and $r.Code -eq 0) ($r.Out + " " + $r.Err)

if ($fails) { Write-Host "`n$fails verificação(ões) falharam."; exit 1 }
Write-Host "`nTudo certo."
