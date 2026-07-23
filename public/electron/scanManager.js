const { BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
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
const { readUserDataFromFile, createExportDir, getProxySettings, getIncludeProxy } = require('./userDataManager')
const scanHistory = {}

let currentChildProcess
let killChildProcessSignal = false
let pendingCancelHandler = null

let setKillChildProcessSignal = () => {
  killChildProcessSignal = true
  if (pendingCancelHandler) {
    const handler = pendingCancelHandler
    pendingCancelHandler = null
    handler()
  }
}

const sanitizeLogPath = (rawPath) => {
  if (!rawPath) return ''

  return rawPath
    // Remove real ANSI escape sequences only (do not strip plain text tokens
    // like "[33m" that may legitimately appear in filenames).
    .replace(/\x1B\[[0-9;]*m/g, '')
    .trim()
}

const killChildProcess = () => {
  if (currentChildProcess) {
    const proc = currentChildProcess
    proc.kill('SIGTERM')
    setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
    }, 120000)
  }
}

const getMaxOldSpaceSize = () => {
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024))
  if (totalMemMb < 4096) {
    return Math.floor(totalMemMb * 1.5)
  }
  return Math.floor(totalMemMb * 0.75)
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
    customChecks,
    wcagAaa,
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

  // Add default exclusions.txt containing blacklisted URL patterns
  if (fs.existsSync(`${enginePath}/exclusions.txt`)) {
    options.push('-x', `${enginePath}/exclusions.txt`);
  }

  if (!includeScreenshots) {
    options.push('-a')
    options.push('none')
  }

  if (!includeSubdomains && (scanType === 'website' || scanType === 'intelligent')) {
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

  if (headlessMode !== undefined && headlessMode === false) {
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

  // Flag for customChecks and wcagAaa
  if (!customChecks && wcagAaa) {
    options.push('-y', 'disable-oobee,enable-wcag-aaa')
  } else if (!customChecks) {
    options.push('-y', 'disable-oobee')
  } else if (wcagAaa) {
    options.push('-y', 'enable-wcag-aaa')
  } else {
    // Default Case
    options.push('-y', 'default')
  }

  return options
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
    let resultsReceived = false
    let hasResolved = false
    let finalResultsFolderName = null
    let finalResultsAbsolutePath = null
    let hasStoragePathFromIpc = false
    let noPagesScannedDetected = false
    let httpResponseCode = null
    let stdoutRemainder = ''

    const resolveOnce = (result) => {
      if (hasResolved) return
      hasResolved = true
      pendingCancelHandler = null
      resolve(result)
    }

    const performCancel = async () => {
      const proc = currentChildProcess
      if (proc) {
        try { proc.kill('SIGINT') } catch {}
        setTimeout(() => {
          try { proc.kill('SIGKILL') } catch {}
        }, 10 * 60 * 1000)
      }
      currentChildProcess = null
      killChildProcessSignal = false
      if (intermediateFolderName) {
        try { await cleanUpIntermediateFolders(intermediateFolderName) } catch {}
      }
      resolveOnce({ cancelled: true })
      scanEvent.emit('killScan')
    }

    const hasGeneratedReportHtml = () => {
      if (finalResultsAbsolutePath) {
        const reportFilePathFromAbsolutePath = path.join(
          finalResultsAbsolutePath,
          'report.html'
        )
        if (fs.existsSync(reportFilePathFromAbsolutePath)) {
          return true
        }
      }

      if (finalResultsFolderName) {
        const userData = readUserDataFromFile() || {}
        const exportDir = userData.exportDir || scanDetails.exportDir
        if (exportDir) {
          const reportFilePath = path.join(
            exportDir,
            finalResultsFolderName,
            'report.html'
          )
          if (fs.existsSync(reportFilePath)) {
            return true
          }
        }
      }

      return false
    }

    const captureResultsPath = (possiblePath) => {
      if (!possiblePath) return
      const trimmedPath = sanitizeLogPath(possiblePath).replace(/["']/g, '')
      if (!trimmedPath) return
      finalResultsAbsolutePath = trimmedPath
      finalResultsFolderName = path.basename(trimmedPath)
    }

    const parseAndEmitCrawlingLines = (line) => {
      const crawlRegex = /crawling::(\d+)::([^:]+)::(.+)/g
      let crawlMatch
      while ((crawlMatch = crawlRegex.exec(line)) !== null) {
        const urlScannedNum = parseInt(crawlMatch[1].trim())
        const status = crawlMatch[2].trim()
        const url = crawlMatch[3].trim()
        console.log(urlScannedNum, ': ', status, ': ', '*'.repeat(url.length))
        scanEvent.emit('scanningUrl', { status, url, urlScannedNum })
      }
    }

    const processStdoutLine = async (line) => {
      const trimmedLine = line.trim()
      if (!trimmedLine) return

      if (trimmedLine.includes('No pages were scanned')) {
        // Decide no-pages outcome only when the process closes,
        // because long scans can emit chunked logs where this line is stale/noisy.
        noPagesScannedDetected = true
      }

      if (trimmedLine.includes('"level":"info","message":"PID: ')) {
        console.log(trimmedLine)
      }

      if (trimmedLine.includes('Connectivity Check HTTP Response Code:')) {
        const codeMatch = trimmedLine.match(/Connectivity Check HTTP Response Code:\s*(\d+)/)
        if (codeMatch) {
          httpResponseCode = parseInt(codeMatch[1])
        }
      }

      if (trimmedLine.includes('Logger writing to:')) {
        try {
          const logData = JSON.parse(trimmedLine)
          const message = logData.message
          const prefix = 'Logger writing to: '
          const index = message.indexOf(prefix)
          if (index !== -1) {
            process.env.OOBEE_ERROR_LOG_PATH = message
              .substring(index + prefix.length)
              .trim()
            console.log('Error log path set to:\n', process.env.OOBEE_ERROR_LOG_PATH)
          }
        } catch (error) {
          console.error('Failed to parse log data as JSON:', error)
        }
      }

      if (trimmedLine.includes('An error occured. Log file is located at:')) {
        const match = trimmedLine.match(
          /An error occured\. Log file is located at:\s*(\S+?\.txt)(?=\s|$)/
        )
        if (match && match[1]) {
          process.env.OOBEE_ERROR_LOG_PATH = match[1]
          console.log('Error log path changed to:\n', process.env.OOBEE_ERROR_LOG_PATH)
        }
        resolveOnce({ success: false })
        return
      }

      if (trimmedLine.includes('Results directory is at')) {
        // This line comes from printMessage() and may include ANSI/table decorations.
        // Prefer IPC storagePath when available; parse stdout only as fallback.
        if (!hasStoragePathFromIpc) {
          const match = trimmedLine.match(/Results directory is at\s+(.+)$/)
          if (match && match[1]) {
            captureResultsPath(match[1])
          }
        }

        if (finalResultsFolderName) {
          const scanId = randomUUID()
          scanHistory[scanId] = finalResultsFolderName
          currentChildProcess = null
          await cleanUpIntermediateFolders(finalResultsFolderName)
          resolveOnce({ success: true, scanId })
          scanEvent.emit('scanningCompleted')
          resultsReceived = true
        }
        return
      }

      if (trimmedLine.includes('Generating report artifacts')) {
        scanEvent.emit('generatingReport')
      }

      // Infer results path from artifact output lines even when final summary lines are split/missing.
      const artifactPathMatch = trimmedLine.match(
        /(Sitemap written to|JSON file written successfully:|File successfully compressed and saved to)\s+(.+)$/
      )
      if (artifactPathMatch && artifactPathMatch[2]) {
        const artifactPath = artifactPathMatch[2].trim()
        captureResultsPath(path.dirname(artifactPath))
      }

      if (trimmedLine.includes('Starting scan')) {
        console.log(trimmedLine)
        scanEvent.emit('scanStarted')
      }

      parseAndEmitCrawlingLines(trimmedLine)
    }

    console.log("Starting Scan Process...")
    
    const scan = spawn(
      'node',
      [`--max-old-space-size=${getMaxOldSpaceSize()}`, `${enginePath}/dist/cli.js`, ...getScanOptions(scanDetails)],
      {
        cwd: resultsPath,
        env: {
          ...process.env,
          OOBEE_VERBOSE: '1',
          OOBEE_FAST_CRAWLER: '1',
          GOOGLE_SAFE_BROWSING: '1',
          OOBEE_SENTRY_DSN: 'https://9f2001daae75a14b01e65a67eabfa404@o4509047624761344.ingest.us.sentry.io/4510751209160704',
          CRAWLEE_SYSTEM_INFO_V2: '1',
          PLAYWRIGHT_BROWSERS_PATH: `${playwrightBrowsersPath}`,
          PATH: getPathVariable(),
          ...(getProxySettings() && { ALL_PROXY: getProxySettings() }),
          ...(getIncludeProxy() && { INCLUDE_PROXY: getIncludeProxy() }),
        },
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      }
    )

    scan.on('message', (message) => {
      try {
        const parsedMessage = typeof message === 'string' ? JSON.parse(message) : message
        const messageFromBackend = parsedMessage.payload

        if (parsedMessage.type === 'randomToken') {
          intermediateFolderName = messageFromBackend
        }

        // More reliable than stdout parsing because this is sent via process IPC.
        if (parsedMessage.type === 'storagePath' && messageFromBackend) {
          hasStoragePathFromIpc = true
          captureResultsPath(messageFromBackend)
        }
      } catch (error) {
        console.error('Failed to parse IPC message from scan process:', error)
      }
    })

    currentChildProcess = scan
    pendingCancelHandler = performCancel

    scan.stderr.setEncoding('utf8')
    scan.stderr.on('data', function (data) {
      console.log('stderr: ' + data)
    })

    scan.stdout.setEncoding('utf8')
    scan.stdout.on('data', async (data) => {
      if (killChildProcessSignal) {
        scan.kill('SIGINT')
        setTimeout(() => {
          try { scan.kill('SIGKILL') } catch {}
        }, 180000)
        currentChildProcess = null
        killChildProcessSignal = false
        if (intermediateFolderName) {
          await cleanUpIntermediateFolders(intermediateFolderName)
        }
        resolveOnce({ cancelled: true })
        scanEvent.emit('killScan')
        return
      }

      stdoutRemainder += data
      const stdoutLines = stdoutRemainder.split(/\r?\n/)
      stdoutRemainder = stdoutLines.pop() || ''

      for (const stdoutLine of stdoutLines) {
        await processStdoutLine(stdoutLine)
      }
    })

    // Handles exit fallback when success markers are not emitted to stdout
    scan.on('close', async (code) => {
      if (hasResolved) {
        currentChildProcess = null
        return
      }

      // Process any trailing partial line left in the buffer.
      if (stdoutRemainder.trim()) {
        await processStdoutLine(stdoutRemainder)
        stdoutRemainder = ''
      }

      if (hasResolved) {
        currentChildProcess = null
        return
      }

      if (resultsReceived) {
        currentChildProcess = null
        return
      }

      // Fallback success criteria:
      // if report.html exists in storage path, treat as success
      // regardless of exit code or missing success markers.
      if (hasGeneratedReportHtml()) {
        const scanId = randomUUID()
        scanHistory[scanId] = finalResultsFolderName
        currentChildProcess = null
        await cleanUpIntermediateFolders(finalResultsFolderName)
        resolveOnce({ success: true, scanId })
        scanEvent.emit('scanningCompleted')
        return
      }

      if (noPagesScannedDetected) {
        currentChildProcess = null
        resolveOnce({ success: false })
        return
      }

      currentChildProcess = null
      resolveOnce({ success: false, statusCode: code ?? 0, httpResponseCode })
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
  ipcMain.handle('startScan', async (_event, scanDetails) => {
    return await startScan(scanDetails, scanEvent)
  })

  ipcMain.handle('abortScan', async (_event) => {
    setKillChildProcessSignal()
  })

  ipcMain.on('openReport', async (_event, scanId) => {
    const reportPath = getReportPath(scanId)
    if (!reportPath) return

    if (!fs.existsSync(reportPath)) {
      console.error(`Report not found: ${reportPath}`)
      return
    }

    try {
      const openPathError = await shell.openPath(reportPath)
      if (openPathError) {
        const reportUrl = pathToFileURL(reportPath).toString()
        await shell.openExternal(reportUrl)
      }
    } catch (error) {
      console.error(`Failed to open report: ${error?.message || error}`)
    }
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
      const errorLogPath = process.env.OOBEE_ERROR_LOG_PATH || path.join(appPath, 'errors.txt');
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
