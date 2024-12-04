; Script generated by the Inno Setup Script Wizard.
; SEE THE DOCUMENTATION FOR DETAILS ON CREATING INNO SETUP SCRIPT FILES!
; NOTE: The value of AppId uniquely identifies this application. Do not use the same AppId value in installers for other applications.
; (To generate a new GUID, click Tools | Generate GUID inside the IDE.)
[SETUP]
AppId={{cc9a344d-66b1-4f2d-844e-0b939cf31959}
AppName=Oobee Desktop
AppVersion=0.10.0
AppVerName=Oobee Desktop
AppPublisher=GovTech
AppPublisherURL=https://github.com/GovTechSG/oobee-desktop
AppSupportURL=https://github.com/GovTechSG/oobee-desktop
AppUpdatesURL=https://github.com/GovTechSG/oobee-desktop
DefaultDirName=C:\Program Files\Oobee Desktop
DisableDirPage=yes
ChangesAssociations=yes
DisableProgramGroupPage=yes
; LicenseFile=Oobee-win32-x64\LICENSE
; Uncomment the following line to run in non administrative install mode (install for current user only.)
;PrivilegesRequired=lowest
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "Oobee-win32-x64\*"; DestDir: "\\?\{app}\Oobee Frontend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "D:\a\Oobee Backend\*"; DestDir: "\\?\{app}\Oobee Backend"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Install-WMIC.ps1""; DestDir: "\\?\{app}"; Flags: ignoreversion
; NOTE: Don't use "Flags: ignoreversion" on any shared system files

[Icons]
Name: "{autoprograms}\Oobee Desktop"; Filename: "C:\Program Files\Oobee Desktop\Oobee Frontend\Oobee.exe"
Name: "{autodesktop}\Oobee Desktop"; Filename: "C:\Program Files\Oobee Desktop\Oobee Frontend\Oobee.exe"; Tasks: desktopicon

[Run]
; Filename: "C:\Program Files\Oobee\Oobee Frontend\Oobee.exe"; Description: "{cm:LaunchProgram,Oobee Desktop}"; Flags: nowait postinstall skipifsilent
; Add WMIC installation before running your application
Filename: "powershell.exe"; Parameters: "-ExecutionPolicy Bypass -File ""C:\Program Files\Oobee Desktop\Install-WMIC.ps1"""; Description: "{cm:LaunchProgram,Install required Windows features}"; Flags: postinstall waituntilterminated

[UninstallDelete]
Type: filesandordirs; Name: "C:\Program Files\Oobee\Oobee Frontend"
Type: filesandordirs; Name: "C:\Program Files\Oobee\Oobee Backend"

[InstallDelete]
Type: filesandordirs; Name: "C:\Program Files\Oobee\Oobee Frontend"
Type: filesandordirs; Name: "C:\Program Files\Oobee\Oobee Backend"
