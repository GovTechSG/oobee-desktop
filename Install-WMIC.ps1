# Ensure the script runs as administrator
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")) {
    Write-Host "This script requires elevated privileges. Please run as administrator." -ForegroundColor Red
    Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`"" -Verb RunAs
    exit
}

$ErrorActionPreference = "Stop"

try {
    # Display Windows version for diagnostics
    $windowsVersion = (Get-ComputerInfo).WindowsVersion
    Write-Host "Detected Windows Version: $windowsVersion"

    # Check if WMIC is already installed
    $wmicPath = Join-Path $env:SystemRoot "System32\wbem\wmic.exe"
    if (Test-Path $wmicPath) {
        Write-Host "WMIC is already installed at $wmicPath."
        exit 0
    }

    # Check if IIS-WMICompatibility feature is available
    Write-Host "Checking available Windows optional features..."
    $features = Get-WindowsOptionalFeature -Online
    $wmicFeature = $features | Where-Object { $_.FeatureName -match "IIS-WMICompatibility" }

    if ($wmicFeature) {
        Write-Host "Found WMI-related feature: $($wmicFeature.FeatureName)"
        if ($wmicFeature.State -eq "Enabled") {
            Write-Host "The feature $($wmicFeature.FeatureName) is already enabled."
        } else {
            # Enable parent features for IIS-WMICompatibility
            Write-Host "Enabling parent features for IIS-WMICompatibility..."
            Enable-WindowsOptionalFeature -Online -FeatureName IIS-ManagementConsole -All
            Write-Host "Enabling IIS-WMICompatibility feature..."
            Enable-WindowsOptionalFeature -Online -FeatureName IIS-WMICompatibility -All
        }

        # Restart system if required
        if ($features | Where-Object { $_.FeatureName -eq "IIS-WMICompatibility" -and $_.RestartNeeded -eq $true }) {
            Write-Host "A restart is required to complete the installation."
            Restart-Computer -Force
        }

        # Verify installation
        if (Test-Path $wmicPath) {
            Write-Host "WMIC was successfully installed."
            exit 0
        } else {
            Write-Host "WMIC installation failed. Ensure all dependencies are enabled and restart the system if needed." -ForegroundColor Yellow
            exit 1
        }
    } else {
        Write-Host "No WMI or WMIC-related optional feature found on this system." -ForegroundColor Yellow
        Write-Host "WMIC may be deprecated on this version of Windows. Consider using PowerShell alternatives." -ForegroundColor Cyan
        exit 1
    }
} catch {
    Write-Host "Error installing WMIC: $_" -ForegroundColor Red
    exit 1
}

# Guidance for deprecated WMIC usage
Write-Host "`nConsider using the following PowerShell commands for WMI-related tasks:" -ForegroundColor Green
Write-Host " - Get-Process               (List running processes)"
Write-Host " - Get-WmiObject             (Legacy WMI cmdlet)"
Write-Host " - Get-CimInstance           (Modern replacement for Get-WmiObject)"
Write-Host " - Get-Help                  (Explore PowerShell cmdlets)"
Write-Host "`nFor more information, visit: https://learn.microsoft.com/en-us/powershell/scripting/" -ForegroundColor Cyan
