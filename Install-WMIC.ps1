# Create a new directory for our project
New-Item -ItemType Directory -Path ".\temp\wmic-project" -Force
cd .\temp\wmic-project

# Create package.json
@'
{
  "name": "wmic-replacement",
  "version": "1.0.0",
  "main": "wmic.js",
  "bin": "wmic.js",
  "pkg": {
    "targets": ["node16-win-x64"],
    "outputPath": "dist"
  }
}
'@ | Out-File -FilePath "package.json" -Encoding ASCII -NoNewline

# Create wmic.js
@'
const { execSync } = require('child_process');

function getProcessList() {
    try {
        const header = "ProcessId  ParentProcessId  WorkingSetSize  Name\n";
        const cmd = `powershell.exe -NoProfile -Command "
            Get-CimInstance -ClassName Win32_Process | 
            ForEach-Object { 
                $_.ProcessId.ToString().PadLeft(9) + '  ' + 
                $_.ParentProcessId.ToString().PadLeft(14) + '  ' + 
                $_.WorkingSetSize.ToString().PadLeft(13) + '  ' + 
                $_.Name 
            }
        "`;
        const processes = execSync(cmd).toString();
        return header + processes;
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

function getComputerSystemInfo() {
    const cmd = `powershell.exe -NoProfile -Command "(Get-CimInstance -ClassName Win32_ComputerSystem).TotalPhysicalMemory"`;
    try {
        return execSync(cmd).toString().trim();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

function getOSInfo() {
    const cmd = `powershell.exe -NoProfile -Command "(Get-CimInstance -ClassName Win32_OperatingSystem).FreePhysicalMemory"`;
    try {
        return execSync(cmd).toString().trim();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

const args = process.argv.slice(2).join(' ').toUpperCase();

if (args === 'PROCESS GET PROCESSID,PARENTPROCESSID,WORKINGSETSIZE,NAME') {
    console.log(getProcessList());
} else {
    switch (args) {
        case 'PROCESS GET NAME,PROCESSID':
            console.log(getProcessList());
            break;
        case 'COMPUTERSYSTEM GET TOTALPHYSICALMEMORY':
            console.log(getComputerSystemInfo());
            break;
        case 'OS GET FREEPHYSICALMEMORY':
            console.log(getOSInfo());
            break;
        default:
            console.error('Unsupported command:', args);
            process.exit(1);
    }
}
'@ | Out-File -FilePath "wmic.js" -Encoding ASCII -NoNewline

# Compile with pkg
pkg .

# Install as administrator (make sure you run PowerShell as Administrator for this step)
Copy-Item -Path ".\dist\wmic-replacement.exe" -Destination "C:\Windows\System32\wbem\wmic.exe" -Force

# Clean up (optional)
cd ..\..
Remove-Item -Path ".\temp" -Recurse -Force