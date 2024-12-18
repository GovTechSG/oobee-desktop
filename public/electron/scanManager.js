const { BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { fork, spawn } = require('child_process')
const fs = require('fs-extra')
const os = require('os')
const {
  randomBytes,
  randomUUID,
  createCipheriv,
  createDecipheriv,
} = require('crypto')
const {
  enginePath,
  appPath,
  getPathVariable,
  playwrightBrowsersPath,
  resultsPath,
  scanResultsPath,
} = require('./constants')
const {
  browserTypes,
  getDefaultChromeDataDir,
  getDefaultEdgeDataDir,
  uploadFolderName,
} = require('./constants')
const { readUserDataFromFile, createExportDir } = require('./userDataManager')
const scanHistory = {}

let currentChildProcess
let killChildProcessSignal = false

let setKillChildProcessSignal = () => {
  killChildProcessSignal = true
}

const killChildProcess = () => {
  if (currentChildProcess) {
    currentChildProcess.kill('SIGKILL')
  }
}

const getScanOptions = (details) => {
  const {
    scanType,
    fileTypes,
    url,
    customDevice,
    viewportWidth,
    maxPages,
    headlessMode,
    browser,
    email,
    name,
    exportDir,
    maxConcurrency,
    includeScreenshots,
    includeSubdomains,
    followRobots,
    metadata,
  } = details
  const options = [
    '-c',
    scanType,
    '-u',
    url,
    '-k',
    `${name}:${email}`,
    '-i',
    fileTypes,
  ]

  if (!includeScreenshots) {
    options.push('-a')
    options.push('none')
  }

  if (!includeSubdomains && scanType === 'website') {
    options.push('-s')
    options.push('same-hostname')
  }

  if (customDevice) {
    options.push('-d', customDevice)
  }

  if (viewportWidth) {
    options.push('-w', viewportWidth)
  }

  if (maxPages) {
    options.push('-p', maxPages)
  }

  if (!headlessMode) {
    options.push('-h', 'no')
  }

  if (browser) {
    options.push('-b', browser)
  }

  if (exportDir) {
    options.push('-e', exportDir)
  }

  if (maxConcurrency) {
    options.push('-t', 1)
  }

  if (followRobots) {
    options.push('-r', 'yes')
  }

  if (metadata) {
    options.push('-q', metadata)
  }

  // TODO add flag for enabling custom checks
  // if (customChecks) {
  //   options.push()
  // }

  // TODO add flag for enabling wcag AAA checks
  // if (wcagAaa) {
  //   options.push()
  // }

  return options
}

const validateUrlConnectivity = async (scanDetails) => {
  console.log('Validating URL...')

  const userData = readUserDataFromFile()
  if (userData) {
    scanDetails.email = userData.email
    scanDetails.name = userData.name
    scanDetails.exportDir = userData.exportDir
    const success = createExportDir(userData.exportDir)
    if (!success) return { failedToCreateExportDir: true }
  }

  const response = await new Promise(async (resolve) => {
    const check = spawn(
      'node',
      [
        `--max-old-space-size=6144`,
        `${enginePath}/dist/cli.js`,
        ...getScanOptions(scanDetails),
      ],
      {
        cwd: resultsPath,
        env: {
          ...process.env,
          VALIDATE_URL_PH_GUI: true,
          PLAYWRIGHT_BROWSERS_PATH: `${playwrightBrowsersPath}`,
          PATH: getPathVariable(),
        },
      }
    )

    currentChildProcess = check

    check.stderr.setEncoding('utf8')
    check.stderr.on('data', function (data) {
      console.log('stderr: ' + data)
    })

    check.stdout.setEncoding('utf8')
    check.stdout.on('data', async (data) => {
      if (data.includes('Url is valid')) {
        resolve({ success: true })
      }
    })

    check.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, statusCode: code })
      }
      currentChildProcess = null
    })
  })

  return response
}

const startScan = async (scanDetails, scanEvent) => {
  const userData = readUserDataFromFile()

  if (userData) {
    scanDetails.email = userData.email
    scanDetails.name = userData.name
    scanDetails.exportDir = userData.exportDir
    const success = createExportDir(userData.exportDir)
    if (!success) return { failedToCreateExportDir: true }
  }

  let useChromium = false
  if (
    scanDetails.browser === browserTypes.chromium ||
    (!getDefaultChromeDataDir() && !getDefaultEdgeDataDir())
  ) {
    useChromium = true
  }

  const response = await new Promise(async (resolve) => {
    let intermediateFolderName
    const scan = spawn(
      'node',
      [`${enginePath}/dist/cli.js`, ...getScanOptions(scanDetails)],
      {
        cwd: resultsPath,
        env: {
          ...process.env,
          RUNNING_FROM_PH_GUI: true,
          PLAYWRIGHT_BROWSERS_PATH: `${playwrightBrowsersPath}`,
          PATH: getPathVariable(),
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      }
    )

    scan.on('message', (message) => {
      let parsedMessage = JSON.parse(message)
      let messageFromBackend = parsedMessage.payload

      if (parsedMessage.type === 'randomToken') {
        intermediateFolderName = messageFromBackend
      }
    })

    currentChildProcess = scan

    scan.stderr.setEncoding('utf8')
    scan.stderr.on('data', function (data) {
      console.log('stderr: ' + data)
    })

    scan.stdout.setEncoding('utf8')
    scan.stdout.on('data', async (data) => {
      if (killChildProcessSignal) {
        scan.kill('SIGKILL')
        currentChildProcess = null
        killChildProcessSignal = false
        if (intermediateFolderName) {
          await cleanUpIntermediateFolders(intermediateFolderName)
        }
        resolve({ cancelled: true })
        scanEvent.emit('killScan')
        return
      }
      /** Code 0 handled indirectly here (i.e. successful process run),
      as unable to get stdout on close event after changing to spawn from fork */

      // Output from combine.js which prints the string "No pages were scanned" if crawled URL <= 0
      // consider this as successful that the process ran,
      // but failure in the sense that no pages were scanned so that we can display a message to the user
      if (data.includes('No pages were scanned')) {
        scan.kill('SIGKILL')
        currentChildProcess = null
        resolve({ success: false })
      }

      // The true success where the process ran and pages were scanned
      if (data.includes('Results directory is at')) {
        console.log(data)
        const resultsPath = data
          .split('Results directory is at ')[1]
          .split('/')
          .pop()
          .split(' ')[0]
        const scanId = randomUUID()
        scanHistory[scanId] = resultsPath

        // Do not add scan kill here as it will kill clean up processes
        // scan.kill("SIGKILL");
        currentChildProcess = null
        await cleanUpIntermediateFolders(resultsPath)
        resolve({ success: true, scanId })
      }

      // Handle live crawling output
      if (data.includes('crawling::')) {
        const urlScannedNum = parseInt(data.split('::')[1].trim())
        const status = data.split('::')[2].trim()
        const url = data.split('::')[3].trim()
        console.log(urlScannedNum, ': ', status, ': ', url)
        scanEvent.emit('scanningUrl', { status, url, urlScannedNum })
      }

      if (data.includes('Starting scan')) {
        console.log(data)
      }

      if (data.includes('Scan completed')) {
        console.log(data)
        scanEvent.emit('scanningCompleted')
      }
    })

    // Only handles error code closes (i.e. code > 0)
    // as successful resolves are handled above
    scan.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, statusCode: code })
      }
      currentChildProcess = null
    })
  })

  return response
}

const encryptGeneratedScript = (generatedScript) => {
  // Generate random password and IV
  const password = randomBytes(32)
  const iv = randomBytes(16)

  const data = fs.readFileSync(generatedScript).toString()
  const cipher = createCipheriv('aes-256-cfb', password, iv)
  let encrypted = cipher.update(data, 'utf-8', 'hex')
  encrypted += cipher.final('hex')
  fs.writeFileSync(generatedScript, encrypted)

  const encryptionParams = {
    password: password.toString('base64'),
    iv: iv.toString('base64'),
  }

  return encryptionParams
}

const decryptGeneratedScript = (generatedScript, encryptionParams) => {
  const passwordBuffer = Buffer.from(encryptionParams.password, 'base64')
  const ivBuffer = Buffer.from(encryptionParams.iv, 'base64')

  const data = fs.readFileSync(generatedScript).toString()
  const decipher = createDecipheriv('aes-256-cfb', passwordBuffer, ivBuffer)
  let decrypted = decipher.update(data, 'hex', 'utf-8')
  decrypted += decipher.final('utf8')
  fs.writeFileSync(generatedScript, decrypted)
}

const injectLabelIntoFolderName = (customFlowLabel, scanId) => {
  const currentFolderNameList = scanHistory[scanId].split('_')
  const currentResultsFolderPath = getResultsFolderPath(scanId)
  const newFolderNameList = [
    ...currentFolderNameList.slice(0, 2),
    customFlowLabel,
    ...currentFolderNameList.slice(2),
  ]
  const newFolderName = newFolderNameList.toString().replaceAll(',', '_')
  scanHistory[scanId] = newFolderName
  const newResultsFolderPath = getResultsFolderPath(scanId)
  fs.renameSync(currentResultsFolderPath, newResultsFolderPath)
}
const escapeHTMLEntitiesInLabel = (customFlowLabel) => {
  return customFlowLabel.replaceAll(/&/g, '&amp;')
}
const generateReport = (customFlowLabel, scanId) => {
  injectLabelIntoFolderName(customFlowLabel, scanId)
  const reportPath = getReportPath(scanId)
  const escapedCustomFlowLabel = escapeHTMLEntitiesInLabel(customFlowLabel)

  // edit custom flow label in the base 64 encoded scanData in report
  const data = fs.readFileSync(reportPath, { encoding: 'utf-8' })
  const scanDataEncoded = data.match(
    /scanData\s*=\s*base64DecodeChunkedWithDecoder\('([^']+)'\)/
  )[1]
  const scanDataDecodedJson = base64Decode(scanDataEncoded)
  scanDataDecodedJson.customFlowLabel = escapedCustomFlowLabel
  const scanDataEncodedWithNewLabel = base64Encode(scanDataDecodedJson)
  const result = data.replaceAll(scanDataEncoded, scanDataEncodedWithNewLabel) // find the encoded part, decode it and change the label then put back
  fs.writeFileSync(reportPath, result, { encoding: 'utf-8' })
}

const base64Decode = (data) => {
  // Remove invalid base64 characters
  const dataWithValidBase64Char = data.replace(/[^A-Za-z0-9+/=]/g, '')
  const compressedBytes = Uint8Array.from(atob(dataWithValidBase64Char), (c) =>
    c.charCodeAt(0)
  )
  const jsonString = new TextDecoder().decode(compressedBytes)
  return JSON.parse(jsonString)
}

const base64Encode = (data) => {
  try {
    return Buffer.from(JSON.stringify(data)).toString('base64')
  } catch (error) {
    console.error('Error encoding data to base64:', error)
    throw error
  }
}

const getReportPath = (scanId) => {
  const resultsFolderPath = getResultsFolderPath(scanId)
  if (scanHistory[scanId]) {
    return path.join(resultsFolderPath, 'report.html')
  }
  return null
}

const getResultsFolderPath = (scanId) => {
  const exportDir = readUserDataFromFile().exportDir
  return path.join(exportDir, scanHistory[scanId])
}

const mailResults = async (formDetails, scanId) => {
  const reportPath = getReportPath(scanId)
  const { subject, emailAddresses } = formDetails

  const shellCommand = `
    if ((Split-Path -Path $pwd -Leaf) -eq "scripts") {
      cd ..
    }
    $attachmentCount = 0
    #Get an Outlook application object
    $wasOutlookOpened = $true
    try {
      $o = [System.Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
    } catch {
      # Outlook is not open, create a new instance
      $o = New-Object -ComObject Outlook.Application
      $wasOutlookOpened = $false
    }
    if ($null -eq $o) {
      throw "Unable to open outlook"
      exit
    }
    $mail = $o.CreateItem(0)
    $mail.subject = "${subject}"
    $mail.body = "Hi there,
    
Please see the attached accessibility scan results with Oobee (report.html).
You can download Oobee at the following link: https://go.gov.sg/oobee.

Feel free to reach us at accessibility@tech.gov.sg if you have any questions.

Thank you.
Accessibility Enabling Team"
    $mail.To = "${emailAddresses}"
    $mail.cc = "<accessibility@tech.gov.sg>"
    # # Iterate over all files and only add the ones that have an .html extension
    $files = Get-ChildItem '${reportPath}'
    for ($i = 0; $i -lt $files.Count; $i++) {
      $outfileName = $files[$i].FullName
      $outfileNameExtension = $files[$i].Extension
      if ($outfileNameExtension -eq ".html") {
          $mail.Attachments.Add($outfileName);
          $attachmentCount++
      }
    }
    if ($attachmentCount -eq 0) {
      throw "No files were found in the specified folder. Exiting."
      $o.Quit()
      exit
    }
    $mail.Send()
    # give time to send the email
    Start-Sleep -Seconds 5
    # quit Outlook only if previously not opened
    if ($wasOutlookOpened -eq $false) {
      $o.Quit()
    }
    #end the script
    exit
  `

  const response = await new Promise((resolve) => {
    const mailProcess = spawn('powershell.exe', [
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      shellCommand,
    ])

    mailProcess.stderr.on('data', (data) => {
      console.error(`stderr: ${data}`)
      resolve({
        success: false,
        message: `An error has occurred when sending the email: ${data}`,
      })
    })

    mailProcess.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true })
      } else {
        mailProcess.stderr.on('data', (data) => {
          console.error(`stderr: ${data}`)
          resolve({
            success: false,
            message: `An error has occurred when sending the email: ${data}`,
          })
        })
      }
    })
  })

  return response
}

const cleanUpIntermediateFolders = async (
  folderName,
  setDefaultFolders = false
) => {
  const pathToDelete = path.join(resultsPath, folderName)
  await fs.pathExists(pathToDelete).then((exists) => {
    if (exists) {
      fs.removeSync(pathToDelete)
    }
  })
}

const moveCustomFlowResultsToExportDir = (
  scanId,
  resultsFolderName,
  isReplay
) => {
  const currentResultsPath = path.join(scanResultsPath, resultsFolderName)
  let newResultsPath
  if (isReplay) {
    const [date, time] = new Date()
      .toLocaleString('sv')
      .replaceAll(/-|:/g, '')
      .split(' ')
    const domain = currentResultsPath.split('_').pop()
    const newResultsFolderName = `${date}_${time}_${domain}`
    scanHistory[scanId] = newResultsFolderName
    newResultsPath = getResultsFolderPath(scanId)
  } else {
    newResultsPath = getResultsFolderPath(scanId)
  }
  fs.move(currentResultsPath, newResultsPath, (err) => {
    if (err) return console.log(err)
  })
}

const init = (scanEvent) => {
  ipcMain.handle('validateUrlConnectivity', async (_event, scanDetails) => {
    return await validateUrlConnectivity(scanDetails)
  })

  ipcMain.handle('startScan', async (_event, scanDetails) => {
    return await startScan(scanDetails, scanEvent)
  })

  ipcMain.handle('abortScan', async (_event) => {
    setKillChildProcessSignal()
  })

  ipcMain.on('generateReport', (_event, customFlowLabel, scanId) => {
    return generateReport(customFlowLabel, scanId)
  })

  ipcMain.on('openReport', async (_event, scanId) => {
    const reportPath = getReportPath(scanId)
    if (!reportPath) return
    shell.openExternal(`file://${reportPath}`)
  })

  ipcMain.handle('getResultsFolderPath', async (_event, scanId) => {
    const resultsPath = getResultsFolderPath(scanId)
    return resultsPath
  })

  ipcMain.handle('getUploadFolderPath', async () => {
    const { exportDir } = readUserDataFromFile()
    const uploadFolderPath = path.join(exportDir, uploadFolderName)
    if (!fs.existsSync(uploadFolderPath)) {
      fs.mkdirSync(uploadFolderPath)
    }
    return uploadFolderPath
  })

  ipcMain.handle(
    'getErrorLog',
    async (event, timeOfScanString, timeOfError) => {
      const errorLogPath = path.join(appPath, 'errors.txt')
      const errorLog = fs.readFileSync(errorLogPath, 'utf-8')
      const regex = /{.*?}/gs
      const entries = errorLog.match(regex)
      let allErrors = ''

      const exists = fs.existsSync(errorLogPath)
      if (!exists) {
        allErrors = 'Log file (errors.txt) does not exist'
        console.log(!exists)
        return allErrors
      }

      try {
        fs.accessSync(errorLogPath, fs.constants.R_OK)
      } catch (err) {
        console.error('No Read access', errorLogPath)
        allErrors = 'Log file (errors.txt) cannot be read'
        return allErrors
      }

      if (entries == null) {
        allErrors = 'Log file (errors.txt) is empty'
      } else {
        for (const entry of entries) {
          const jsonEntry = JSON.parse(entry)
          const timeOfEntry = new Date(jsonEntry['timestamp']).getTime()
          const timeOfScan = new Date(timeOfScanString)
          if (
            timeOfEntry >= timeOfScan.getTime() &&
            timeOfEntry <= timeOfError.getTime()
          ) {
            allErrors = allErrors.concat(entry, '\n')
          }
        }
        if (allErrors === '') {
          allErrors = 'Log file (errors.txt) has no new entries after scan'
        }
      }

      return allErrors
    }
  )

  ipcMain.handle('mailReport', (_event, formDetails, scanId) => {
    return mailResults(formDetails, scanId)
  })
}

module.exports = {
  init,
  killChildProcess,
}
