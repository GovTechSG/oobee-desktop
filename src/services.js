/* This file provides methods that interfaces between the API functions exposed by the electron main process
and the renderer. The APIs are provided via the window.services object, as defined in ./public/preload.js
*/

import {
  scanTypes,
  viewportTypes,
  devices,
  fileTypes,
  forbiddenCharactersInDirPath,
  reserveFileNameKeywords,
} from './common/constants'

// for use in openUserDataForm
let currentScanUrl
let currentScanType

const startScan = async (scanDetails) => {
  const {
    scanType: selectedScanType,
    scanUrl,
    pageLimit,
    viewport,
    device,
    viewportWidth,
    fileTypes: selectedFileTypes,
    // scanInBackground,
    browser,
    maxConcurrency,
    includeScreenshots,
    includeSubdomains,
    followRobots,
    scanMetadata,
    customChecks,
    wcagAaa,
    customFlowFirst,
  } = scanDetails

  currentScanUrl = scanUrl
  currentScanType = selectedScanType

  // LLM analysis keeps the UI-level scanType as 'LLM analysis' (so post-scan
  // navigation routes to /llm_chat) but the CLI-level `-c` flag depends on
  // the input mode — the CLI can't handle a file:// URL under `-c website`
  // (it treats it as a relative path and stats
  // `<cwd>/file:/<abs-path>`, errors with ENOENT, exits with the
  // systemError code). Map each mode to its CLI value explicitly:
  //   • customFlowFirst        → `custom`   (interactive browser recording)
  //   • file:// URL            → `localfile`
  //   • otherwise              → `website`  (single-page crawl)
  // In every branch the LLM env-var bundle below (saveDom /
  // savePageScreenshot / saveComputedStyles / htmlMaxBytes / parentHtmlDepth
  // / isLLMAnalysis) still applies via the isLLMAnalysis check, so the
  // captured pages come through with everything the chat UI needs.
  const isLLMAnalysis = selectedScanType === 'LLM analysis'
  const isFileUrl = typeof scanUrl === 'string' && /^file:/i.test(scanUrl.trim())
  const resolvedScanType = isLLMAnalysis
    ? customFlowFirst
      ? 'custom'
      : isFileUrl
        ? 'localfile'
        : 'website'
    : scanTypes[selectedScanType]

  const scanArgs = {
    scanType: resolvedScanType,
    url: scanUrl,
    headlessMode: resolvedScanType !== 'custom',
    browser: browser,
    maxConcurrency: maxConcurrency,
    customChecks: customChecks,
    wcagAaa: wcagAaa,
    fileTypes: fileTypes[selectedFileTypes],
    includeScreenshots,
    includeSubdomains,
    followRobots,
    metadata: JSON.stringify(scanMetadata),
  }

  if (resolvedScanType !== 'custom') {
    scanArgs.maxPages = isLLMAnalysis ? 1 : pageLimit
  }

  if (isLLMAnalysis) {
    scanArgs.generateJsonFiles = 'yes'
    scanArgs.saveDom = true
    scanArgs.savePageScreenshot = true
    scanArgs.saveComputedStyles = true
    scanArgs.htmlMaxBytes = 0
    scanArgs.parentHtmlDepth = 1
    scanArgs.isLLMAnalysis = true
  }

  if (viewport === viewportTypes.mobile) {
    scanArgs.customDevice = 'Mobile'
  }

  if (viewport === viewportTypes.specific) {
    scanArgs.customDevice = devices[device]
  }

  if (viewport === viewportTypes.custom) {
    scanArgs.viewportWidth = viewportWidth
  }

  const response = await window.services.startScan(scanArgs)
  return response
}

const openReport = (scanId) => {
  window.services.openReport(scanId)
}

const getResultsFolderPath = async (scanId) => {
  const reportPath = await window.services.getResultsFolderPath(scanId)
  return reportPath
}
const getUploadFolderPath = async () => {
  return await window.services.getUploadFolderPath()
}

const getUserData = async () => {
  const userData = await window.services.getUserData()
  return userData
}

const getErrorLog = async (timeOfScan, timeOfError) => {
  const errorLog = await window.services.getErrorLog(timeOfScan, timeOfError)
  return errorLog
}

const getDataForForm = async () => {
  const userData = await getUserData()
  const email = userData['email']
  const name = userData['name']
  const event = userData['event']
  const browser = userData['browser']
  const exportDir = userData['exportDir']
  return {
    websiteUrl: currentScanUrl,
    scanType: currentScanType,
    email: email,
    name: name,
    event: event,
    browser: browser,
    exportDir: exportDir,
  }
}

const getFeedbackFormUrl = async () => {
  return 'https://go.gov.sg/contact-oobee';
}

const isValidEmail = (email) => {
  const emailRegex = new RegExp(/^.+@.+\..+$/, 'gm')

  return emailRegex.test(email)
}

const isValidCustomFlowLabel = (customFlowLabel) => {
  const containsReserveWithDot = reserveFileNameKeywords.some((char) =>
    customFlowLabel.toLowerCase().includes(char.toLowerCase() + '.')
  )
  const containsForbiddenCharacters = forbiddenCharactersInDirPath.some(
    (character) => customFlowLabel.includes(character)
  )
  const isEmpty = customFlowLabel.length <= 0
  const exceedsMaxLength = customFlowLabel.length > 80

  if (isEmpty) return { isValid: false, errorMessage: 'Cannot be empty.' }
  if (exceedsMaxLength)
    return { isValid: false, errorMessage: 'Cannot exceed 80 characters.' }
  if (containsForbiddenCharacters)
    return {
      isValid: false,
      errorMessage:
        `Cannot contain ${forbiddenCharactersInDirPath.toString()}`.replaceAll(
          ',',
          ' , '
        ),
    }
  if (containsReserveWithDot)
    return {
      isValid: false,
      errorMessage: `Cannot have '.' appended to ${reserveFileNameKeywords
        .toString()
        .replaceAll(',', ' , ')} as they are reserved keywords.`,
    }

  return { isValid: true }
}

const mailReport = async (formDetails, scanId) => {
  const response = await window.services.mailReport(formDetails, scanId)
  return response
}

const getIsWindows = async () => window.services.getIsWindows()

const isValidName = (name) => {
  // Allow only printable characters from any language
  const regex = /^[\p{L}\p{N}\s'".,()\[\]{}!?:؛،؟…]+$/u

  // Check if the length is between 2 and 32000 characters
  if (name.length < 2 || name.length > 32000) {
    // Handle invalid name length
    return false
  }

  if (!regex.test(name)) {
    // Handle invalid name format
    return false
  }

  // Include a check for specific characters to sanitize injection patterns
  const preventInjectionRegex = /[<>'"\\/;|&!$*{}()\[\]\r\n\t]/
  if (preventInjectionRegex.test(name)) {
    // Handle potential injection attempts
    return false
  }

  return true
}

const services = {
  startScan,
  openReport,
  getResultsFolderPath,
  getUploadFolderPath,
  getUserData,
  getDataForForm,
  getFeedbackFormUrl,
  isValidEmail,
  mailReport,
  getIsWindows,
  isValidName,
  isValidCustomFlowLabel,
  getErrorLog,
}

export default services
