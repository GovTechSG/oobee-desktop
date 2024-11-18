const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('services', {
  getVersionInfo: (callback) => {
    ipcRenderer.on('versionInfo', (event, data) => {
      callback(data)
    })
  },
  getIsProxy: (callback) => {
    ipcRenderer.on('isProxy', (event, data) => {
      callback(data)
    })
  },
  restartApp: () => {
    ipcRenderer.send('restartApp')
  },
  checkChromeExistsOnMac: async () => {
    const chromeExists = await ipcRenderer.invoke('checkChromeExistsOnMac')
    return chromeExists
  },
  validateUrlConnectivity: async (scanDetails) => {
    const results = await ipcRenderer.invoke(
      'validateUrlConnectivity',
      scanDetails
    )
    return results
  },
  startScan: async (scanDetails) => {
    const results = await ipcRenderer.invoke('startScan', scanDetails)
    return results
  },
  abortScan: async () => {
    await ipcRenderer.invoke('abortScan')
  },

  generateReport: (customFormLabel, scanId) => {
    ipcRenderer.send('generateReport', customFormLabel, scanId)
  },
  openReport: (scanId) => {
    ipcRenderer.send('openReport', scanId)
  },
  openResultsFolder: (resultsPath) => {
    ipcRenderer.send('openResultsFolder', resultsPath)
  },
  openUploadFolder: () => {
    ipcRenderer.send('openUploadFolder')
  },
  getEngineVersion: async () => {
    const phEngineVersion = await ipcRenderer.invoke('getEngineVersion')
    return phEngineVersion
  },
  getResultsFolderPath: async (scanId) => {
    const reportPath = await ipcRenderer.invoke('getResultsFolderPath', scanId)
    return reportPath
  },
  getUploadFolderPath: async () => {
    const uploadFolderPath = await ipcRenderer.invoke('getUploadFolderPath')
    return uploadFolderPath
  },
  setExportDir: async () => {
    const exportDir = await ipcRenderer.invoke('setExportDir')
    return exportDir
  },
  getUserData: async () => {
    const data = await ipcRenderer.invoke('getUserData')
    return data
  },
  getErrorLog: async (timeOfScan, timeOfError) => {
    const errorLog = await ipcRenderer.invoke(
      'getErrorLog',
      timeOfScan,
      timeOfError
    )
    return errorLog
  },
  editUserData: async (userData) => {
    ipcRenderer.send('editUserData', userData)
  },
  guiReady: async () => {
    ipcRenderer.send('guiReady')
  },
  appStatus: (callback) => {
    ipcRenderer.on('appStatus', (event, data) => {
      callback(data)
    })
  },
  launchStatus: (callback) => {
    ipcRenderer.on('launchStatus', (event, data) => {
      callback(data)
    })
  },
  scanningUrl: (callback) => {
    ipcRenderer.on('scanningUrl', (event, data) => {
      callback(data)
    })
  },
  scanningCompleted: (callback) => {
    ipcRenderer.on('scanningCompleted', () => {
      callback()
    })
  },
  killScan: (callback) => {
    ipcRenderer.on('killScan', () => {
      callback()
    })
  },
  userDataExists: (callback) => {
    ipcRenderer.on('userDataExists', (event, data) => {
      callback(data)
    })
  },
  proceedUpdate: (response) => {
    ipcRenderer.send('proceedUpdate', response)
  },
  launchInstaller: (response) => {
    ipcRenderer.send('launchInstaller', response)
  },
  restartAppAfterMacOSFrontendUpdate: (response) => {
    ipcRenderer.send('restartAppAfterMacOSFrontendUpdate', response)
  },
  setUserData: (data) => {
    ipcRenderer.send('userDataReceived', data)
  },
  enableReportDownload: (callback) => {
    ipcRenderer.on('enableReportDownload', () => callback())
  },
  openLink: (url) => {
    ipcRenderer.send('openLink', url)
  },
  mailReport: async (formDetails, scanId) => {
    const response = await ipcRenderer.invoke('mailReport', formDetails, scanId)
    return response
  },
  selectFile: async (options) => {
    const filePath = await ipcRenderer.invoke('selectFile', options)
    return filePath
  },
  getIsWindows: async () => ipcRenderer.invoke('isWindows'),
})
