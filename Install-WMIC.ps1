# Define the path to check for WMIC
$wmicPath = "C:\Windows\System32\wbem\WMIC.exe"

# Function to check if WMIC is installed
function Check-WMIC {
    if (Test-Path $wmicPath) {
        Write-Host "WMIC is already installed at $wmicPath. No action needed." -ForegroundColor Green
        return $true
    } else {
        Write-Host "WMIC is not installed. Proceeding to install it." -ForegroundColor Yellow
        return $false
    }
}

# Function to install WMIC using DISM
function Install-WMIC {
    try {
        Write-Host "Installing WMIC using DISM..." -ForegroundColor Cyan
        $dismCommand = "DISM /Online /Add-Capability /CapabilityName:WMIC~~~~"
        $process = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $dismCommand -NoNewWindow -Wait -PassThru

        if ($process.ExitCode -eq 0) {
            Write-Host "WMIC has been successfully installed." -ForegroundColor Green
        } else {
            Write-Host "WMIC installation failed with exit code $($process.ExitCode). Check DISM logs for details." -ForegroundColor Red
        }
    } catch {
        Write-Host "An error occurred during WMIC installation: $_" -ForegroundColor Red
    }
}

# Function to verify WMIC installation
function Verify-WMIC {
    $capabilityStatus = Get-WindowsCapability -Online | Where-Object { $_.Name -like "WMIC~~~~" }

    if ($capabilityStatus -and $capabilityStatus.State -eq "Installed") {
        Write-Host "WMIC installation verified. State: Installed." -ForegroundColor Green
    } else {
        Write-Host "WMIC installation verification failed. State: Not Installed." -ForegroundColor Red
    }
}

# Main script execution
if (-not (Check-WMIC)) {
    Install-WMIC
    Verify-WMIC
}
