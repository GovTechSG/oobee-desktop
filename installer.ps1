$PHbackendUrl = "https://github.com/GovTechSG/oobee/releases/latest/download/oobee-portable-windows.zip"
$PHfrontendUrl = "https://github.com/GovTechSG/oobee-desktop/releases/latest/download/oobee-desktop-windows-prod.zip"
$BEdestinationPath = "$env:APPDATA\PHLatest.zip"
$BEextractPath = "$env:APPDATA\Oobee Backend"
$FEdestinationPath = "$env:APPDATA\Oobee-win32-x64.zip"
$FEextractPath = "$env:APPDATA\Oobee-win32-x64"
$innoSetupCompilerUrl = "https://jrsoftware.org/download.php/is.exe"
$innoSetupCompilerPath = "$env:APPDATA\iscc.exe"
$current_path = (Get-Item -Path ".\" -Verbose).FullName

# Download an artifact and verify a SHA-256 hash published alongside it (as
# <artifact>.sha256). Aborts the install if the hash file is missing or the
# digest does not match — an attacker who tampers with the artifact would also
# need to poison the .sha256, and if we ever gate the sidecar behind a signed
# provenance channel this is the single place to plug it in.
function Invoke-VerifiedDownload {
    param(
        [Parameter(Mandatory)][string]$ArtifactUrl,
        [Parameter(Mandatory)][string]$OutFile
    )
    $hashUrl = "$ArtifactUrl.sha256"
    $hashFile = "$OutFile.sha256"

    Invoke-WebRequest -Uri $ArtifactUrl -OutFile $OutFile -UseBasicParsing
    Invoke-WebRequest -Uri $hashUrl -OutFile $hashFile -UseBasicParsing

    $expected = (Get-Content -Raw -Path $hashFile).Trim().Split()[0].ToLower()
    if (-not $expected -or $expected.Length -ne 64) {
        Remove-Item -Path $OutFile,$hashFile -Force -ErrorAction SilentlyContinue
        throw "Refusing to install $ArtifactUrl : missing/invalid SHA-256 digest at $hashUrl"
    }

    $actual = (Get-FileHash -Path $OutFile -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) {
        Remove-Item -Path $OutFile,$hashFile -Force -ErrorAction SilentlyContinue
        throw "Refusing to install $ArtifactUrl : SHA-256 mismatch (expected $expected, got $actual)"
    }
    Remove-Item -Path $hashFile -Force -ErrorAction SilentlyContinue
}

Invoke-VerifiedDownload -ArtifactUrl $PHbackendUrl -OutFile $BEdestinationPath

Expand-Archive -Path $BEdestinationPath -DestinationPath $BEextractPath -Force

Remove-Item -Path $BEdestinationPath

echo "Oobee Backend extracted to $BEextractPath."

Invoke-VerifiedDownload -ArtifactUrl $PHfrontendUrl -OutFile $FEdestinationPath

Expand-Archive -Path $FEdestinationPath -DestinationPath $FEextractPath -Force

Remove-Item -Path $FEdestinationPath

echo "Oobee Frontend extracted to $FEextractPath."

# Invoke-WebRequest -Uri $innoSetupCompilerUrl -OutFile $innoSetupCompilerPath

# echo "InnoSetup compiler extracted to $innoSetupCompilerPath."

# Start-Process "$env:APPDATA\iscc.exe" -ArgumentList "/LOG /O`"$env:APPDATA" `"C:\Program Files\Oobee Desktop\Oobee Frontend\a11y_for_windows.iss`"" -Wait -NoNewWindow 

#echo "Inno Setup compiler has been installed."

Move-Item -Path "$current_path\a11y_for_windows.iss" -Destination "$env:APPDATA\a11y_for_windows.iss" -Force

echo "Moved Inno Setup script from $current_path to $env:APPDATA"
