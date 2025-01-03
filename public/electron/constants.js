const path = require("path");
const os = require("os");
const fs = require("fs");
const { globSync } = require("glob");
const { silentLogger } = require("./logs.js");
const { execSync } = require("child_process");

const appPath =
  os.platform() === "win32"
    ? path.join(process.env.PROGRAMFILES, "Oobee Desktop")
    : path.join(
        os.homedir(),
        "Library",
        "Application Support",
        "Oobee"
      );

const releaseUrl =
  "https://api.github.com/repos/GovTechSG/oobee/releases/latest";

const allReleasesUrl = "https://api.github.com/repos/GovTechSG/oobee/releases";

const frontendReleaseUrl =
  os.platform() === "win32"
  ? "https://github.com/GovTechSG/oobee-desktop/releases/latest/download/oobee-desktop-windows.zip"
  : "https://github.com/GovTechSG/oobee-desktop/releases/latest/download/oobee-desktop-macos.zip";

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

const installerExePath = path.join(
  resultsPath,
  "oobee-desktop-windows",
  "Oobee-setup.exe"
);

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

const playwrightBrowsersPath = path.join(backendPath, "ms-playwright");

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

const artifactInstallerPath = path.join(appPath, "Oobee-setup.exe");

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

const cloneChromeProfileCookieFiles = (options, destDir) => {
  let profileCookiesDir;
  // Cookies file per profile is located in .../User Data/<profile name>/Network/Cookies for windows
  // and ../Chrome/<profile name>/Cookies for mac
  let profileNamesRegex;
  if (os.platform() === "win32") {
    profileCookiesDir = globSync("**/Network/Cookies", {
      ...options,
      ignore: ["Oobee/**"],
    });
    profileNamesRegex = /User Data\\(.*?)\\Network/;
  } else if (os.platform() === "darwin") {
    // maxDepth 2 to avoid copying cookies from the Oobee directory if it exists
    profileCookiesDir = globSync("**/Cookies", {
      ...options,
      ignore: "Oobee/**",
    });
    profileNamesRegex = /Chrome\/(.*?)\/Cookies/;
  }

  if (profileCookiesDir.length > 0) {
    let success = true;
    profileCookiesDir.forEach((dir) => {
      const profileName = dir.match(profileNamesRegex)[1];
      if (profileName) {
        let destProfileDir = path.join(destDir, profileName);
        if (os.platform() === "win32") {
          destProfileDir = path.join(destProfileDir, "Network");
        }
        // Recursive true to create all parent directories (e.g. PbProfile/Default/Cookies)
        if (!fs.existsSync(destProfileDir)) {
          fs.mkdirSync(destProfileDir, { recursive: true });
          if (!fs.existsSync(destProfileDir)) {
            fs.mkdirSync(destProfileDir);
          }
        }

        // Prevents duplicate cookies file if the cookies already exist
        if (!fs.existsSync(path.join(destProfileDir, "Cookies"))) {
          try {
            fs.copyFileSync(dir, path.join(destProfileDir, "Cookies"));
          } catch (err) {
            silentLogger.error(err);
            success = false;
          }
        }
      }
    });
    return success;
  }

  silentLogger.warn(
    "Unable to find Chrome profile cookies file in the system."
  );
  return false;
};

const cloneEdgeProfileCookieFiles = (options, destDir) => {
  let profileCookiesDir;
  // Cookies file per profile is located in .../User Data/<profile name>/Network/Cookies for windows
  // and ../Chrome/<profile name>/Cookies for mac
  let profileNamesRegex;
  // Ignores the cloned Oobee directory if exists
  if (os.platform() === "win32") {
    profileCookiesDir = globSync("**/Network/Cookies", {
      ...options,
      ignore: "Oobee/**",
    });
    profileNamesRegex = /User Data\\(.*?)\\Network/;
  } else if (os.platform() === "darwin") {
    // Ignores copying cookies from the Oobee directory if it exists
    profileCookiesDir = globSync("**/Cookies", {
      ...options,
      ignore: "Oobee/**",
    });
    profileNamesRegex = /Microsoft Edge\/(.*?)\/Cookies/;
  }

  if (profileCookiesDir.length > 0) {
    let success = true;
    profileCookiesDir.forEach((dir) => {
      const profileName = dir.match(profileNamesRegex)[1];
      if (profileName) {
        let destProfileDir = path.join(destDir, profileName);
        if (os.platform() === "win32") {
          destProfileDir = path.join(destProfileDir, "Network");
        }
        // Recursive true to create all parent directories (e.g. PbProfile/Default/Cookies)
        if (!fs.existsSync(destProfileDir)) {
          fs.mkdirSync(destProfileDir, { recursive: true });
          if (!fs.existsSync(destProfileDir)) {
            fs.mkdirSync(destProfileDir);
          }
        }

        // Prevents duplicate cookies file if the cookies already exist
        if (!fs.existsSync(path.join(destProfileDir, "Cookies"))) {
          try {
            fs.copyFileSync(dir, path.join(destProfileDir, "Cookies"));
          } catch (err) {
            silentLogger.error(err);
            success = false;
          }
        }
      }
    });
    return success;
  }
  silentLogger.warn("Unable to find Edge profile cookies file in the system.");
  return false;
};

const cloneLocalStateFile = (options, destDir) => {
  const localState = globSync("**/*Local State", {
    ...options,
    maxDepth: 1,
  });

  if (localState.length > 0) {
    let success = true;
    localState.forEach((dir) => {
      try {
        fs.copyFileSync(dir, path.join(destDir, "Local State"));
      } catch (err) {
        silentLogger.error(err);
        success = false;
      }
    });
    return success;
  }
  silentLogger.warn("Unable to find local state file in the system.");
  return false;
};

const cloneChromeProfiles = () => {
  const baseDir = getDefaultChromeDataDir();

  if (!baseDir) {
    console.warn("Unable to find Chrome data directory in the system.");
    return;
  }

  const destDir = path.join(baseDir, "Oobee");

  if (fs.existsSync(destDir)) {
    deleteClonedChromeProfiles();
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
  }

  const baseOptions = {
    cwd: baseDir,
    recursive: true,
    absolute: true,
    nodir: true,
  };
  const cloneLocalStateFileSucess = cloneLocalStateFile(baseOptions, destDir);
  if (
    cloneChromeProfileCookieFiles(baseOptions, destDir) &&
    cloneLocalStateFileSucess
  ) {
    return destDir;
  }

  return null;
};

const cloneEdgeProfiles = () => {
  const baseDir = getDefaultEdgeDataDir();

  if (!baseDir) {
    console.warn("Unable to find Edge data directory in the system.");
    return;
  }

  const destDir = path.join(baseDir, "Oobee");

  if (fs.existsSync(destDir)) {
    deleteClonedEdgeProfiles();
  }

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir);
  }

  const baseOptions = {
    cwd: baseDir,
    recursive: true,
    absolute: true,
    nodir: true,
  };

  const cloneLocalStateFileSucess = cloneLocalStateFile(baseOptions, destDir);
  if (
    cloneEdgeProfileCookieFiles(baseOptions, destDir) &&
    cloneLocalStateFileSucess
  ) {
    return destDir;
  }

  return null;
};

const deleteClonedChromeProfiles = () => {
  const baseDir = getDefaultChromeDataDir();

  if (!baseDir) {
    silentLogger.warn(`Unable to find Chrome data directory in the system.`);
    return;
  }

  // Find all the Oobee directories in the Chrome data directory
  const destDir = globSync("**/Oobee*", {
    cwd: baseDir,
    recursive: true,
    absolute: true,
  });

  if (destDir.length > 0) {
    destDir.forEach((dir) => {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true });
        } catch (err) {
          silentLogger.warn(
            `Unable to delete ${dir} folder in the Chrome data directory. ${err}`
          );
        }
      }
    });
    return;
  }

  silentLogger.warn(
    "Unable to find Oobee directory in the Chrome data directory."
  );
};

const deleteClonedEdgeProfiles = () => {
  const baseDir = getDefaultEdgeDataDir();

  if (!baseDir) {
    silentLogger.warn(`Unable to find Edge data directory in the system.`);
    return;
  }

  // Find all the Oobee directories in the Chrome data directory
  const destDir = globSync("**/Oobee*", {
    cwd: baseDir,
    recursive: true,
    absolute: true,
  });

  if (destDir.length > 0) {
    destDir.forEach((dir) => {
      if (fs.existsSync(dir)) {
        try {
          fs.rmSync(dir, { recursive: true });
        } catch (err) {
          silentLogger.warn(
            `Unable to delete ${dir} folder in the Chrome data directory. ${err}`
          );
        }
      }
    });
    return;
  }

  silentLogger.warn(
    "Unable to find Oobee directory in the Edge data directory."
  );
};

const deleteClonedProfiles = (browserChannel) => {
  if (browserChannel === browserTypes.chrome) {
    deleteClonedChromeProfiles();
  } else if (browserChannel === browserTypes.edge) {
    deleteClonedEdgeProfiles();
  }
};

const getProxy = () => {
  if (os.platform() === "win32") {
    let internetSettings;
    try {
      internetSettings = execSync(
        'Get-ItemProperty -Path "Registry::HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"',
        { shell: "powershell.exe" }
      )
        .toString()
        .split("\n");
    } catch (e) {
      console.log(e.toString());
      silentLogger.error(e.toString());
    }

    const getSettingValue = (settingName) =>
      internetSettings
        .find((s) => s.startsWith(settingName))
        // split only once at with ':' as the delimiter
        ?.split(/:(.*)/s)[1]
        ?.trim();

    if (getSettingValue("AutoConfigURL")) {
      return { type: "autoConfig", url: getSettingValue("AutoConfigURL") };
    } else if (getSettingValue("ProxyEnable") === "1") {
      return { type: "manualProxy", url: getSettingValue("ProxyServer") };
    } else {
      return null;
    }
  } else {
    // develop for mac
    return null;
  }
};

const proxy = getProxy();

const createPlaywrightContext = async (browser, screenSize, nonHeadless) => {
  const playwrightPath = path.join(
    backendPath,
    "oobee",
    "node_modules",
    "playwright",
    "index.js"
  );
  const playwright = require(playwrightPath);
  const chromium = playwright.chromium;

  const chromeDataDir = getDefaultChromeDataDir();
  const edgeDataDir = getDefaultEdgeDataDir();

  let browserChannel = null;
  let userDataDir = "";

  if (browser === browserTypes.chrome && chromeDataDir) {
    userDataDir = cloneChromeProfiles();
    if (userDataDir) {
      browserChannel = browserTypes.chrome;
    } else {
      userDataDir = cloneEdgeProfiles();
      if (edgeDataDir && userDataDir) {
        browserChannel = browserTypes.edge;
      }
    }
  } else if (browser === "edge" && edgeDataDir) {
    userDataDir = cloneEdgeProfiles();
    if (userDataDir) {
      browserChannel = browserTypes.edge;
    } else {
      userDataDir = cloneChromeProfiles();
      if (chromeDataDir && userDataDir) {
        browserChannel = browserTypes.chrome;
      }
    }
  }

  let launchOptionsArgs = ["--window-size=10,10"];

  // Check if running in docker container
  if (fs.existsSync("/.dockerenv")) {
    launchOptionsArgs.push([
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
    ]);
  }

  if (proxy && proxy.type === "autoConfig") {
    launchOptionsArgs.push(`--proxy-pac-url=${proxy.url}`);
  } else if (proxy && proxy.type === "manualProxy") {
    launchOptionsArgs.push(`--proxy-server=${proxy.url}`);
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    ignoreDefaultArgs: ["--use-mock-keychain"],
    ...(browserChannel && { channel: browserChannel }),
    ...((proxy || nonHeadless) && { headless: false }),
    ...(screenSize && {
      viewport: {
        width: screenSize.width,
        height: screenSize.height,
      },
    }),
    args: launchOptionsArgs,
  });

  return { context, browserChannel, proxy };
};

const isWindows = os.platform() === "win32";
const forbiddenCharactersInDirPath = ['<', '>', ':', '\"', '/', '\\', '|', '?', '*'];
  
const maxLengthForDirName = 80; 

const versionComparator = (ver1, ver2) => {
  // return 1 if ver1 >= ver2, else return -1 
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
  playwrightBrowsersPath,
  getPathVariable,
  scanResultsPath,
  updateBackupsFolder,
  resultsPath,
  userDataFilePath,
  browserTypes,
  getDefaultChromeDataDir,
  getDefaultEdgeDataDir,
  deleteClonedProfiles,
  createPlaywrightContext,
  proxy,
  artifactInstallerPath,
  frontendReleaseUrl,
  installerExePath,
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
};
