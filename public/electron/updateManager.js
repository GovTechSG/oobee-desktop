const os = require("os");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const { exec, spawn } = require("child_process");

// Download a `<artifactUrl>.sha256` sidecar (over verified TLS) and match it
// against the actual SHA-256 of the on-disk artifact. Any failure — network
// error, missing sidecar, malformed digest, mismatch — throws, so the caller
// aborts install rather than extracting an unverified zip. The sidecar file
// content is expected to be a single 64-char hex digest, optionally followed
// by whitespace and a filename (shasum -a 256 output format).
//
// GitHub release-asset URLs (github.com/.../releases/download/...) always
// respond with HTTP 302 to a short-lived release-assets.githubusercontent.com
// URL. Node's `https.get` does not auto-follow redirects, so we walk up to
// MAX_REDIRECTS hops manually. Each hop must remain on https:// — a downgrade
// to http would let a network attacker who can rewrite Location: hand us an
// attacker-controlled sidecar with a matching (attacker-picked) hash.
const verifyArtifactSha256 = (artifactUrl, artifactPath) => new Promise((resolve, reject) => {
  const MAX_REDIRECTS = 5;
  const originalHashUrl = `${artifactUrl}.sha256`;

  const consumeBody = (res) => {
    let body = "";
    let aborted = false;
    res.setEncoding("utf8");
    res.on("data", (chunk) => {
      if (aborted) return;
      body += chunk;
      if (body.length > 4096) {
        aborted = true;
        res.destroy(new Error("sha256 sidecar too large"));
      }
    });
    res.on("end", () => {
      if (aborted) return;
      const expected = (body.trim().split(/\s+/)[0] || "").toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(expected)) {
        return reject(new Error(`Invalid SHA-256 digest at ${originalHashUrl}`));
      }
      const hash = crypto.createHash("sha256");
      const stream = fs.createReadStream(artifactPath);
      stream.on("error", reject);
      stream.on("data", (d) => hash.update(d));
      stream.on("end", () => {
        const actual = hash.digest("hex");
        if (actual !== expected) {
          return reject(new Error(`SHA-256 mismatch on ${artifactPath}: expected ${expected}, got ${actual}`));
        }
        resolve();
      });
    });
    res.on("error", reject);
  };

  const fetch = (currentUrl, redirectsLeft) => {
    const req = https.get(currentUrl, { timeout: 15000 }, (res) => {
      const { statusCode, headers } = res;
      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          return reject(new Error(`Too many redirects fetching ${originalHashUrl}`));
        }
        let nextUrl;
        try {
          nextUrl = new URL(headers.location, currentUrl).toString();
        } catch (e) {
          return reject(new Error(`Invalid redirect target for ${originalHashUrl}: ${headers.location}`));
        }
        if (!nextUrl.startsWith("https://")) {
          return reject(new Error(`Refusing non-https redirect from ${originalHashUrl} to ${nextUrl}`));
        }
        return fetch(nextUrl, redirectsLeft - 1);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`Missing SHA-256 sidecar at ${originalHashUrl} (HTTP ${statusCode})`));
      }
      consumeBody(res);
    });
    req.on("timeout", () => req.destroy(new Error(`Timed out fetching ${originalHashUrl}`)));
    req.on("error", reject);
  };

  fetch(originalHashUrl, MAX_REDIRECTS);
});
const {
  getFrontendVersion,
  getEngineVersion,
  appVersion,
  appPath,
  backendPath,
  resultsPath,
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

// Values under this module's control get interpolated into shell / PowerShell
// scripts and macOS admin AppleScript. The `baseUrl`, `tag`, `macAppName`,
// `macZipName`, `windowsZipName`, and `windowsInstallerName` fields all flow
// from the remotely-fetched release catalog (latest-release.json). Treat those
// as untrusted and reject anything outside an allowlist before it can reach
// bash `-c` / powershell `-Command` / osascript `do shell script`.

// Only allow the two GovTechSG repos we ship from. Any redirect target the
// catalog claims still has to match one of these — otherwise an attacker who
// mutates the JSON (e.g. via MITM before TLS was fixed, or by taking over the
// docs origin) could point the client at their own release zip.
const ALLOWED_BASE_URLS = new Set([
  "https://github.com/GovTechSG/oobee-desktop",
  "https://github.com/GovTechSG/oobee",
]);
// Version tag: allow the release-line pattern (with optional v prefix, plus
// optional pre-release suffix like -beta.1). Deliberately narrow so it can't
// carry shell metacharacters.
const TAG_RE = /^v?\d+(?:\.\d+){0,3}(?:-[A-Za-z0-9._-]+)?$/;
// Asset filenames: letters, digits, dot, dash, underscore. No slashes, spaces,
// or shell metacharacters. macAppName ends with `.app`.
const ASSET_ZIP_RE = /^[A-Za-z0-9._-]{1,128}\.zip$/;
const ASSET_EXE_RE = /^[A-Za-z0-9._-]{1,128}\.exe$/;
const ASSET_APP_RE = /^[A-Za-z0-9._-]{1,128}\.app$/;

const validateBaseUrl = (v) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !ALLOWED_BASE_URLS.has(v)) {
    throw new Error(`Rejecting untrusted baseUrl: ${v}`);
  }
  return v;
};
const validateTag = (v) => {
  if (typeof v !== "string" || !TAG_RE.test(v)) {
    throw new Error(`Rejecting untrusted tag: ${v}`);
  }
  return v;
};
const validateAssetName = (v, re, kind) => {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !re.test(v)) {
    throw new Error(`Rejecting untrusted ${kind}: ${v}`);
  }
  return v;
};

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

// Rejects on non-zero exit so callers can detect failure (unlike execCommand).
const execCommandStrict = async (command) => {
  const options = { cwd: appPath };
  return new Promise((resolve, reject) => {
    const process = exec(command, options, (err, stdout, stderr) => {
      currentChildProcess = null;
      if (err) {
        if (stderr) silentLogger.error(stderr.toString());
        return reject(err);
      }
      resolve(stdout);
    });
    currentChildProcess = process;
  });
};

// Runs a shell command with macOS admin privileges via osascript, triggering the
// native username/password prompt (which Admin By Request intercepts).
//
// Uses spawn with an argv array so the AppleScript expression is passed as a
// single argument — no outer bash quoting. That matters because our install
// command contains single-quoted paths ('/Applications/Oobee.app'), which cannot
// be nested inside bash `-e '...'` single quotes. The previous implementation
// wrapped with sh -c "osascript -e '...single-quoted paths...'", which bash
// silently mis-parsed, so osascript received a scrambled script and no admin
// prompt ever appeared.
const execCommandElevated = async (command, prompt = "Updater wants to install new version of accessibility scanner") => {
  // Escape for AppleScript's "..." string literal. Single quotes need no
  // escaping since the surrounding delimiters are double quotes.
  const escapeForAppleScript = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appleScriptEscaped = escapeForAppleScript(command);
  // `with prompt "..."` replaces the default "osascript wants to make changes"
  // line in the macOS authentication dialog with our own message.
  const promptEscaped = escapeForAppleScript(prompt);
  const appleScript = `do shell script "${appleScriptEscaped}" with prompt "${promptEscaped}" with administrator privileges`;

  return new Promise((resolve, reject) => {
    const proc = spawn("osascript", ["-e", appleScript], { cwd: appPath });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("error", (err) => {
      currentChildProcess = null;
      consoleLogger.error("Failed to spawn osascript:", err.message);
      reject(err);
    });
    proc.on("close", (code) => {
      currentChildProcess = null;
      if (code === 0) {
        consoleLogger.info("Elevated command completed successfully");
        return resolve(stdout);
      }
      const errMsg = (stderr || `osascript exited ${code}`).trim();
      consoleLogger.error("Elevated command failed:", command);
      consoleLogger.error("osascript stderr:", errMsg);
      // User cancel: AppleScript returns error -128 on the admin prompt.
      if (errMsg.includes("-128") || errMsg.includes("User canceled")) {
        consoleLogger.warn("User cancelled administrator authentication");
      }
      reject(new Error(errMsg));
    });
    currentChildProcess = proc;
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
const downloadAndUnzipFrontendWindows = async (tag, baseUrl = undefined, windowsZipName = undefined, windowsInstallerName = undefined) => {
  // The tag / baseUrl / asset-name fields all flow from the remote release
  // catalog, and the download URL and the PowerShell script are built by
  // string interpolation. Validate up front so a hostile catalog can't inject
  // `"; Invoke-Expression ...` payloads.
  const safeTag = validateTag(tag);
  const safeBaseUrl = validateBaseUrl(baseUrl) || "https://github.com/GovTechSG/oobee-desktop";
  // Remote asset name from latest-release.json — lets a future release rename
  // the zip (e.g. new repo with a different asset naming scheme).
  const remoteZipName = validateAssetName(windowsZipName, ASSET_ZIP_RE, "windowsZipName") || "oobee-desktop-windows.zip";
  const installerName = validateAssetName(windowsInstallerName, ASSET_EXE_RE, "windowsInstallerName") || "Oobee-setup.exe";

  const downloadUrl = `${safeBaseUrl}/releases/download/${safeTag}/${remoteZipName}`;

  // Local paths are internal — keep stable names so we don't churn folder layout.
  const localZipPath = `${resultsPath}\\oobee-desktop-windows.zip`;
  const extractDir = `${resultsPath}\\oobee-desktop-windows`;
  const installerPath = path.join(extractDir, installerName);

  // Download the sidecar (`<downloadUrl>.sha256`) alongside the artifact and
  // compare the digests before Expand-Archive runs. If either the sidecar
  // is missing/malformed or the hashes don't match, PowerShell exits 3 and
  // the caller aborts install — matching the enforcement in installer.ps1.
  const shellScript = `
  $ErrorActionPreference = "Stop"
  $webClient = New-Object System.Net.WebClient
  try {
    If (!(Test-Path -Path "${resultsPath}")) {
      New-Item -ItemType Directory -Path "${resultsPath}"
    }
    $webClient.DownloadFile("${downloadUrl}", "${localZipPath}")
    $webClient.DownloadFile("${downloadUrl}.sha256", "${localZipPath}.sha256")
  } catch {
    Write-Host "Error: Unable to download frontend"
    throw "Unable to download frontend"
    exit 1
  }

  try {
    $expected = (Get-Content -Raw -Path "${localZipPath}.sha256").Trim().Split()[0].ToLower()
    if (-not $expected -or $expected.Length -ne 64) { throw "Invalid SHA-256 sidecar" }
    $actual = (Get-FileHash -Path "${localZipPath}" -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) { throw "SHA-256 mismatch: expected $expected got $actual" }
    Remove-Item -Path "${localZipPath}.sha256" -Force -ErrorAction SilentlyContinue
  } catch {
    Write-Host "Error: Frontend integrity check failed"
    Remove-Item -Path "${localZipPath}","${localZipPath}.sha256" -Force -ErrorAction SilentlyContinue
    throw "Frontend integrity check failed"
    exit 3
  }

  try {
    Expand-Archive -Path "${localZipPath}" -DestinationPath "${extractDir}" -Force
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
        // Return the resolved installer path so the caller launches the
        // correct exe when `windowsInstallerName` overrides the default.
        resolve(installerPath);
      } else {
        reject(new Error(code.toString()));
      }
    });
  });
};

/**
 * Spawns a Shell Command process to download and unzip the frontend
 */
const downloadAndUnzipFrontendMac = async (tag, baseUrl = undefined, macAppName = undefined, macZipName = undefined) => {
  // Same rationale as downloadAndUnzipFrontendWindows: every string that flows
  // into the download URL or the shell / osascript install command comes from
  // the remote release catalog. Validate up front so a hostile catalog value
  // like `x'; rm -rf ~; :'.zip` can't reach bash.
  const safeTag = validateTag(tag);
  const safeBaseUrl = validateBaseUrl(baseUrl) || "https://github.com/GovTechSG/oobee-desktop";
  // Remote asset name from latest-release.json so a future release can rename
  // the zip asset (e.g. when moving to a new repo with different naming).
  const remoteZipName = validateAssetName(macZipName, ASSET_ZIP_RE, "macZipName") || "oobee-desktop-macos.zip";
  const downloadUrl = `${safeBaseUrl}/releases/download/${safeTag}/${remoteZipName}`;

  const parentDir = path.join(macOSExecutablePath, "..");

  // Path of the freshly-extracted .app. `macAppName` comes from latest-release.json
  // so a future release can rename the bundle (e.g. "Oobee Scanner.app") without a
  // client rebuild — the zip's top-level directory just has to match this name.
  const newAppName = validateAssetName(macAppName, ASSET_APP_RE, "macAppName") || "Oobee.app";
  const newAppPath = path.join(parentDir, newAppName);

  // `curl -fL`: `-f` makes curl exit non-zero on HTTP 4xx/5xx instead of writing
  // the error page as the "zip" and moving on (which would fail cryptically at
  // ditto). Local filename stays stable — it's an internal temp path.
  const localZipPath = `${resultsPath}/oobee-desktop-mac.zip`;
  const downloadCommand = `mkdir -p '${resultsPath}' && curl -fL '${downloadUrl}' -o '${localZipPath}'`;

  // Use a temporary name that won't trigger macOS security warnings.
  //
  // The command must be idempotent for retry: if the unprivileged attempt
  // partially mutates state (e.g. the `mv` completes but a later step fails
  // because ABR elevation ends mid-flow), the elevated retry runs the same
  // string and would otherwise fail at `mv` because its source is gone. So:
  //   - `mv` is guarded by an existence check on the source
  //   - `rm` on the zip uses -f so a missing file isn't fatal
  //   - `rm -rf` on the temp app is already tolerant of a missing target
  //   - `xattr` is wrapped in `(... || true)` because curl-downloaded files
  //     typically don't carry com.apple.quarantine, so `xattr -rd` would exit
  //     non-zero with "Attribute not found" and break the whole && chain —
  //     making a successful install look like a failure.
  const tempAppName = `.Oobee.tmp.${Date.now()}.app`;
  const installCommand = `{ [ ! -e '${macOSExecutablePath}' ] || mv '${macOSExecutablePath}' '${parentDir}/${tempAppName}'; } && ditto -xk '${localZipPath}' '${parentDir}' && rm -f '${localZipPath}' && rm -rf '${parentDir}/${tempAppName}' && (xattr -rd com.apple.quarantine '${newAppPath}' 2>/dev/null || true)`;

  await execCommand(downloadCommand);

  // Verify the downloaded zip against the SHA-256 sidecar published alongside
  // the artifact BEFORE any elevation prompt fires. If the sidecar is missing
  // or the hashes disagree, throw so we do not run ditto (which would extract
  // an unverified bundle into /Applications) or trigger an admin prompt on
  // behalf of an attacker-supplied zip.
  try {
    await verifyArtifactSha256(downloadUrl, localZipPath);
    consoleLogger.info(`Integrity check passed for ${downloadUrl}`);
  } catch (err) {
    try { fs.unlinkSync(localZipPath); } catch (_) {}
    throw new Error(`Frontend integrity check failed: ${err.message}`);
  }

  // Try unprivileged first. If it fails for any reason (POSIX denial, MDM/Admin
  // By Request policy, SIP, etc.), fall back to the elevated path which triggers
  // the native macOS username/password prompt — the same prompt Admin By Request
  // intercepts to run its approval workflow.
  let installed = false;
  try {
    consoleLogger.info("Attempting install without elevation");
    await execCommandStrict(installCommand);
    installed = true;
    consoleLogger.info("Install completed without elevation");
  } catch (err) {
    consoleLogger.warn(`Unprivileged install failed: ${err.message}. Falling back to elevated install.`);
  }

  if (!installed) {
    consoleLogger.info("=== Admin privileges required for app update ===");
    consoleLogger.info("A macOS authentication dialog will appear - please enter your admin credentials.");
    await execCommandElevated(installCommand);
    consoleLogger.info("Elevated install completed");
  }

  // Verify the new bundle is actually in place AND is the expected version
  // before the caller treats this as success. Without this, a silent failure
  // (swallowed error, cancelled auth prompt, MDM block returning 0, or a stale
  // bundle left behind at the same path) would restart on the old version.
  // We check `newAppPath`, not `macOSExecutablePath`, because if the release
  // renamed the bundle these are different paths — and the just-extracted
  // bundle only exists at the new name.
  if (!fs.existsSync(newAppPath)) {
    throw new Error(`Update verification failed: ${newAppPath} not found after install`);
  }

  if (tag) {
    const plistPath = path.join(newAppPath, "Contents", "Info.plist");
    let installedVersion;
    try {
      installedVersion = execSync(
        `plutil -extract CFBundleShortVersionString raw -o - '${plistPath}'`,
        { encoding: "utf8" }
      ).trim();
    } catch (e) {
      throw new Error(`Update verification failed: unable to read version from ${plistPath}: ${e.message}`);
    }

    // `tag` may be prefixed with "v" (e.g. "v0.11.2"); Info.plist stores the bare version.
    const expected = safeTag.replace(/^v/, "");
    if (installedVersion !== expected) {
      throw new Error(
        `Update verification failed: expected version ${expected} but installed bundle reports ${installedVersion}`
      );
    }
    consoleLogger.info(`Install verified: ${newAppPath} is version ${installedVersion}`);
  }

  return newAppPath;
};

/**
 * Spawn a process to launch the InnoSetup installer executable, which contains the frontend and backend
 * upon confirmation from the user, the installer will be launched & Electron will exit
 * @param {string} installerPath Absolute path to the InnoSetup installer.
 * @returns {boolean} true if the installer executable was launched successfully, false otherwise
 */
const spawnScriptToLaunchInstaller = (installerPath) => {
  // Verify the installer actually exists on disk before we hand off to Electron
  // exit. spawn() on Windows emits ENOENT as an *async* 'error' event — it does
  // NOT throw synchronously — so a missing exe would previously slip past the
  // surrounding try/catch, return true, and Electron would exit silently with
  // no installer running.
  if (!fs.existsSync(installerPath)) {
    consoleLogger.error(`Installer not found at ${installerPath}`);
    return false;
  }
  try {
    const child = spawn(installerPath, [], {
      detached: true,
      stdio: "ignore",
    });
    // Async ENOENT / permission errors surface here, not via try/catch.
    child.on("error", (e) => {
      consoleLogger.error(`Installer spawn error: ${e.message}`);
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

const run = async (updaterEventEmitter, latestRelease, latestPreRelease, options = {}) => {
  const {
    baseUrl,
    macAppName,
    macZipName,
    windowsZipName,
    windowsInstallerName,
  } = options;

  // If Windows and powershell not available, skip update
  if (os.platform() === "win32" && !checkPowerShellAvailable()) return;

  consoleLogger.info(
    `[updateManager] run - latestRelease: ${latestRelease}; latestPreRelease: ${latestPreRelease}; baseUrl: ${baseUrl}; macAppName: ${macAppName}; macZipName: ${macZipName}; windowsZipName: ${windowsZipName}; windowsInstallerName: ${windowsInstallerName}`
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
        // Capture the resolved installer path so we launch the correct exe even
        // when `windowsInstallerName` in latest-release.json overrides the
        // hardcoded `Oobee-setup.exe` default.
        const resolvedInstallerPath = await downloadAndUnzipFrontendWindows(
          toUpdateFrontendVer,
          baseUrl,
          windowsZipName,
          windowsInstallerName,
        );
        consoleLogger.info("successfully downloaded and unzipped frontend");

        const launchInstallerPrompt = new Promise((resolve) => {
          updaterEventEmitter.emit("frontendDownloadComplete", resolve);
        });

        const proceedInstall = await launchInstallerPrompt;

        if (proceedInstall) {
          const isInstallerScriptLaunched =
            spawnScriptToLaunchInstaller(resolvedInstallerPath);
          if (isInstallerScriptLaunched) {
            writeUserDetailsToFile({ firstLaunchOnUpdate: true });
            updaterEventEmitter.emit("installerLaunched");
          } else {
            // Surface a launch failure to the UI instead of exiting silently.
            updaterEventEmitter.emit("frontendDownloadFailed");
          }
        }
      } catch (e) {
        consoleLogger.error(e);
        updaterEventEmitter.emit("frontendDownloadFailed");
      }
    }

  } else {
    let restartRequired = false;
    // The relaunch target. Defaults to the currently-running bundle path,
    // but the mac update flow reassigns this to `parentDir/${macAppName}` so a
    // rename in a future release (e.g. "Oobee.app" -> "Oobee Scanner.app")
    // relaunches the newly-extracted bundle rather than the vanished old path.
    let newAppPath = macOSExecutablePath;
    consoleLogger.info("mac detected");
    // user is on mac
    if (proceedUpdate) {
      updaterEventEmitter.emit("updatingFrontend");

      // Relaunch the app with new binaries if the frontend update is successful
      // If unsuccessful, the app will be launched with existing frontend
      try {
        consoleLogger.info("downloading frontend");
        newAppPath = await downloadAndUnzipFrontendMac(toUpdateFrontendVer, baseUrl, macAppName, macZipName);
        consoleLogger.info("successfully downloaded and unzipped frontend");

        writeUserDetailsToFile({ firstLaunchOnUpdate: true });
        restartRequired = true;
      } catch (e) {
        consoleLogger.error(e);
        updaterEventEmitter.emit("frontendDownloadFailed");
      }
    }

    if (restartRequired) {
      updaterEventEmitter.emit("restartTriggered", newAppPath);
    }

    // If backend already exists, check whether the engine version matches the app version.
    // If versions differ, the bundled prepackage is newer and we need to re-extract.
    let backendNeedsSetup = !getBackendExists();

    if (getBackendExists()) {
      try {
        const engineVersion = getEngineVersion();
        if (engineVersion && engineVersion !== appVersion) {
          consoleLogger.info(
            `Engine version (${engineVersion}) differs from app version (${appVersion}), re-extracting backend`
          );
          backendNeedsSetup = true;
        } else {
          consoleLogger.info(
            `Engine version (${engineVersion}) matches app version (${appVersion}), skipping backend setup`
          );
        }
      } catch (e) {
        consoleLogger.warn("Unable to read engine version, re-extracting backend");
        backendNeedsSetup = true;
      }
    }

    if (!backendNeedsSetup) {
      consoleLogger.info("backend already exists and is up to date, skipping backend setup");
    } else {
      const isPrepackageValid = await validateZipFile(macOSPrepackageBackend);
      const isDev = process.env.NODE_ENV === "dev";
      if (isDev) {
        consoleLogger.info(
          "detected running from dev environment, will not validate/download prepackage"
        );
      } else if (isPrepackageValid) {
        consoleLogger.info("proceeding to unzip backend prepackage");
        updaterEventEmitter.emit("settingUp");
        await unzipBackendAndCleanUp(macOSPrepackageBackend);
        await hashAndSaveZip(macOSPrepackageBackend);
      } else {
        // The prepackage lives inside the signed .app bundle at
        // Contents/Resources/oobee-portable-mac.zip. If it's invalid, this is a
        // build/install failure — do NOT curl a replacement into it: that path is
        // sealed by the code signature, and any write there breaks the signature
        // and makes macOS refuse to launch the app ("Oobee.app is damaged").
        consoleLogger.error(
          `Bundled backend prepackage invalid at ${macOSPrepackageBackend}; skipping (would corrupt signed bundle if overwritten).`
        );
      }
    }

  }
};

module.exports = {
  killChildProcess,
  run,
};
