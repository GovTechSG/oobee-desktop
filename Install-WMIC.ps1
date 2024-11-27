# Install-WMIC.ps1
$ErrorActionPreference = "Stop"

try {
    # Check if WMIC is already installed
    $wmicCheck = Get-WmiObject -List -Namespace root\cimv2 -ErrorAction SilentlyContinue
    
    if (-not $wmicCheck) {
        # Enable Windows Optional Feature
        Enable-WindowsOptionalFeature -Online -FeatureName "WMIManagement" -All -NoRestart
        
        # Verify installation
        $verifyWmic = Get-WmiObject -List -Namespace root\cimv2 -ErrorAction SilentlyContinue
        if ($verifyWmic) {
            Write-Host "WMIC was successfully installed."
            exit 0
        } else {
            Write-Host "WMIC installation failed."
            exit 1
        }
    } else {
        Write-Host "WMIC is already installed."
        exit 0
    }
} catch {
    Write-Host "Error installing WMIC: $_"
    exit 1
}