import React, { useState, useRef, useEffect } from 'react'
import Button from '../../common/components/Button'
import AdvancedScanOptions from './AdvancedScanOptions'
import {
  scanTypes,
  viewportTypes,
  devices,
  fileTypes,
  getDefaultAdvancedOptions,
} from '../../common/constants'
import ButtonSvgIcon from '../../common/components/ButtonSvgIcon'
import { ReactComponent as ChevronUpIcon } from '../../assets/chevron-up-purple.svg'
import { ReactComponent as ChevronDownIcon } from '../../assets/chevron-down-white.svg'
import LoadingSpinner from '../../common/components/LoadingSpinner'
import ToolTip from '../../common/components/ToolTip'

function convertToReadablePath(path) {
  let readable = path.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(readable)) {
    readable = readable.replace(/^([a-zA-Z]):/, '/$1:')
  }
  return `file:///${readable.replace(/^\/+/, '')}`
}

const InitScanForm = ({
  startScan,
  prevUrlErrorMessage,
  scanButtonIsClicked,
  setScanButtonIsClicked,
  isAbortingScan,
}) => {
  const [openPageLimitAdjuster, setOpenPageLimitAdjuster] = useState(false)
  const [pageWord, setPageWord] = useState('pages')
  const pageLimitAdjuster = useRef()
  const scanTypeOptions = Object.keys(scanTypes)
  const fileTypesOptions = Object.keys(fileTypes)
  const [selectedFile, setSelectedFile] = useState(null)
  const [scanUrl, setScanUrl] = useState('')
  const [staticHttpUrl, setStaticHttpUrl] = useState('https://')
  const [staticFilePath, setStaticFilePath] = useState('file:///')
  const [cachedNonFileScanType, setCachedNonFileScanType] = useState(() => {
    return sessionStorage.getItem('cachedNonFileScanType') || scanTypeOptions[0]
  })
  const [displayScanType, setDisplayScanType] = useState(scanTypeOptions[0])
  const [allowedFileTypes, setAllowedFileTypes] = useState([])
  const [showToggleUrlFileTooltip, setShowToggleUrlFileTooltip] =
    useState(false)
  const toggleUrlFileRef = useRef(null)

  const viewportOptions = viewportTypes
  const deviceOptions = Object.keys(devices)

  const cachedPageLimit = sessionStorage.getItem('pageLimit')
  const cachedAdvancedOptions = sessionStorage.getItem('advancedOptions')

  const [pageLimit, setPageLimit] = useState(() => {
    return cachedPageLimit ? JSON.parse(cachedPageLimit) : '100'
  })
  const [advancedOptions, setAdvancedOptions] = useState(() => {
    return cachedAdvancedOptions
      ? JSON.parse(cachedAdvancedOptions)
      : getDefaultAdvancedOptions()
  })

  const [isFileOptionChecked, setIsFileOptionChecked] = useState(() => {
    const cachedCheckboxState = sessionStorage.getItem('isFileOptionChecked')
    return cachedCheckboxState ? JSON.parse(cachedCheckboxState) : false
  })

  const getAllowedFileTypes = (scanType) => {
    if (scanType === scanTypeOptions[0]) {
      return ['.html', '.htm', '.shtml', '.xhtml', '.pdf']
    } else if (scanType === scanTypeOptions[1]) {
      return ['.xml', '.txt']
    }
    return []
  }

  useEffect(() => {
    const cachedScanUrl = sessionStorage.getItem('scanUrl')
    const cachedScanType = sessionStorage.getItem('scanType')
    const wasLocalFileScan = cachedScanType === scanTypeOptions[3]

    if (wasLocalFileScan) {
      setIsFileOptionChecked(true)
      const newScanUrl = cachedScanUrl
        ? JSON.parse(cachedScanUrl)
        : 'Choose file...'
      setScanUrl(newScanUrl)
      setStaticFilePath(newScanUrl)
      setStaticHttpUrl('https://')
      setDisplayScanType(cachedNonFileScanType)
    } else {
      setIsFileOptionChecked(false)
      const newScanUrl = cachedScanUrl ? JSON.parse(cachedScanUrl) : 'https://'
      setScanUrl(newScanUrl)
      setStaticHttpUrl(newScanUrl)
      setStaticFilePath('Choose file...')
      setCachedNonFileScanType(cachedScanType || scanTypeOptions[0])
      setDisplayScanType(cachedScanType || scanTypeOptions[0])
    }

    setAdvancedOptions((prevOptions) => ({
      ...prevOptions,
      scanType: wasLocalFileScan
        ? cachedNonFileScanType
        : cachedScanType || prevOptions.scanType,
    }))

    setAllowedFileTypes(
      getAllowedFileTypes(cachedScanType || scanTypeOptions[0])
    )
  }, [])

  useEffect(() => {
    if (isFileOptionChecked) {
      setStaticFilePath(scanUrl)
    } else {
      setStaticHttpUrl(scanUrl)
    }

    sessionStorage.setItem(
      'isFileOptionChecked',
      JSON.stringify(isFileOptionChecked)
    )
    sessionStorage.setItem(
      'scanType',
      isFileOptionChecked ? scanTypeOptions[3] : displayScanType
    )
    sessionStorage.setItem('scanUrl', JSON.stringify(scanUrl))
    sessionStorage.setItem('cachedNonFileScanType', cachedNonFileScanType)
  }, [isFileOptionChecked, scanUrl, displayScanType, cachedNonFileScanType])

  useEffect(() => {
    const urlBarElem = document.getElementById('url-bar')
    const urlBarInputList = urlBarElem.querySelectorAll('input, button')
    urlBarInputList.forEach((elem) => (elem.disabled = scanButtonIsClicked))
    setOpenPageLimitAdjuster(false)
  }, [scanButtonIsClicked, prevUrlErrorMessage])

  useEffect(() => {
    setPageWord(pageLimit === '1' ? 'page' : 'pages')
  }, [pageLimit])

  useEffect(() => {
    setAllowedFileTypes(getAllowedFileTypes(displayScanType))
  }, [displayScanType])

  const togglePageLimitAdjuster = (e) => {
    if (!e.currentTarget.disabled) {
      if (!openPageLimitAdjuster) {
        setOpenPageLimitAdjuster(true)
      } else {
        pageLimitAdjuster.current.style.animationName = 'button-fade-out'
        setTimeout(() => setOpenPageLimitAdjuster(false), 200)
      }
    }
  }

  const handleScanButtonClicked = () => {
    // Capture the current scan type to ensure consistency
    const currentScanType = isFileOptionChecked ? displayScanType : advancedOptions.scanType

    if (isFileOptionChecked) {
      const fileExtension = '.' + scanUrl.split('.').pop().toLowerCase()
      if (!allowedFileTypes.includes(fileExtension)) {
        alert(
          `Invalid file format. Please choose a file with one of these extensions: ${allowedFileTypes.join(
            ', '
          )}`
        )
        return
      }
    }

    setScanButtonIsClicked(true)
    sessionStorage.setItem('pageLimit', JSON.stringify(pageLimit))
    sessionStorage.setItem('advancedOptions', JSON.stringify(advancedOptions))
    sessionStorage.setItem('scanUrl', JSON.stringify(scanUrl))

    if (isFileOptionChecked) {
      setStaticFilePath(scanUrl)
      startScan({
        file: selectedFile,
        scanUrl,
        scanType: scanTypeOptions[3],
        // if sitemap scan, then pageLimit is set
        ...(currentScanType === scanTypeOptions[1]) && { pageLimit: pageLimit },
        ...advancedOptions,
      })
    } else {
      setStaticHttpUrl(scanUrl)
      startScan({ scanUrl: scanUrl.trim(), pageLimit, ...advancedOptions })
    }
  }

  const handleFileSelect = async () => {
    try {
      const options = {
        properties: ['openFile'],
        filters: [
          {
            name: 'Allowed Files',
            extensions: allowedFileTypes.map((ext) => ext.slice(1)),
          },
        ],
      }

      const filePath = await window.services.selectFile(options)

      if (filePath) {
        const fileExtension = '.' + filePath.split('.').pop().toLowerCase()

        if (allowedFileTypes.includes(fileExtension)) {
          const readablePath = convertToReadablePath(filePath)
          setScanUrl(readablePath)
          setStaticFilePath(readablePath)
          setSelectedFile({
            path: filePath,
            name: filePath.split(/[\\/]/).pop(),
          })
        } else {
          alert(
            `Invalid file format. Please choose a file with one of these extensions: ${allowedFileTypes.join(
              ', '
            )}`
          )
        }
      }
    } catch (error) {
      console.error('Error selecting file:', error)
    }
  }

  const toggleScanType = () => {
    const newState = !isFileOptionChecked
    setIsFileOptionChecked(newState)
    setScanUrl(newState ? staticFilePath : staticHttpUrl)
    if (newState) {
      setCachedNonFileScanType(displayScanType)
      setAdvancedOptions((prevOptions) => ({
        ...prevOptions,
        scanType: scanTypeOptions[3],
      }))
    } else {
      setAdvancedOptions((prevOptions) => ({
        ...prevOptions,
        scanType: cachedNonFileScanType,
      }))
      setDisplayScanType(cachedNonFileScanType)
    }
    // Have screenreader to focus and announce the button
    if (toggleUrlFileRef.current) {
      toggleUrlFileRef.current.blur()
      setTimeout(() => {
        toggleUrlFileRef.current.focus()
      }, 10)
    }
  }

  return (
    <div id="init-scan-form">
      <label htmlFor="url-input" id="url-bar-label">
        {isFileOptionChecked ? 'Select ' : 'Enter '}
        your <strong>{isFileOptionChecked ? 'local file' : 'URL'} </strong>
        to get started
      </label>
      <div id="url-bar-group">
        <div id="url-bar">
          {advancedOptions.scanType !== scanTypeOptions[2] && (
            <div
              className="toggle-url-file-tooltip-container"
              onMouseEnter={() => setShowToggleUrlFileTooltip(true)}
              onMouseLeave={() => setShowToggleUrlFileTooltip(false)}
              onFocus={() => setShowToggleUrlFileTooltip(true)}
              onBlur={() => setShowToggleUrlFileTooltip(false)}
            >
              <button
                type="button"
                onClick={toggleScanType}
                aria-describedby="toggle-url-file-tooltip"
                ref={toggleUrlFileRef}
              >
                {isFileOptionChecked ? 'FILE' : 'URL'}
              </button>
              <ToolTip
                description={`Toggle to ${isFileOptionChecked ? 'URL' : 'file'
                  } input`}
                id="toggle-url-file-tooltip"
                showToolTip={showToggleUrlFileTooltip}
              />
            </div>
          )}

          {!isFileOptionChecked && (
            <input
              id="url-input"
              type="text"
              value={scanUrl}
              onChange={(e) => setScanUrl(e.target.value)}
            />
          )}

          {isFileOptionChecked && (
            <div id="file-input-container">
              <button
                id="file-select-button"
                onClick={handleFileSelect}
                disabled={scanButtonIsClicked}
                aria-describedby="url-bar-label"
                className="file-select-button"
              >
                {scanUrl ? scanUrl : 'Choose file'}
              </button>
            </div>
          )}

          {
            (
              (!isFileOptionChecked && advancedOptions.scanType !== scanTypeOptions[2]) ||
              (isFileOptionChecked && displayScanType === scanTypeOptions[1])
            ) && (
              <div>
                <Button
                  type="btn-link"
                  id="page-limit-toggle-button"
                  onClick={(e) => togglePageLimitAdjuster(e)}
                >
                  capped at{' '}
                  <span className="purple-text">
                    {pageLimit} {pageWord}{' '}
                    {openPageLimitAdjuster ? (
                      <ButtonSvgIcon
                        className={`chevron-up-icon`}
                        svgIcon={<ChevronUpIcon />}
                      />
                    ) : (
                      <ButtonSvgIcon
                        className={`chevron-down-icon`}
                        svgIcon={<ChevronDownIcon />}
                      />
                    )}
                  </span>
                </Button>

                {openPageLimitAdjuster && (
                  <div id="page-limit-adjuster" ref={pageLimitAdjuster}>
                    <input
                      type="number"
                      id="page-limit-input"
                      step="10"
                      min="1"
                      value={pageLimit}
                      onChange={(e) => setPageLimit(e.target.value)}
                      onBlur={(e) => {
                        if (Number(e.target.value) <= 0) {
                          setPageLimit(1)
                        }
                      }}
                    />
                    <label htmlFor="page-limit-input">{pageWord}</label>
                  </div>
                )}
              </div>
            )}

          <Button
            type="btn-primary"
            className="scan-btn"
            onClick={handleScanButtonClicked}
            disabled={scanButtonIsClicked || isAbortingScan}
          >
            {scanButtonIsClicked || isAbortingScan ? (
              <LoadingSpinner></LoadingSpinner>
            ) : (
              'Scan'
            )}
          </Button>
        </div>

        {prevUrlErrorMessage && (
          <span id="url-error-message" className="error-text">
            {prevUrlErrorMessage}
          </span>
        )}
      </div>

      <AdvancedScanOptions
        scanTypeOptions={
          isFileOptionChecked
            ? scanTypeOptions.filter(
              (option) =>
                option !== scanTypeOptions[2] && option !== scanTypeOptions[3]
            )
            : scanTypeOptions.filter((option) => option !== scanTypeOptions[3])
        }
        fileTypesOptions={fileTypesOptions}
        viewportOptions={viewportOptions}
        deviceOptions={deviceOptions}
        advancedOptions={{
          ...advancedOptions,
          scanType: isFileOptionChecked
            ? displayScanType
            : advancedOptions.scanType,
        }}
        setAdvancedOptions={(newOptions) => {
          if (!isFileOptionChecked) {
            setAdvancedOptions(newOptions)
            setDisplayScanType(newOptions.scanType)
            setCachedNonFileScanType(newOptions.scanType)
          } else {
            setDisplayScanType(newOptions.scanType)
            setCachedNonFileScanType(newOptions.scanType)
            setAdvancedOptions({
              ...advancedOptions,
              ...newOptions,
              scanType: scanTypeOptions[3],
            })
          }
          setAllowedFileTypes(getAllowedFileTypes(newOptions.scanType))
        }}
        scanButtonIsClicked={scanButtonIsClicked}
        isFileOptionChecked={isFileOptionChecked}
      />
    </div>
  )
}

export default InitScanForm
