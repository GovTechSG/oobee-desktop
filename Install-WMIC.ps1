$ErrorActionPreference = "Stop"

function Repair-WMIC {
    try {
        $wmicPath = Join-Path $env:SystemRoot "System32\wbem\wmic.exe"
        
        if (Test-Path $wmicPath) {
            Write-Host "WMIC is already installed."
            return $true
        }

        Write-Host "WMIC.exe is missing. Attempting system repair..."

        # Try DISM repair first
        Write-Host "Running DISM repair..."
        $dismResult = Start-Process -FilePath "DISM.exe" -ArgumentList "/Online", "/Cleanup-Image", "/RestoreHealth" -Wait -NoNewWindow -PassThru

        if ($dismResult.ExitCode -ne 0) {
            Write-Host "DISM repair failed with exit code: $($dismResult.ExitCode)"
            return $false
        }

        # Then run SFC
        Write-Host "Running System File Checker..."
        $sfcResult = Start-Process -FilePath "sfc.exe" -ArgumentList "/scannow" -Wait -NoNewWindow -PassThru

        if ($sfcResult.ExitCode -ne 0) {
            Write-Host "SFC repair failed with exit code: $($sfcResult.ExitCode)"
            return $false
        }

        # Check if wmic.exe exists after repairs
        if (Test-Path $wmicPath) {
            Write-Host "WMIC has been restored successfully."
            return $true
        } else {
            Write-Host "WMIC could not be restored."
            
            # Additional WMI repository reset as last resort
            Write-Host "Attempting WMI repository reset..."
            Stop-Service Winmgmt -Force
            Remove-Item -Path "$env:SystemRoot\System32\wbem\repository" -Recurse -Force -ErrorAction SilentlyContinue
            Start-Service Winmgmt
            
            # Final check
            if (Test-Path $wmicPath) {
                Write-Host "WMIC has been restored after WMI repository reset."
                return $true
            }
            return $false
        }
    }
    catch {
        $errorMessage = $_.Exception.Message
        Write-Host ("Error during WMIC repair: {0}" -f $errorMessage)
        return $false
    }
}

$result = Repair-WMIC
if (-not $result) {
    Write-Host "WMIC repair failed. Consider using PowerShell alternatives like Get-CimInstance."
    Write-Host "Example: Instead of 'wmic computersystem get model'"
    Write-Host "Use: Get-CimInstance -ClassName Win32_ComputerSystem | Select-Object Model"
    exit 1
}
exit 0