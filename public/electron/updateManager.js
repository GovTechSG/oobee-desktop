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
const {
  writeUserDetailsToFile,
  readUserDataFromFile,
} = require("./userDataManager");

let currentChildProcess;
let isLabMode = false;

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
  let unzipCommand = `mkdir -p '${backendPath}' && tar -xf '${zipPath}' -C '${backendPath}' &&
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
    ? `https://github.com/GovTechSG/purple-a11y-desktop/releases/download/${tag}/purple-a11y-desktop-windows.zip`
    : frontendReleaseUrl;

  const shellScript = `
  $webClient = New-Object System.Net.WebClient
  try {
    If (!(Test-Path -Path "${resultsPath}")) {
      New-Item -ItemType Directory -Path "${resultsPath}"
    }
    $webClient.DownloadFile("${downloadUrl}", "${resultsPath}\\purple-a11y-desktop-windows.zip")
  } catch {
    Write-Host "Error: Unable to download frontend"
    throw "Unable to download frontend"
    exit 1
  }

  try {
    Expand-Archive -Path "${resultsPath}\\purple-a11y-desktop-windows.zip" -DestinationPath "${resultsPath}\\purple-a11y-desktop-windows" -Force
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
    ? `https://github.com/GovTechSG/purple-a11y-desktop/releases/download/${tag}/purple-a11y-desktop-macos.zip`
    : frontendReleaseUrl;

  const command = `
  mkdir -p '${resultsPath}' &&
  curl -L '${downloadUrl}' -o '${resultsPath}/purple-a11y-desktop-mac.zip' &&
  mv '${macOSExecutablePath}' '${path.join(
    macOSExecutablePath,
    ".."
  )}/Purple A11y Old.app' &&
  ditto -xk '${resultsPath}/purple-a11y-desktop-mac.zip' '${path.join(
    macOSExecutablePath,
    ".."
  )}' &&
  rm '${resultsPath}/purple-a11y-desktop-mac.zip' &&
  rm -rf '${path.join(macOSExecutablePath, "..")}/Purple A11y Old.app' &&
  xattr -rd com.apple.quarantine '${path.join(
    macOSExecutablePath,
    ".."
  )}/Purple A11y.app' `;

  await execCommand(command);

};

/**
 * Spawn a PowerShell process to launch the InnoSetup installer executable, which contains the frontend and backend
 * upon confirmation from the user, the installer will be launched & Electron will exit
 * @returns {Promise<boolean>} true if the installer executable was launched successfully, false otherwise
 */
const spawnScriptToLaunchInstaller = () => {
  const shellScript = `Start-Process -FilePath "${installerExePath}"`;

  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", ["-Command", shellScript]);
    currentChildProcess = ps;

    ps.stdout.on("data", (data) => {
      console.log(data.toString());
    });

    ps.stderr.on("data", (data) => {
      currentChildProcess = null;
      console.error(data.toString());
    });

    ps.on("exit", (code) => {
      currentChildProcess = null;
      if (code === 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
};

/**
 * Spawns a powershell child_process which then runs a powershell script with admin priviledges
 * This will cause a pop-up on the user's ends
 */
const downloadAndUnzipBackendWindows = async (tag = undefined) => {
  const scriptPath = path.join(
    __dirname,
    "..",
    "..",
    "scripts",
    "downloadAndUnzipBackend.ps1"
  );
  return new Promise((resolve, reject) => {
    const ps = spawn("powershell.exe", [
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      tag, // release tag to download
    ]); // Log any output from the PowerShell script

    currentChildProcess = ps;

    ps.stdout.on("data", (data) => {
      silentLogger.debug(data.toString());
      console.log(data.toString());
    });

    // Log any errors from the PowerShell script
    ps.stderr.on("data", (data) => {
      silentLogger.debug(data.toString());
      console.error(data.toString());
      currentChildProcess = null;
      resolve(false);
    });

    ps.on("exit", (code) => {
      currentChildProcess = null;
      if (code === 0) {
        resolve(true);
      } else {
        resolve(false);
      }
    });
  });
};

const downloadBackend = async (tag, zipPath) => {
  const downloadUrl = `https://github.com/GovTechSG/purple-a11y/releases/download/${tag}/purple-a11y-portable-mac.zip`;
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
  consoleLogger.info(
    `[updateManager] run - latestRelease: ${latestRelease}; latestPreRelease: ${latestPreRelease}`
  );

  // Start Oobee instead if exist
  updaterEventEmitter.emit("restartA11yToOobee");
  
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
      updaterEventEmitter.emit("promptFrontendUpdate", resolve);
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

    // unlikely scenario
    if (!getBackendExists()) {
      updaterEventEmitter.emit("settingUp");
      // Trigger download for backend via Github if backend does not exist
      await downloadAndUnzipBackendWindows(getFrontendVersion());
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
      consoleLogger.info("restarting app...");
      updaterEventEmitter.emit("restartTriggered");
    }

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
};

module.exports = {
  killChildProcess,
  run,
};
