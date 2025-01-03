$backendTag = $args[0];

$purpleA11yDirectory = 'C:\Program Files\Oobee Desktop';
$purpleA11yBackendDirectory = 'C:\Program Files\Oobee Desktop\Oobee Backend';
$purpleA11yBackendPHDirectory = 'C:\Program Files\Oobee Desktop\Oobee Backend\oobee';
$backendReleaseUrl = "https://github.com/GovTechSG/oobee/releases/download/$backendTag/oobee-portable-windows.zip";
$backendZipPath = 'C:\Program Files\Oobee Desktop\oobee-portable-windows.zip';
$backendUnzipPath = 'C:\Program Files\Oobee Desktop\Oobee Backend';

$command = 
@" 
if (-not (Test-Path -Path '$purpleA11yDirectory' -PathType Container)) {
    New-Item -ItemType Directory -Path '$purpleA11yDirectory' | Out-Null
}

if (-not (Test-Path -Path '$purpleA11yBackendDirectory' -PathType Container)) {
    New-Item -ItemType Directory -Path '$purpleA11yBackendDirectory' | Out-Null
}

if (-not (Test-Path -Path '$purpleA11yBackendPHDirectory' -PathType Container)) {
    New-Item -ItemType Directory -Path '$purpleA11yBackendPHDirectory' | Out-Null
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
