$BEbackendUrl = "https://github.com/GovTechSG/a11y-assist/releases/latest/download/a11y-assist-portable-windows.zip"
$FEfrontendUrl = "https://github.com/GovTechSG/a11y-assist-desktop/releases/latest/download/a11y-assist-desktop-windows-prod.zip"
$BEdestinationPath = "$env:APPDATA\A11yAssistLatest.zip"
$BEextractPath = "$env:APPDATA\A11y Assist Backend"
$FEdestinationPath = "$env:APPDATA\A11y Assist-win32-x64.zip"
$FEextractPath = "$env:APPDATA\A11y Assist-win32-x64"
$innoSetupCompilerUrl = "https://jrsoftware.org/download.php/is.exe"
$innoSetupCompilerPath = "$env:APPDATA\iscc.exe"
$current_path = (Get-Item -Path ".\" -Verbose).FullName

Invoke-WebRequest -Uri $BEbackendUrl -OutFile $BEdestinationPath

Expand-Archive -Path $BEdestinationPath -DestinationPath $BEextractPath -Force

Remove-Item -Path $BEdestinationPath

echo "A11y Assist Backend extracted to $BEextractPath."

Invoke-WebRequest -Uri $FEfrontendUrl -OutFile $FEdestinationPath

Expand-Archive -Path $FEdestinationPath -DestinationPath $FEextractPath -Force

Remove-Item -Path $FEdestinationPath

echo "A11y Assist Frontend extracted to $FEextractPath."

# Invoke-WebRequest -Uri $innoSetupCompilerUrl -OutFile $innoSetupCompilerPath

# echo "InnoSetup compiler extracted to $innoSetupCompilerPath."

# Start-Process "$env:APPDATA\iscc.exe" -ArgumentList "/LOG /O`"$env:APPDATA" `"C:\Program Files\A11y Assist Desktop\A11y Assist Frontend\a11y_for_windows.iss`"" -Wait -NoNewWindow

#echo "Inno Setup compiler has been installed."

Move-Item -Path "$current_path\a11y_for_windows.iss" -Destination "$env:APPDATA\a11y_for_windows.iss" -Force

echo "Moved Inno Setup script from $current_path to $env:APPDATA"
