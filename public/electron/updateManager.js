const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { exec, spawn } = require("child_process");
const {
  getFrontendVersion,
  appPath,
  backendPath,
  resultsPath,
  frontendReleaseUrl,
  installerExePath,
  macOSExecutablePath,
  versionComparator,
  macOSPrepackageBackend,
  hashPath,
} = require("./constants");
const { silentLogger, consoleLogger } = require("./logs");
const { execSync } = require("child_process");
const {
  writeUserDetailsToFile,
  readUserDataFromFile,
} = require("./userDataManager");

let currentChildProcess;
let isLabMode = false;
let powershellAvailable = null;

function checkPowerShellAvailable() {
  if (powershellAvailable !== null) return powershellAvailable; // cache result

  if (os.platform() !== "win32") {
    powershellAvailable = false;
    return false;
  }

  try {
    // -Command "echo" will run quickly and fail if blocked
    execSync('powershell.exe -NoProfile -Command "echo test"', {
      stdio: "ignore"
    });
    powershellAvailable = true;
  } catch (e) {
    powershellAvailable = false;
    consoleLogger.warn("PowerShell is not available or is blocked. Skipping PowerShell-dependent step.");
    consoleLogger.error(`PowerShell unavailable: ${e.message}`);
  }
  return powershellAvailable;
}

  try {
    // to get isLabMode flag from userData.txt to determine version to update to
    const userData = readUserDataFromFile();
    isLabMode = !!userData.isLabMode; // ensure value is a boolean
  } catch (e) {
  // unable to read user data, leave isLabMode as false
}

const killChildProcess = () => {
  if (currentChildProcess) {
    currentChildProcess.kill("SIGKILL");
  }
};

const execCommand = async (command) => {
  let options = { cwd: appPath };

  const execution = new Promise((resolve) => {
    const process = exec(command, options, (err, stdout, stderr) => {
      if (err) {
        consoleLogger.info("error with running command:", command);
        consoleLogger.info("error", err);
        silentLogger.error(stderr.toString());
      }
      currentChildProcess = null;
      resolve(stdout);
    });
    currentChildProcess = process;
  });

  return await execution;
};

const execCommandElevated = async (command) => {
  const escapedCommand = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const osaCommand = `osascript -e 'do shell script "${escapedCommand}" with administrator privileges'`;
  
  return new Promise((resolve, reject) => {
    const process = exec(osaCommand, { cwd: appPath }, (err, stdout, stderr) => {
      if (err) {
        consoleLogger.error("Elevated command failed:", command);
        consoleLogger.error("Error:", err.message);
        if (stderr) consoleLogger.error("Stderr:", stderr.toString());
        
        // Check if user cancelled the authentication prompt
        if (err.message.includes('User canceled') || err.message.includes('-128')) {
          consoleLogger.warn("User cancelled administrator authentication");
        }
        
        reject(err);
      } else {
        consoleLogger.info("Elevated command completed successfully");
        resolve(stdout);
      }
    });
    currentChildProcess = process;
  });
};

// get hash value of prepackage zip
const hashPrepackage = async (prepackagePath) => {
  const zipFileReadStream = fs.createReadStream(prepackagePath);
  return new Promise((resolve) => {
    const hash = crypto.createHash("sha256");
    zipFileReadStream.on("data", (data) => {
      hash.update(data);
    });
    zipFileReadStream.on("end", () => {
      const computedHash = hash.digest("hex");
      resolve(computedHash);
    });
  });
};

// unzip backend zip for mac
const unzipBackendAndCleanUp = async (zipPath) => {
  let unzipCommand = `rm -rf '${backendPath}' && mkdir -p '${backendPath}' && tar -xf '${zipPath}' -C '${backendPath}' &&
    cd '${backendPath}' &&
    './a11y_shell.sh' echo "Initialise"
    `;

  return execCommand(unzipCommand);
};

const getLatestFrontendVersion = (latestRelease, latestPreRelease) => {
  try {
    let verToCompare;
    if (isLabMode) {
      // handle case where latest release ver > latest prerelease version
      verToCompare =
        versionComparator(latestRelease, latestPreRelease) === 1
          ? latestRelease
          : latestPreRelease;
    } else {
      verToCompare = latestRelease;
    }
    if (versionComparator(getFrontendVersion(), verToCompare) === -1) {
      return verToCompare;
    }
    return undefined; // no need for update
  } catch (e) {
    console.log(
      `Unable to check latest frontend version, skipping\n${e.toString()}`
    );
    return undefined;
  }
};

/**
 * Spawns a PowerShell process to download and unzip the frontend
 * @returns {Promise<void>} void if the frontend was downloaded and unzipped successfully
 */
const downloadAndUnzipFrontendWindows = async (tag = undefined) => {

  const downloadUrl = tag
    ? `https://github.com/GovTechSG/oobee-desktop/releases/download/${tag}/oobee-desktop-windows.zip`
    : frontendReleaseUrl;

  const shellScript = `
  $webClient = New-Object System.Net.WebClient
  try {
    If (!(Test-Path -Path "${resultsPath}")) {
      New-Item -ItemType Directory -Path "${resultsPath}"
    }
    $webClient.DownloadFile("${downloadUrl}", "${resultsPath}\\oobee-desktop-windows.zip")
  } catch {
    Write-Host "Error: Unable to download frontend"
    throw "Unable to download frontend"
    exit 1
  }

  try {
    Expand-Archive -Path "${resultsPath}\\oobee-desktop-windows.zip" -DestinationPath "${resultsPath}\\oobee-desktop-windows" -Force
  } catch {
    Write-Host "Error: Unable to unzip frontend"
    throw "Unable to unzip frontend"
    exit 2
  }`;

  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-Command", shellScript]);
    currentChildProcess = ps;

    ps.stdout.on("data", (data) => {
      silentLogger.debug(data.toString());
    });

    // Log any errors from the PowerShell script
    ps.stderr.on("data", (data) => {
      silentLogger.error(data.toString());
      currentChildProcess = null;
      reject(new Error(data.toString()));
    });

    ps.on("exit", (code) => {
      currentChildProcess = null;
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(code.toString()));
      }
    });
  });
};

/**
 * Spawns a Shell Command process to download and unzip the frontend
 */
const downloadAndUnzipFrontendMac = async (tag = undefined) => {
  const downloadUrl = tag
    ? `https://github.com/GovTechSG/oobee-desktop/releases/download/${tag}/oobee-desktop-macos.zip`
    : frontendReleaseUrl;

  const parentDir = path.join(macOSExecutablePath, "..");

  const downloadCommand = `mkdir -p '${resultsPath}' && curl -L '${downloadUrl}' -o '${resultsPath}/oobee-desktop-mac.zip'`;

  // Use a temporary name that won't trigger macOS security warnings
  const tempAppName = `.Oobee.tmp.${Date.now()}.app`;
  const installCommand = `mv '${macOSExecutablePath}' '${parentDir}/${tempAppName}' && ditto -xk '${resultsPath}/oobee-desktop-mac.zip' '${parentDir}' && rm '${resultsPath}/oobee-desktop-mac.zip' && rm -rf '${parentDir}/${tempAppName}' && xattr -rd com.apple.quarantine '${parentDir}/Oobee.app'`;

  await execCommand(downloadCommand);

  // Check if we need elevated privileges to update the app
  let needsElevation = false;
  const checkPaths = [
    { path: parentDir, desc: 'parent directory' },
    { path: macOSExecutablePath, desc: 'app bundle' }
  ];

  for (const item of checkPaths) {
    try {
      fs.accessSync(item.path, fs.constants.W_OK);
      consoleLogger.info(`✓ ${item.desc} is writable: ${item.path}`);
    } catch (e) {
      consoleLogger.warn(`✗ ${item.desc} is NOT writable: ${item.path}`);
      needsElevation = true;
    }
  }

  if (needsElevation) {
    consoleLogger.info("=== Admin privileges required for app update ===");
    consoleLogger.info("The app is installed in a location that requires administrator access.");
    consoleLogger.info("A macOS authentication dialog will appear - please enter your admin credentials.");
    
    try {
      await execCommandElevated(installCommand);
      consoleLogger.info("Update completed successfully with elevated privileges");
    } catch (err) {
      consoleLogger.error("Failed to update with elevated privileges");
      throw err;
    }
  } else {
    consoleLogger.info("Installing update without elevation (directory is writable)");
    await execCommand(installCommand);
  }
};

/**
 * Spawn a process to launch the InnoSetup installer executable, which contains the frontend and backend
 * upon confirmation from the user, the installer will be launched & Electron will exit
 * @returns {Promise<boolean>} true if the installer executable was launched successfully, false otherwise
 */
const spawnScriptToLaunchInstaller = () => {
  try {
    // Launch the installer executable directly without waiting for it to finish
    const child = spawn(installerExePath, [], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    return true;
  } catch (e) {
    consoleLogger.error(`Failed to launch installer: ${e.message}`);
    return false;
  }
};


const downloadBackend = async (tag, zipPath) => {
  const downloadUrl = `https://github.com/GovTechSG/oobee/releases/download/${tag}/oobee-portable-mac.zip`;
  const command = `curl '${downloadUrl}' -o '${zipPath}' -L && rm -rf '${backendPath}' && mkdir '${backendPath}'`;

  return execCommand(command);
};

// MacOS only
const validateZipFile = async (zipPath) => {
  const isZipValid = async (zipPath) => {
    const command = `
      if unzip -t "${zipPath}" >/dev/null 2>&1; then
        echo "true" 
      else
        echo "false"
      fi
    `;
    const result = await execCommand(command);
    return result.trim() === "true";
  };
  return fs.existsSync(zipPath) && (await isZipValid(zipPath));
};

const hashAndSaveZip = async (zipPath) => {
  const currHash = await hashPrepackage(zipPath);
  fs.writeFileSync(hashPath, currHash);
};

const run = async (updaterEventEmitter, latestRelease, latestPreRelease) => {

  // If Windows and powershell not available, skip update
  if (os.platform() === "win32" && !checkPowerShellAvailable()) return;

  consoleLogger.info(
    `[updateManager] run - latestRelease: ${latestRelease}; latestPreRelease: ${latestPreRelease}`
  );

  updaterEventEmitter.emit("checking");

  const getBackendExists = () => fs.existsSync(backendPath);

  const toUpdateFrontendVer = getLatestFrontendVersion(
    latestRelease,
    latestPreRelease
  );

  let proceedUpdate = false;

  if (toUpdateFrontendVer) {
    consoleLogger.info(`update prompted for version: ${toUpdateFrontendVer}`);
    const userResponse = new Promise((resolve) => {
      updaterEventEmitter.emit("promptFrontendUpdate", resolve, {
        currentVersion: getFrontendVersion(),
        newVersion: toUpdateFrontendVer,
      });
    });

    proceedUpdate = await userResponse;
    consoleLogger.info(
      `user ${proceedUpdate ? "accepted" : "postponed"} update`
    );
  }

  // Auto updates via installer is only applicable for Windows
  // Auto updates for backend on Windows will be done via a powershell script due to %ProgramFiles% permission
  if (os.platform() === "win32") {
    consoleLogger.info("windows detected");
    // Frontend update via Installer for Windows
    // Will also update backend as it is packaged in the installer
    if (proceedUpdate) {
      updaterEventEmitter.emit("updatingFrontend");
      try {
        consoleLogger.info("downloading frontend");
        await downloadAndUnzipFrontendWindows(toUpdateFrontendVer);
        consoleLogger.info("successfully downloaded and unzipped frontend");

        const launchInstallerPrompt = new Promise((resolve) => {
          updaterEventEmitter.emit("frontendDownloadComplete", resolve);
        });

        const proceedInstall = await launchInstallerPrompt;

        if (proceedInstall) {
          const isInstallerScriptLaunched =
            await spawnScriptToLaunchInstaller();
          if (isInstallerScriptLaunched) {
            writeUserDetailsToFile({ firstLaunchOnUpdate: true });
            updaterEventEmitter.emit("installerLaunched");
          }
        }
      } catch (e) {
        consoleLogger.error(e);
        updaterEventEmitter.emit("frontendDownloadFailed");
      }
    }

  } else {
    let restartRequired = false;
    consoleLogger.info("mac detected");
    // user is on mac
    if (proceedUpdate) {
      updaterEventEmitter.emit("updatingFrontend");

      // Relaunch the app with new binaries if the frontend update is successful
      // If unsuccessful, the app will be launched with existing frontend
      try {
        consoleLogger.info("downloading frontend");
        await downloadAndUnzipFrontendMac(toUpdateFrontendVer);
        consoleLogger.info("successfully downloaded and unzipped frontend");

        writeUserDetailsToFile({ firstLaunchOnUpdate: true });
        restartRequired = true;
      } catch (e) {
        consoleLogger.error(e);
        updaterEventEmitter.emit("frontendDownloadFailed");
      }
    }

    if (restartRequired) {
      updaterEventEmitter.emit("restartTriggered");
    }

    // If backend already exists, skip the entire backend setup process
    // This handles the case where the app was updated and the new bundle doesn't have the prepackage
    if (getBackendExists()) {
      consoleLogger.info("backend already exists, skipping backend setup");
    } else {
      const isPrepackageValid = await validateZipFile(macOSPrepackageBackend);
      const isDev = process.env.NODE_ENV === "dev";
      if (isDev) {
        consoleLogger.info(
          "detected running from dev environment, will not validate/download prepackage"
        );
      } else if (isPrepackageValid) {
      let skipUnzip = false;
      if (getBackendExists() && fs.existsSync(hashPath)) {
        consoleLogger.info("backend and hash path exists");
        // compare zip file hash to determine whether to unzip
        const currHash = await hashPrepackage(macOSPrepackageBackend);
        const hash = fs.readFileSync(hashPath, "utf-8"); // stored hash

        // compare
        if (hash === currHash) {
          consoleLogger.info("hash of prepackage and hash path is the same");
          skipUnzip = true;
        }
      }

      if (!skipUnzip) {
        // expected to reach here when restart triggered on update
        consoleLogger.info("proceeding to unzip backend prepackage");
        updaterEventEmitter.emit("settingUp");
        await unzipBackendAndCleanUp(macOSPrepackageBackend);
        await hashAndSaveZip(macOSPrepackageBackend);
      }
      } else {
        // unlikely scenario
        consoleLogger.info(
          "prepackage zip is invalid. proceed to download from backend."
        );
        await downloadBackend(getFrontendVersion(), macOSPrepackageBackend);
        await unzipBackendAndCleanUp(macOSPrepackageBackend);
        await hashAndSaveZip(macOSPrepackageBackend);
      }
    }

  }
};

module.exports = {
  killChildProcess,
  run,
};
