/**
 * Suppresses the "Setting the NODE_TLS_REJECT_UNAUTHORIZED 
 * environment variable to '0' is insecure" warning,
 * then disables TLS validation globally.
 */
function suppressTlsRejectWarning() {
  // Monkey-patch process.emitWarning
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const msg = typeof warning === 'string' ? warning : warning.message;
    if (msg.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
      // swallow only that one warning
      return;
    }
    // forward everything else
    originalEmitWarning.call(process, warning, ...args);
  };

  // Now turn off cert validation
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}
// Allow Sentry to send data on proxied environments
suppressTlsRejectWarning();

const {
  app: electronApp,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  dialog,
  powerMonitor,
} = require('electron')
const Sentry = require('@sentry/electron/main')
const os = require('os')
const axios = require('axios')
const https = require('https')
const EventEmitter = require('events')
const constants = require('./constants')
const scanManager = require('./scanManager')
const updateManager = require('./updateManager')
const userDataManager = require('./userDataManager.js')
const { consoleLogger } = require('./logs')
const { marked } = require('marked')
marked.use({
  renderer: {
    heading({tokens, depth}) {
      const text = this.parser.parseInline(tokens);
      const rawText = tokens.map(t => t.raw || t.text || '').join('');
      const slug = rawText.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s]+/g, '-');
      return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
    }
  }
})
const fs = require('fs')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')

// Runs a command and captures status/stdout/stderr without throwing on
// non-zero exit — needed because `dseditgroup -o checkmember` legitimately
// exits non-zero to signal "not a member".
function captureCmd(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' })
  return {
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  }
}

const app = electronApp

app.commandLine.appendSwitch('ignore-certificate-errors');

// Initialize Sentry
Sentry.init({
  dsn: "https://a70a82e8152c23392841b1118c4ede73@o4509047624761344.ingest.us.sentry.io/4509286545948673",
  // Enable performance monitoring
  tracesSampleRate: 1.0,
  // Enable session tracking
  autoSessionTracking: true,
  // Set environment
  environment: process.env.NODE_ENV || 'production'
});

let launchWindow
let mainWindow

// We can't rely on an fs write probe from this process for the admin-group
// question, because Electron's kauth credentials are snapshotted at launch —
// Admin By Request's JIT admin grant doesn't propagate into an already-running
// process, so the probe keeps failing even after the user has been elevated.
// Query DirectoryService via three complementary tools and treat the user as
// elevated if any of them reports admin-group membership — different ABR
// configurations reflect the grant through different lookup paths.
function isCurrentUserInAdminGroup() {
  const username = os.userInfo().username
  const dseditgroup = captureCmd('/usr/sbin/dseditgroup', ['-o', 'checkmember', '-m', username, 'admin'])
  const idGn = captureCmd('/usr/bin/id', ['-Gn', username])
  const dscl = captureCmd('/usr/bin/dscl', ['.', '-read', '/Groups/admin', 'GroupMembership'])

  // dseditgroup always prints "yes X is a member" / "no X is NOT a member" on
  // stdout regardless of exit code, so parse stdout for portability.
  const dseditgroupSaysMember = /^yes\b/i.test(dseditgroup.stdout)
  const idGnSaysMember = idGn.stdout.split(/\s+/).includes('admin')
  const dsclSaysMember = new RegExp(`\\b${username}\\b`).test(dscl.stdout)

  return dseditgroupSaysMember || idGnSaysMember || dsclSaysMember
}

// POSIX write permission on the .app bundle and its parent directory is
// resolved from filesystem ownership/ACLs, not from the process's cached
// group credentials, so an fs write probe IS reliable for this question
// (unlike the admin-group question above). If both are writable, the
// unprivileged install path in updateManager will succeed without any
// admin prompt — regardless of whether the user is in the admin group.
function isAppBundleWritable() {
  try {
    const bundlePath = constants.macOSExecutablePath
    if (!bundlePath) return false
    const parentDir = path.join(bundlePath, '..')
    fs.accessSync(parentDir, fs.constants.W_OK)
    fs.accessSync(bundlePath, fs.constants.W_OK)
    return true
  } catch (e) {
    return false
  }
}

function computeNeedsElevation() {
  if (process.platform !== 'darwin') return false
  // If the install location is user-writable (e.g. ~/Applications or any
  // non-/Applications path the user owns), no admin rights are needed to
  // replace the bundle — skip the ABR check entirely.
  if (isAppBundleWritable()) return false
  return !isCurrentUserInAdminGroup()
}

function createLaunchWindow() {
  launchWindow = new BrowserWindow({
    width: 480,
    height: 480,
    frame: false,
    webPreferences: {
      preload: constants.preloadPath,
    },
  })

  launchWindow.loadFile(constants.indexPath)
}

function createMainWindow() {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 870,
    webPreferences: {
      preload: constants.preloadPath,
    },
  })
  // and load the index.html of the app.
  mainWindow.loadFile(constants.indexPath)
  // mainWindow.loadURL(`http://localhost:3000`)
}

// TODO set ipcMain messages
app.on('ready', async () => {
  // Get user data to check if email exists
  const userData = await userDataManager.readUserDataFromFile();
  
  // Set user context in Sentry with userId
  Sentry.setUser({
    id: userData.userId,
    email: userData.email || undefined,
    hasEmail: !!userData.email
  });

  // Track app launch event
  Sentry.captureMessage('App Launched', {
    level: 'info',
    tags: {
      hasEmail: !!userData.email,
      os: os.platform(),
      version: constants.appVersion,
      userId: userData.userId
    }
  });

  const axiosInstance = axios.create({
    timeout: 5000,
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
      headers: {
        // 'X-Forwarded-For': 'xxx',
        'User-Agent': 'axios',
      },
    }),
  })

  // Bootstrap URL for the release catalog. The catalog itself carries a
  // `releaseInfo` field pointing to its own canonical URL; if that differs from
  // the bootstrap URL, we re-fetch from the new location. This lets us migrate
  // the release-catalog host by updating just the JSON at the old URL, without
  // shipping a new client build.
  const BOOTSTRAP_RELEASE_INFO_URL =
    'https://govtechsg.github.io/oobee-desktop/latest-release.json'

  // Reject anything that isn't a plain JSON object. If the server returns
  // malformed JSON, axios can hand back the raw string as `r.data` (truthy)
  // — treating that as a valid catalog led to `versionComparator(undefined, undefined)`
  // crashing the app. Bad-shape catalogs are logged and treated as "no catalog",
  // so the app still launches; the updater just skips this run.
  const isValidReleaseCatalog = (data) =>
    data !== null && typeof data === 'object' && !Array.isArray(data)

  const fetchReleaseData = (url) =>
    axiosInstance
      .get(url)
      .then((r) => {
        if (!isValidReleaseCatalog(r.data)) {
          console.log(`Release catalog at ${url} is not a JSON object; skipping updates`)
          return undefined
        }
        return r.data
      })
      .catch((e) => {
        console.log(`Unable to get release info from ${url}: ${e && e.message ? e.message : e}`)
        return undefined
      })

  let releaseInfo = await fetchReleaseData(BOOTSTRAP_RELEASE_INFO_URL)
  // Announcements are authored at the bootstrap location (docs branch of the
  // current repo) — capture the value here BEFORE we potentially overwrite
  // releaseInfo with the redirected catalog, which may live in a different
  // repo and shouldn't get to control what shows in the announcement modal.
  const bootstrapAnnouncement =
    releaseInfo && typeof releaseInfo.alwaysShowAnnouncement === 'string'
      ? releaseInfo.alwaysShowAnnouncement
      : ''
  if (
    releaseInfo &&
    releaseInfo.releaseInfo &&
    releaseInfo.releaseInfo !== BOOTSTRAP_RELEASE_INFO_URL
  ) {
    const redirected = await fetchReleaseData(releaseInfo.releaseInfo)
    if (redirected) releaseInfo = redirected
  }

  const {
    latestRelease,
    latestPreRelease,
    latestReleaseNotes,
    latestPreReleaseNotes,
    allReleaseTags,
    allPreReleaseTags,
    baseUrl,
    macAppName,
    macZipName,
    windowsZipName,
    windowsInstallerName,
    // Note: `alwaysShowAnnouncement` is NOT destructured here — it's sourced
    // from `bootstrapAnnouncement` above so a redirected release catalog in
    // another repo can't override the current repo's announcement.
  } = releaseInfo ? releaseInfo : {}

  // create settings file if it does not exist
  await userDataManager.init()

  const launchWindowReady = new Promise((resolve) => {
    ipcMain.once('guiReady', () => {
      resolve()
    })
  })

  createLaunchWindow()
  await launchWindowReady
  launchWindow.webContents.send('appStatus', 'launch')

  // Register the elevation-check IPC handler BEFORE updateManager.run so that
  // the renderer's polling loop (which starts as soon as the "Update available"
  // screen renders) can reach it. updateManager.run awaits the user's Update /
  // Later response, so any handler registered after it does not exist for the
  // duration of the prompt — every invoke() rejects, and the setInterval
  // callback swallows the rejection silently.
  ipcMain.handle('checkNeedsElevation', () => computeNeedsElevation())

  // this is used for listening to messages that updateManager sends
  const updateEvent = new EventEmitter()

  updateEvent.on('settingUp', () => {
    launchWindow.webContents.send('launchStatus', 'settingUp')
  })

  updateEvent.on('checking', () => {
    launchWindow.webContents.send('launchStatus', 'checkingUpdates')
  })

  updateEvent.on('promptFrontendUpdate', (userResponse, versionInfo) => {
    launchWindow.webContents.send('launchStatus', {
      status: 'promptFrontendUpdate',
      ...versionInfo,
      adminByRequestPresent: computeNeedsElevation(),
    })
    ipcMain.once('proceedUpdate', (_event, response) => {
      userResponse(response)
    })
  })

  updateEvent.on('promptBackendUpdate', (userResponse) => {
    launchWindow.webContents.send('launchStatus', 'promptBackendUpdate')
    ipcMain.once('proceedUpdate', (_event, response) => {
      userResponse(response)
    })
  })

  updateEvent.on('updatingFrontend', () => {
    launchWindow.webContents.send('launchStatus', 'updatingFrontend')
  })

  updateEvent.on('updatingBackend', () => {
    launchWindow.webContents.send('launchStatus', 'updatingBackend')
  })

  updateEvent.on('frontendDownloadComplete', (userResponse) => {
    launchWindow.webContents.send('launchStatus', 'frontendDownloadComplete')
    ipcMain.once('launchInstaller', (_event, response) => {
      userResponse(response)
    })
  })

  updateEvent.on('frontendDownloadCompleteMacOS', (userResponse) => {
    launchWindow.webContents.send(
      'launchStatus',
      'frontendDownloadCompleteMacOS'
    )
    ipcMain.once('restartAppAfterMacOSFrontendUpdate', (_event, response) => {
      userResponse(response)
    })
  })

  updateEvent.on('installerLaunched', () => {
    app.exit()
  })

  updateEvent.on('restartTriggered', (newAppPath) => {
    // Explicitly specify the path to relaunch to ensure we launch the NEW updated app.
    // This is critical when the app is installed in non-standard locations like Downloads,
    // and also when a release renames the .app bundle — `newAppPath` reflects the newly
    // extracted bundle (from `macAppName` in latest-release.json), which may differ from
    // the currently-running `macOSExecutablePath`.
    const execPath = newAppPath || constants.macOSExecutablePath;
    consoleLogger.info(`Relaunching app from: ${execPath}`);
    
    // Use macOS 'open' command to relaunch the .app bundle
    // This is more reliable than app.relaunch() after the binary has been replaced
    const { spawn } = require('child_process');
    spawn('open', ['-n', execPath], {
      detached: true,
      stdio: 'ignore'
    }).unref();
    
    // Give the spawn command time to execute before exiting
    setTimeout(() => {
      app.exit();
    }, 500);
  })

  updateEvent.on('frontendDownloadFailed', () => {
    launchWindow.webContents.send('launchStatus', 'frontendDownloadFailed')
  })

  await updateManager.run(updateEvent, latestRelease, latestPreRelease, {
    baseUrl,
    macAppName,
    macZipName,
    windowsZipName,
    windowsInstallerName,
  })

  if (launchWindow && !launchWindow.isDestroyed()) {
    launchWindow.close();
  }

  const mainReady = new Promise((resolve) => {
    ipcMain.once('guiReady', () => {
      resolve()
    })
  })

  createMainWindow()

  mainWindow.webContents.on('render-process-gone', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload()
    }
  })

  powerMonitor.on('unlock-screen', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.invalidate()
    }
  })

  powerMonitor.on('resume', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.invalidate()
    }
  })

  const scanEvent = new EventEmitter()
  scanManager.init(scanEvent)
  scanEvent.on('scanningUrl', (url) => {
    mainWindow.webContents.send('scanningUrl', url)
  })
  scanEvent.on('scanningCompleted', () => {
    Sentry.captureMessage('Accessibility Scan Completed', {
      level: 'info',
      tags: {
        os: os.platform(),
        version: constants.appVersion,
      }
    });
  
    mainWindow.webContents.send('scanningCompleted')
  })
  
  scanEvent.on('generatingReport', () => {
    mainWindow.webContents.send('generatingReport')
  })

  scanEvent.on('scanStarted', () => {
    mainWindow.webContents.send('scanStarted')
  })

  scanEvent.on('killScan', () => {
    // Delay to ensure the renderer has re-mounted and registered its listener
    // after navigating back from the scanning page.
    setTimeout(() => {
      mainWindow.webContents.send('killScan')
    }, 500)
  })

  ipcMain.on('openLink', (_event, url) => {
    shell.openExternal(url)
  })

  ipcMain.handle('getEngineVersion', () => {
    return constants.getEngineVersion()
  })

  ipcMain.on('restartApp', (_event) => {
    app.relaunch()
    app.exit()
  })

  ipcMain.handle('checkChromeExistsOnMac', () => {
    if (os.platform() === 'darwin') {
      return constants.getDefaultChromeDataDir()
    } else {
      return true
    }
  })

  ipcMain.handle('isWindows', (_event) => constants.isWindows)

  ipcMain.handle('selectFile', async (event, options = {}) => {
    const result = await dialog.showOpenDialog(mainWindow, options)

    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0]
    } else {
      return null
    }
  })

  ipcMain.handle('getProxySettings', () => {
    return userDataManager.getProxySettings()
  })

  ipcMain.handle('setProxySettings', (_event, proxyValue) => {
    return userDataManager.setProxySettings(proxyValue)
  })

  ipcMain.handle('getIncludeProxy', () => {
    return userDataManager.getIncludeProxy()
  })

  ipcMain.handle('setIncludeProxy', (_event, includeProxyValue) => {
    return userDataManager.setIncludeProxy(includeProxyValue)
  })

  await mainReady

  mainWindow.webContents.send('appStatus', 'ready')

  const markdownToHTML = (md) => {
    if (typeof md !== 'string' || md.length === 0) return ''
    return marked.parse(md)
  }

  if (releaseInfo) {
    let newestVer = latestPreRelease
    let newestNotes = latestPreReleaseNotes

    // handle case where release > prerelease version
    if (constants.versionComparator(latestRelease, latestPreRelease) === 1) {
      newestVer = latestRelease
      newestNotes = latestReleaseNotes
    }

    const newestFormattedNotes = markdownToHTML(newestNotes)
    const latestRelNotes = markdownToHTML(latestReleaseNotes)
    // Optional announcement authored by the release team in latest-release.json.
    // Sourced from the bootstrap URL (not the redirected catalog) so control
    // stays with the current repo. markdownToHTML returns '' for missing/empty
    // input, so the renderer just checks truthiness to decide whether to show.
    const announcementHTML = markdownToHTML(bootstrapAnnouncement)

    mainWindow.webContents.send('versionInfo', {
      appVersion: constants.appVersion,
      latestVer: latestRelease,
      latestVerForLab: newestVer,
      latestNotesForLab: newestFormattedNotes,
      latestRelNotes,
      allReleaseTags,
      allPreReleaseTags,
      alwaysShowAnnouncement: announcementHTML,
      // baseUrl comes from the (possibly redirected) release catalog so the
      // renderer can build repo-specific links (e.g. "See previous versions")
      // without hardcoding the org/repo path.
      baseUrl,
    })
  } else {
    mainWindow.webContents.send('versionInfo', {
      appVersion: constants.appVersion,
    })
  }

  const userDataEvent = new EventEmitter()
  userDataEvent.on('userDataDoesNotExist', (setUserData) => {
    mainWindow.webContents.send('userDataExists', 'doesNotExist')
    ipcMain.once('userDataReceived', (_event, data) => {
      setUserData(data)
    })
  })
  userDataEvent.on('userDataDoesExist', () => {
    mainWindow.webContents.send('userDataExists', 'exists')
  })

  await userDataManager.setData(userDataEvent)

  // This may be still be required on some corporate env laptops, for posterity
  /*
  if (constants.proxy) {
    session.defaultSession.enableNetworkEmulation({
      offline: true,
    })
  }
  */
})

app.on('quit', () => {
  // /* Synchrnously removes file upon quitting the app. Restarts/Shutdowns in
  // Windows will not trigger this event */
  // if (fs.existsSync(constants.scanResultsPath)){
  //   fs.rmSync(constants.scanResultsPath, { recursive: true }, err => {
  //     if (err) {
  //       console.error(`Error while deleting ${constants.scanResultsPath}.`);
  //     }
  //   })
  // }
  // Get user data to check if email exists
  const userData = userDataManager.readUserDataFromFile();
  
  // Track app quit event
  Sentry.captureMessage('App Quit', {
    level: 'info',
    tags: {
      hasEmail: !!userData.email,
      os: os.platform(),
      version: constants.appVersion,
      userId: userData.userId
    }
  });

  updateManager.killChildProcess()
  scanManager.killChildProcess()
})
