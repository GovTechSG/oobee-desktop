const path = require("path");
const os = require("os");
const fs = require("fs");
const { silentLogger } = require("./logs.js");
const { execSync } = require("child_process");

const appPath = (() => {
  if (os.platform() === "win32") {
    try {
      // Prefer relative path to Frontend if provided and contains "Oobee Backend"
      const windowsAppParentPath = path.join(process.cwd(), "..");
      if (
        windowsAppParentPath &&
        fs.existsSync(path.join(windowsAppParentPath, "Oobee Backend"))
      ) {
        return windowsAppParentPath;
      }
    } catch (error) {
      // Do nothing
    }
 
    // Fallback: Check common installation directories
    return fs.existsSync(path.join(process.env.APPDATA, "Oobee Desktop"))
      ? path.join(process.env.APPDATA, "Oobee Desktop")
      : path.join(process.env.PROGRAMFILES, "Oobee Desktop");
  } else {
    // macOS
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Oobee"
    );
}})();

const releaseUrl =
  "https://api.github.com/repos/GovTechSG/oobee/releases/latest";

const allReleasesUrl = "https://api.github.com/repos/GovTechSG/oobee/releases";

const backendPath = path.join(appPath, "Oobee Backend");
const frontendPath = path.join(appPath, "Oobee Frontend");

const getMacOSExecutablePath = () => {
  let executablePath = require("path").dirname(
    require("electron").app.getPath("exe")
  );

  // Retrieve the path to the executable up to the .app folder
  if (executablePath !== null) {
    executablePath = executablePath.substring(
      0,
      executablePath.lastIndexOf(".app") + 4
    );
  }

  return executablePath;
};
const macOSExecutablePath = getMacOSExecutablePath();

const macOSPrepackageBackend = path.join(process.resourcesPath, "oobee-portable-mac.zip");

const resultsPath =
  os.platform() === "win32"
    ? path.join(process.env.APPDATA, "Oobee")
    : appPath;

const enginePath = path.join(backendPath, "oobee");

const getEngineVersion = () => {
  const enginePackageFile = fs.readFileSync(path.join(enginePath, "package.json"), 'utf8');
  try {
    const enginePackage = JSON.parse(enginePackageFile);
    return enginePackage.version;
  } catch (error) {
    return null;
  }
};

const getFrontendVersion = () => {
  // Directory is only valid for and used by Windows
  if (os.platform() === "win32") {
    return require(path.join(frontendPath, "resources", "app", "package.json"))
      .version;
  } else {
    return appVersion;
  }
};

const appVersion = require(path.join(
  __dirname,
  "..",
  "..",
  "package.json"
)).version;

const preloadPath = path.join(__dirname, "preload.js");

const defaultExportDir = path.join(os.homedir(), "Documents", "Oobee");

const indexPath = path.join(__dirname, "..", "..", "build", "index.html");

const getPathVariable = () => {
  if (os.platform() === "win32") {
    const directories = [
      "nodejs-win",
      "oobee\\node_modules\\.bin",
      "jre\\bin",
      "verapdf",
    ];
    return `${directories.map((d) => path.join(backendPath, d)).join(";")};${
      process.env.PATH
    }`;
  } else {
    const directories = [
      `${os.arch() === "arm64" ? "nodejs-mac-arm64" : "nodejs-mac-x64"}/bin`,
      "oobee/node_modules/.bin",
      "jre/bin",
      "verapdf"
    ];
    return `${directories
      .map((d) => path.join(backendPath, d))
      .join(":")}:${
        process.env.PATH
      }`;
  }
};

const scanResultsPath = path.join(resultsPath, "results");

const updateBackupsFolder = path.join(
  appPath,
  "30789f0f-73f5-43bc-93a6-e499e4a20f7a"
);

const userDataFilePath =
  os.platform() === "win32"
    ? path.join(resultsPath, "userData.txt")
    : path.join(appPath, "userData.txt");

const browserTypes = {
  chrome: "chrome",
  edge: "msedge",
  chromium: "chromium",
};

const getDefaultChromeDataDir = () => {
  try {
    let defaultChromeDataDir = null;
    if (os.platform() === "win32") {
      defaultChromeDataDir = path.join(
        os.homedir(),
        "AppData",
        "Local",
        "Google",
        "Chrome",
        "User Data"
      );
    } else if (os.platform() === "darwin") {
      defaultChromeDataDir = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Google",
        "Chrome"
      );
    }
    if (defaultChromeDataDir && fs.existsSync(defaultChromeDataDir)) {
      return defaultChromeDataDir;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`Error in getDefaultChromeDataDir(): ${error}`);
  }
};

const getDefaultEdgeDataDir = () => {
  try {
    let defaultEdgeDataDir = null;
    if (os.platform() === "win32") {
      defaultEdgeDataDir = path.join(
        os.homedir(),
        "AppData",
        "Local",
        "Microsoft",
        "Edge",
        "User Data"
      );
    } else if (os.platform() === "darwin") {
      defaultEdgeDataDir = path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Microsoft Edge"
      );
    }

    if (defaultEdgeDataDir && fs.existsSync(defaultEdgeDataDir)) {
      return defaultEdgeDataDir;
    } else {
      return null;
    }
  } catch (error) {
    console.error(`Error in getDefaultEdgeDataDir(): ${error}`);
  }
};

const isWindows = os.platform() === "win32";
const forbiddenCharactersInDirPath = ['<', '>', ':', '\"', '/', '\\', '|', '?', '*'];
  
const maxLengthForDirName = 80; 

const versionComparator = (ver1, ver2) => {
  // return 1 if ver1 >= ver2, else return -1. Return 0 if either arg is not a
  // usable version string — callers use `=== 1` / `=== -1`, so 0 naturally
  // reads as "no upgrade" and prevents a malformed release catalog from
  // crashing the app with a TypeError on .split().
  if (typeof ver1 !== 'string' || typeof ver2 !== 'string') {
    return 0;
  }
  const splitVer1 = ver1.split('.');
  const splitVer2 = ver2.split('.');
  let idx = 0; 
  while (splitVer1[idx] && splitVer2[idx]) {
    const int1 = parseInt(splitVer1[idx]);
    const int2 = parseInt(splitVer2[idx]);
    if (int1 > int2) {
      return 1; 
    } else if (int1 < int2) {
      return -1;
    }
    idx++;
  }

  if (!splitVer1[idx] && splitVer2[idx]) return -1; 

  return 1;
};

const uploadFolderName = "Upload Files";

const hashPath = path.join(appPath, 'backendHash.txt');

// On-disk WCAG corpus used by the `search_wcag` LLM tool. Ships in the app
// resources under `public/electron/wcag-index/`. Because forge.config.js
// already asar-unpacks the entire `public/electron` tree (for
// node-llama-cpp native binaries), the corpus is directly readable at
// `__dirname/wcag-index` in packaged builds as well as in dev. Returns
// null if the directory is missing so the tool can fail gracefully rather
// than crashing the tool-use loop.
const getWcagIndexPath = () => {
  const p = path.join(__dirname, 'wcag-index');
  return fs.existsSync(p) ? p : null;
};

// Deep-link scheme used to unlock gated features. Each UUID in the map
// corresponds to a specific feature — a browser click on
// `oobee://unlock-feature/<UUID>` writes the mapped `flag` key to
// userData.txt (value: true) and emits the mapped `ipc` event to the
// renderer. Add new entries here to gate additional features by UUID.
const unlockProtocol = 'oobee';
const unlockHost = 'unlock-feature';
const unlockFeatureMap = {
  'f3d7b1c2-9a4e-4b6f-8d2a-1e7c9b0f5a83': {
    flag: 'llmAnalysisEnabled',
    ipc: 'llmAnalysisUnlocked',
  },
};

module.exports = {
  appPath,
  releaseUrl,
  backendPath,
  frontendPath,
  enginePath,
  getEngineVersion,
  getFrontendVersion,
  appVersion,
  preloadPath,
  indexPath,
  getPathVariable,
  scanResultsPath,
  updateBackupsFolder,
  resultsPath,
  userDataFilePath,
  browserTypes,
  macOSExecutablePath,
  defaultExportDir,
  isWindows,
  forbiddenCharactersInDirPath,
  maxLengthForDirName,
  versionComparator,
  uploadFolderName,
  allReleasesUrl,
  macOSPrepackageBackend,
  hashPath,
  getDefaultChromeDataDir,
  getDefaultEdgeDataDir,
  unlockProtocol,
  unlockHost,
  unlockFeatureMap,
  getWcagIndexPath,
};
