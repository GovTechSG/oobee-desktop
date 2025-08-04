[Setup]
AppId={{cc9a344d-66b1-4f2d-844e-0b939cf31959}
AppName=Oobee Desktop
AppVersion=0.10.0
AppVerName=Oobee Desktop
AppPublisher=GovTech
AppPublisherURL=https://github.com/GovTechSG/oobee-desktop
AppSupportURL=https://github.com/GovTechSG/oobee-desktop
AppUpdatesURL=https://github.com/GovTechSG/oobee-desktop

; Let Inno request admin but allow per-user fallback
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog

; Decide install dir at runtime (per-machine vs per-user)
DefaultDirName={code:GetDefaultDir}
DisableDirPage=yes

ChangesAssociations=yes
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Use {app} everywhere; keep your recursesubdirs flags
Source: "Oobee-win32-x64\*"; DestDir: "{app}\Oobee Frontend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "D:\a\Oobee Backend\*"; DestDir: "{app}\Oobee Backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Install-WMIC.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
; {autoprograms} goes to All Users in admin mode, Current User in per-user mode
Name: "{autoprograms}\Oobee Desktop"; Filename: "{app}\Oobee Frontend\Oobee.exe"
Name: "{autodesktop}\Oobee Desktop"; Filename: "{app}\Oobee Frontend\Oobee.exe"; Tasks: desktopicon

[Run]
; If this script requires admin rights, guard it (see [Code] section)
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -File ""{app}\Install-WMIC.ps1"""; \
  Description: "{cm:LaunchProgram,Install required Windows features}"; \
  Flags: postinstall waituntilterminated; Check: ShouldRunWmic()

[UninstallDelete]
Type: filesandordirs; Name: "{app}\Oobee Frontend"
Type: filesandordirs; Name: "{app}\Oobee Backend"

[InstallDelete]
Type: filesandordirs; Name: "{app}\Oobee Frontend"
Type: filesandordirs; Name: "{app}\Oobee Backend"

[Code]
function GetDefaultDir(Param: string): string;
begin
  if IsAdminInstallMode then
    Result := ExpandConstant('{autopf}\Oobee Desktop')        // e.g. C:\Program Files\Oobee Desktop
  else
    Result := ExpandConstant('{userappdata}\Oobee Desktop');   // e.g. C:\Users\...\AppData\Roaming\Oobee Desktop
end;

function ShouldRunWmic(): Boolean;
begin
  // Example: only run WMIC installer when doing an admin (all-users) install
  Result := IsAdminInstallMode;
end;
