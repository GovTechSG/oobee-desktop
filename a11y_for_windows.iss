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

; --- Code helpers ---
[Code]
function GetDefaultDir(Param: string): string;
begin
  if IsAdmin then
    Result := ExpandConstant('{autopf}\Oobee Desktop')      // C:\Program Files\Oobee Desktop
  else
    Result := ExpandConstant('{userappdata}\Oobee Desktop'); // %AppData%\Roaming\Oobee Desktop
end;

function GetShortcutName(Param: string): string;
begin
  if IsAdmin then
    Result := 'Oobee Desktop'
  else
    Result := 'Oobee Desktop (User)';
end;
