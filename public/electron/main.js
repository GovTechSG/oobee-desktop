const {
  app: electronApp,
  BrowserWindow,
  ipcMain,
  shell,
  session,
  dialog,
} = require('electron')
const { getDefaultChromeDataDir } = require('./constants')
const os = require('os')
const axios = require('axios')
const https = require('https')
const EventEmitter = require('events')
const constants = require('./constants')
const scanManager = require('./scanManager')
const updateManager = require('./updateManager')
const userDataManager = require('./userDataManager.js')
const showdown = require('showdown')
const fs = require('fs')
const path = require('path')

const app = electronApp

let launchWindow
let mainWindow

function createLaunchWindow() {
  launchWindow = new BrowserWindow({
    width: 430,
    height: 400,
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

  const { data: releaseInfo } = await axiosInstance
    .get('https://govtechsg.github.io/oobee-desktop/latest-release.json')
    .catch((e) => {
      console.log('Unable to get release info')
      return { data: undefined }
    })

  const {
    latestRelease,
    latestPreRelease,
    latestReleaseNotes,
    latestPreReleaseNotes,
    allReleaseTags,
    allPreReleaseTags,
  } = releaseInfo ? releaseInfo : {}

  // create settings file if it does not exist
  await userDataManager.init()

  if (constants.proxy === null) {
    const launchWindowReady = new Promise((resolve) => {
      ipcMain.once('guiReady', () => {
        resolve()
      })
    })

    createLaunchWindow()
    await launchWindowReady
    launchWindow.webContents.send('appStatus', 'launch')

    // this is used for listening to messages that updateManager sends
    const updateEvent = new EventEmitter()

    updateEvent.on('settingUp', () => {
      launchWindow.webContents.send('launchStatus', 'settingUp')
    })

    updateEvent.on('checking', () => {
      launchWindow.webContents.send('launchStatus', 'checkingUpdates')
    })

    updateEvent.on('promptFrontendUpdate', (userResponse) => {
      launchWindow.webContents.send('launchStatus', 'promptFrontendUpdate')
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

    // Check and launch Oobee
    updateEvent.on('restartA11yToOobee', () => {
      const oobeePath =
        process.platform === 'win32'
          ? 'C:\\Program Files\\Oobee Desktop\\Oobee Frontend\\Oobee.exe'
          : path.join(
              path.dirname(app.getPath('exe')),
              '..',
              '..',
              '..',
              'Oobee.app'
            )

      const currentAppPath = app.getPath('exe')

      if (fs.existsSync(oobeePath) && !currentAppPath.includes('Oobee')) {
        const { exec } = require('child_process')
        const openCommand =
          process.platform === 'win32'
            ? `start "" "${oobeePath}"`
            : `open "${oobeePath}"`

        exec(openCommand, (error) => {
          if (error) {
            console.error(
              `Failed to open ${path.basename(oobeePath)}: ${error}`
            )
          }
          // Works for Mac
          app.exit()
        })

        // Works for Windows
        app.exit()
      } else {
        // do nothing
      }
    })

    updateEvent.on('restartTriggered', () => {
      app.relaunch()
      app.exit()
    })

    updateEvent.on('frontendDownloadFailed', () => {
      launchWindow.webContents.send('launchStatus', 'frontendDownloadFailed')
    })

    await updateManager.run(updateEvent, latestRelease, latestPreRelease)

    launchWindow.close()
  }

  const mainReady = new Promise((resolve) => {
    ipcMain.once('guiReady', () => {
      resolve()
    })
  })

  createMainWindow()

  const scanEvent = new EventEmitter()
  scanManager.init(scanEvent)
  scanEvent.on('scanningUrl', (url) => {
    mainWindow.webContents.send('scanningUrl', url)
  })
  scanEvent.on('scanningCompleted', () => {
    mainWindow.webContents.send('scanningCompleted')
  })
  scanEvent.on('killScan', () => {
    mainWindow.webContents.send('killScan')
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
      return getDefaultChromeDataDir()
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

  await mainReady

  mainWindow.webContents.send('appStatus', 'ready')

  const markdownToHTML = (converter, md) => {
    const escaped = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    return converter.makeHtml(escaped)
  }

  if (releaseInfo) {
    let newestVer = latestPreRelease
    let newestNotes = latestPreReleaseNotes

    // handle case where release > prerelease version
    if (constants.versionComparator(latestRelease, latestPreRelease) === 1) {
      newestVer = latestRelease
      newestNotes = latestReleaseNotes
    }

    const markdownConverter = new showdown.Converter()
    const newestFormattedNotes = markdownToHTML(markdownConverter, newestNotes)
    const latestRelNotes = markdownToHTML(markdownConverter, latestReleaseNotes)

    mainWindow.webContents.send('versionInfo', {
      appVersion: constants.appVersion,
      latestVer: latestRelease,
      latestVerForLab: newestVer,
      latestNotesForLab: newestFormattedNotes,
      latestRelNotes,
      allReleaseTags,
      allPreReleaseTags,
    })
  } else {
    mainWindow.webContents.send('versionInfo', {
      appVersion: constants.appVersion,
    })
  }

  mainWindow.webContents.send('isProxy', constants.proxy)

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

  if (constants.proxy) {
    session.defaultSession.enableNetworkEmulation({
      offline: true,
    })
  }
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
  updateManager.killChildProcess()
  scanManager.killChildProcess()
})
