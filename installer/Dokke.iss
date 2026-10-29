; Instalador do Dokke para Windows (Inno Setup 6.3+).
; Por usuário, sem administrador: instala em %LOCALAPPDATA%\Programs\Dokke.
; Build: scripts\build-windows.ps1  (gera dist\Dokke-Setup-<versão>.exe)

#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppName "Dokke"

[Setup]
AppId={{3F8E2B6C-5D7A-4B19-9C4E-7A1D0B2E6F85}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher=Dokke
AppPublisherURL=https://github.com/felipenalves/Dokke
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\dist
OutputBaseFilename=Dokke-Setup-{#MyAppVersion}
SetupIconFile=..\native\Dokke\Dokke.ico
UninstallDisplayIcon={app}\Dokke.exe
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
LicenseFile=..\LICENSE

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
brazilianportuguese.TaskAutostart=Iniciar o Dokke com o Windows
brazilianportuguese.TaskFirewall=Liberar o Dokke no Firewall para redes Privadas (pede permissão de administrador)
brazilianportuguese.RunFirewall=Liberando o Dokke no Firewall...
brazilianportuguese.RunOpen=Abrir o Dokke agora
english.TaskAutostart=Start Dokke with Windows
english.TaskFirewall=Allow Dokke through the Firewall on Private networks (asks for administrator permission)
english.RunFirewall=Allowing Dokke through the Firewall...
english.RunOpen=Open Dokke now

[Tasks]
Name: "autostart"; Description: "{cm:TaskAutostart}"
Name: "firewall"; Description: "{cm:TaskFirewall}"

[InstallDelete]
; limpa arquivos de versões anteriores do servidor antes de copiar os novos
Type: filesandordirs; Name: "{app}\server"

[Files]
Source: "..\dist\app\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion createallsubdirs

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\Dokke.exe"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "Dokke"; \
  ValueData: """{app}\Dokke.exe"""; Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\Dokke.exe"; Parameters: "firewall-allow ""{app}\node.exe"""; Verb: "runas"; \
  StatusMsg: "{cm:RunFirewall}"; Flags: shellexec waituntilterminated; Tasks: firewall
Filename: "{app}\Dokke.exe"; Description: "{cm:RunOpen}"; Flags: nowait postinstall skipifsilent runasoriginaluser

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM Dokke.exe"; Flags: runhidden; RunOnceId: "StopDokke"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  { Encerra só o Dokke (o servidor Node morre junto, pois está no mesmo job object). }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM Dokke.exe', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;
