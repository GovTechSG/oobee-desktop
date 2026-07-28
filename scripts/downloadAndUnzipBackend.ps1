$backendTag = $args[0];

$a11yAssistDirectory = 'C:\Program Files\A11y Assist Desktop';
$a11yAssistBackendDirectory = 'C:\Program Files\A11y Assist Desktop\A11y Assist Backend';
$a11yAssistBackendEngineDirectory = 'C:\Program Files\A11y Assist Desktop\A11y Assist Backend\a11y-assist';
$backendReleaseUrl = "https://github.com/GovTechSG/a11y-assist/releases/download/$backendTag/a11y-assist-portable-windows.zip";
$backendZipPath = 'C:\Program Files\A11y Assist Desktop\a11y-assist-portable-windows.zip';
$backendUnzipPath = 'C:\Program Files\A11y Assist Desktop\A11y Assist Backend';

$command =
@"
if (-not (Test-Path -Path '$a11yAssistDirectory' -PathType Container)) {
    New-Item -ItemType Directory -Path '$a11yAssistDirectory' | Out-Null
}

if (-not (Test-Path -Path '$a11yAssistBackendDirectory' -PathType Container)) {
    New-Item -ItemType Directory -Path '$a11yAssistBackendDirectory' | Out-Null
}

if (-not (Test-Path -Path '$a11yAssistBackendEngineDirectory' -PathType Container)) {
    New-Item -ItemType Directory -Path '$a11yAssistBackendEngineDirectory' | Out-Null
}

Write-Host 'Downloading zip file to $backendZipPath'
(New-Object System.Net.WebClient).DownloadFile('$backendReleaseUrl', '$backendZipPath');
Write-Host 'Download complete, unzipping to  $backendUnzipPath'
Expand-Archive -Path '$backendZipPath' -DestinationPath '$backendUnzipPath' -Force;

if (Test-Path -Path '$backendZipPath' -PathType Leaf) {
    Remove-Item -Path '$backendZipPath' -Force
}
"@


Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList "-Command", $command
