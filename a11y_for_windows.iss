; --- Setup ---
[Setup]
AppId={{cc9a344d-66b1-4f2d-844e-0b939cf31959}
AppName=Oobee Desktop
AppVersion=0.10.0
AppVerName=Oobee Desktop
AppPublisher=GovTech
AppPublisherURL=https://github.com/GovTechSG/oobee-desktop
AppSupportURL=https://github.com/GovTechSG/oobee-desktop
AppUpdatesURL=https://github.com/GovTechSG/oobee-desktop

; Never force UAC; Program Files only if launched elevated
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DisableDirPage=yes
DefaultDirName={code:GetDefaultDir}

Compression=lzma
SolidCompression=yes
WizardStyle=modern
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; --- Tasks ---
[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

; --- Files (use \\?\ for long-path-safe copy) ---
[Files]
Source: "Oobee-win32-x64\*"; DestDir: "\\?\{app}\Oobee Frontend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "D:\a\Oobee Backend\*"; DestDir: "\\?\{app}\Oobee Backend"; Flags: ignoreversion recursesubdirs createallsubdirs
; Source: "Install-WMIC.ps1"; DestDir: "\\?\{app}"; Flags: ignoreversion

; --- Shortcuts (both reflect "(User)" when not elevated) ---
[Icons]
Name: "{autoprograms}\{code:GetShortcutName}"; Filename: "{app}\Oobee Frontend\Oobee.exe"
Name: "{autodesktop}\{code:GetShortcutName}";  Filename: "{app}\Oobee Frontend\Oobee.exe"

; --- Optional post-install (guard if needs admin; NO \\?\ here) ---
[Run]
; Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""{app}\Install-WMIC.ps1"""
; Flags: postinstall waituntilterminated; Check: IsAdmin

; --- Clean up (use \\?\ so delete handles long paths too) ---
[UninstallDelete]
Type: filesandordirs; Name: "\\?\{app}\Oobee Frontend"
Type: filesandordirs; Name: "\\?\{app}\Oobee Backend"

[InstallDelete]
Type: filesandordirs; Name: "\\?\{app}\Oobee Frontend"
Type: filesandordirs; Name: "\\?\{app}\Oobee Backend"

; --- Code: choose base dir based on elevation ---
[Code]
const
  AppIdUninstallKey = '{cc9a344d-66b1-4f2d-844e-0b939cf31959}_is1';

function MachineInstallExists(): Boolean;
begin
  Result :=
    RegKeyExists(HKLM64, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\' + AppIdUninstallKey) or
    RegKeyExists(HKLM,   'Software\Microsoft\Windows\CurrentVersion\Uninstall\' + AppIdUninstallKey);
end;

function InitializeSetup(): Boolean;
var
  Choice: Integer;
begin
  // If there is an existing per-machine install and we're not elevated,
  // inform the user and offer only user-mode install or exit.
  if (not IsAdmin) and MachineInstallExists() then
  begin
    Choice := MsgBox(
      'A system-wide installation of Oobee Desktop already exists.'#13#10#13#10 +
      'Without administrator rights, this setup will install a separate copy for your user only.'#13#10 +
      'Shortcuts will be named "Oobee Desktop (User)".'#13#10#13#10 +
      'Click "Yes" to proceed with user-only installation,'#13#10 +
      'or "No" to cancel the installation.',
      mbConfirmation, MB_YESNO);

    if Choice = IDNO then
    begin
      Result := False; // Close installer
      exit;
    end;
    // If "Yes", fall through and proceed with per-user install
  end;

  Result := True;
end;

function GetDefaultDir(Param: string): string;
begin
  if IsAdmin then
    Result := ExpandConstant('{autopf}\Oobee Desktop')        // Program Files (admin)
  else
    Result := ExpandConstant('{userappdata}\Oobee Desktop');   // AppData\Roaming (per-user)
end;

function GetShortcutName(Param: string): string;
begin
  if IsAdmin then
    Result := 'Oobee Desktop'
  else
    Result := 'Oobee Desktop (User)';
end;
