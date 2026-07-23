import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import a11yLogo from '../../assets/logo-oobee-full-colour-FPA-110x40.svg'
// import appIllustration from '../../assets/app-illustration.svg'
import appIllustration from '../../assets/home-page-illustration.svg'
import editIcon from '../../assets/edit-pencil-purple.svg'
import labModeOff from '../../assets/lab-icon-off.svg'
import labModeOn from '../../assets/lab-icon-on.svg'
import InitScanForm from './InitScanForm'
import './HomePage.scss'
import services from '../../services'
import {
  cliErrorCodes,
  cliErrorTypes,
  errorStates,
  versionComparator,
  urlWithoutAuth,
  urlCheckStatuses
} from '../../common/constants'
import Modal from '../../common/components/Modal'
import { BasicAuthForm, BasicAuthFormFooter } from './BasicAuthForm'
import EditUserDetailsModal from './EditUserDetailsModal'
import NoChromeErrorModal from './NoChromeErrorModal'
import Button from '../../common/components/Button'
import WhatsNewModal from './WhatsNewModal'
import AboutModal from './AboutModal'

const HomePage = ({ appVersionInfo, setCompletedScanId }) => {
  const navigate = useNavigate()
  const [prevUrlErrorMessage, setPrevUrlErrorMessage] = useState('')
  const [{ name, email, browser, isLabMode }, setUserData] = useState({
    name: '',
    email: '',
    browser: null,
    isLabMode: false,
  })
  const [showBasicAuthModal, setShowBasicAuthModal] = useState(false)
  const [showEditDataModal, setShowEditDataModal] = useState(false)
  const [showNoChromeErrorModal, setShowNoChromeErrorModal] = useState(false)
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false)
  const [showAboutPhModal, setShowAboutPhModal] = useState(false)
  const [showProxyModal, setShowProxyModal] = useState(false)
  const [proxyValue, setProxyValue] = useState('')
  const [includeProxyValue, setIncludeProxyValue] = useState('')
  const [url, setUrl] = useState('')
  const [scanButtonIsClicked, setScanButtonIsClicked] = useState(false)
  const [isAbortingScan, setIsAbortingScan] = useState(false)

  const location = useLocation()

  // Hidden proxy configuration feature (Ctrl/Cmd+Shift+X)
  useEffect(() => {
    const handleProxyShortcut = async (e) => {
      // Ctrl+Shift+X (Windows/Linux) or Cmd+Shift+X (macOS)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'X' || e.key === 'x')) {
        e.preventDefault()
        
        try {
          const currentProxy = await window.services.getProxySettings()
          const currentIncludeProxy = await window.services.getIncludeProxy()
          setProxyValue(currentProxy || '')
          setIncludeProxyValue(currentIncludeProxy || '')
          setShowProxyModal(true)
        } catch (error) {
          console.error('Proxy shortcut error:', error)
        }
      }
    }

    document.addEventListener('keydown', handleProxyShortcut)
    return () => document.removeEventListener('keydown', handleProxyShortcut)
  }, [])

  const handleProxySubmit = async (e) => {
    e.preventDefault()
    try {
      const trimmedValue = proxyValue.trim()
      const trimmedIncludeProxy = includeProxyValue.trim()
      await window.services.setProxySettings(trimmedValue)
      await window.services.setIncludeProxy(trimmedIncludeProxy)
      setShowProxyModal(false)
      
      // Optional: Show confirmation
      if (trimmedValue) {
        console.log(`Proxy set to: ${trimmedValue}`)
      } else {
        console.log('Proxy settings cleared')
      }
    } catch (error) {
      console.error('Error saving proxy:', error)
    }
  }
  // Handle disabling of scan button when scan is aborting
  useEffect(() => {
    if (location.state && location.state.abortingScan) {
      setIsAbortingScan(true)
    }

    window.services.killScan(() => {
      setIsAbortingScan(false)
    })
  }, [])

  // function that determines whether version is a prerelease/stable build
  const getVersionLabel = useCallback(
    (version) => {
      const { latestVer, latestVerForLab, allReleaseTags, allPreReleaseTags } =
        appVersionInfo

      try {
        if (latestVer === version) return 'latest stable build'
        if (latestVerForLab === version) return 'latest pre-release'

        if (allReleaseTags.includes(version)) {
          return 'stable build'
        } else if (allPreReleaseTags.includes(version)) {
          return 'pre-release'
        }
      } catch (error) {
        console.log('Unable to show version label')
      }

      return undefined // if cannot be determined, this should not happen
    },
    [appVersionInfo]
  )

  const isLatest = () => {
    const currVer = appVersionInfo.appVersion
    const latestToCompare = isLabMode
      ? appVersionInfo.latestVerForLab
      : appVersionInfo.latestVer
    if (latestToCompare) {
      return versionComparator(currVer, latestToCompare) === 1
    }
    return false // if release info is undefined (unable to fetch)
  }

  const getReleaseNotesOnUpdate = (appVersionInfo) => {
    // to get release notes to show on first launch after update
    const currVer = appVersionInfo.appVersion
    const latestLabVer = appVersionInfo.latestVerForLab
    const releaseVer = appVersionInfo.latestVer
    if (currVer === latestLabVer) {
      return appVersionInfo.latestNotesForLab
    } else if (currVer === releaseVer) {
      return appVersionInfo.latestRelNotes
    }
    return undefined
  }

  useEffect(() => {
    if (scanButtonIsClicked && prevUrlErrorMessage) {
      setPrevUrlErrorMessage('')
    }
  }, [scanButtonIsClicked])

  useEffect(() => {
    if (
      prevUrlErrorMessage !== null &&
      prevUrlErrorMessage.includes('Login required')
    ) {
      setShowBasicAuthModal(true)
    }

    if (
      prevUrlErrorMessage !== null &&
      prevUrlErrorMessage.includes('No chrome browser')
    ) {
      setShowNoChromeErrorModal(true)
    }
  }, [prevUrlErrorMessage])

  useEffect(() => {
    const getUserData = async () => {
      const userData = await services.getUserData()
      setUserData(userData)
      // to show what's new modal on successful update to latest version
      const handleShowModal = () => {
        setShowWhatsNewModal(!!userData['firstLaunchOnUpdate'] && isLatest())
        window.services.editUserData({ firstLaunchOnUpdate: false })
      }
      const whatsNewModalTimeout = setTimeout(
        handleShowModal,
        !!userData['firstLaunchOnUpdate'] ? 500 : 0
      )
      return whatsNewModalTimeout
    }

    const whatsNewModalTimeout = getUserData()
    return () => clearTimeout(whatsNewModalTimeout)
  }, [])

  const editUserData = (info) => {
    setUserData((initData) => ({ ...initData, ...info }))
    window.services.editUserData(info)
  }

  useEffect(() => {
    const checkChromeExists = async () => {
      const chromeExists = await window.services.checkChromeExistsOnMac()

      if (!chromeExists) {
        setShowNoChromeErrorModal(true)
      }
    }
    checkChromeExists()
  }, [])

  const isValidHttpUrl = (input) => {
    const regexForUrl = new RegExp('^(http|https):/{2}.+$', 'gmi')
    return regexForUrl.test(input)
  }

  const isValidFilepath = (input) => {
    const regexForFilepath = new RegExp('^(file://).+$', 'gmi')
    return regexForFilepath.test(input)
  }

  const startScan = async (scanDetails) => {
    scanDetails.browser = browser
    const timeOfScan = new Date()

    if (scanDetails.scanUrl.length === 0) {
      setScanButtonIsClicked(false)
      setPrevUrlErrorMessage('URL cannot be empty.')
      return
    }

    if (scanDetails.scanType === 'Sitemap crawler') {
      if (
        !isValidHttpUrl(scanDetails.scanUrl) &&
        !isValidFilepath(scanDetails.scanUrl)
      ) {
        setScanButtonIsClicked(false)
        setPrevUrlErrorMessage('Invalid sitemap.')
        return
      }
    } else if (scanDetails.scanType === 'Local file') {
      if (!isValidFilepath(scanDetails.scanUrl)) {
        setScanButtonIsClicked(false)
        setPrevUrlErrorMessage('File is not a local html or sitemap file.')
        return
      }
    } else if (scanDetails.scanType === 'Custom flow') {
      if (
        !isValidHttpUrl(scanDetails.scanUrl) &&
        !isValidFilepath(scanDetails.scanUrl)
      ) {
        setScanButtonIsClicked(false)
        setPrevUrlErrorMessage('Invalid URL.')
        return
      }
    } else if (!isValidHttpUrl(scanDetails.scanUrl)) {
      setScanButtonIsClicked(false)
      setPrevUrlErrorMessage('Invalid URL.')
      return
    }

    if (!navigator.onLine) {
      setScanButtonIsClicked(false)
      setPrevUrlErrorMessage('No internet connection.')
      return
    }

    window.localStorage.setItem('scanDetails', JSON.stringify(scanDetails))

    let hasNavigatedToScanning = false
    window.services.scanStarted(() => {
      hasNavigatedToScanning = true
      navigate('/scanning', {
        state: { url: urlWithoutAuth(scanDetails.scanUrl).toString() },
      })
    })

    const scanResponse = await services.startScan(scanDetails)

    if (scanResponse.cancelled) {
      setScanButtonIsClicked(false)
      return
    }

    if (scanResponse.failedToCreateExportDir) {
      setScanButtonIsClicked(false)
      setPrevUrlErrorMessage('Unable to create download directory')
      return
    }

    if (scanResponse.success) {
      setCompletedScanId(scanResponse.scanId)
      if (scanDetails.scanType === 'Custom flow') {
        navigate('/custom_flow', { state: { scanDetails } })
      } else {
        navigate('/result')
      }
      return
    }

    if (cliErrorCodes.has(scanResponse.statusCode)) {
      if (scanResponse.statusCode === cliErrorTypes.browserError) {
        navigate('/error', {
          state: { errorState: errorStates.browserError, timeOfScan },
        })
        return
      }

      setScanButtonIsClicked(false)
      const match = Object.values(urlCheckStatuses).find(
        (s) => s.code === scanResponse.statusCode
      )
      let msg = match && 'message' in match ? match.message : 'Something went wrong. Please try again later.'
      if (scanResponse.httpResponseCode) {
        msg += ` (HTTP ${scanResponse.httpResponseCode})`
      }
      console.log(msg)
      setPrevUrlErrorMessage(msg)
      return
    }

    if (hasNavigatedToScanning) {
      navigate('/error', {
        state: { errorState: errorStates.noPagesScannedError, timeOfScan },
      })
    } else {
      setScanButtonIsClicked(false)
      setPrevUrlErrorMessage('Something went wrong. Please try again later.')
    }
  }

  const areUserDetailsSet = name !== '' && email !== ''

  const handleBasicAuthSubmit = (e) => {
    e.preventDefault()
    const scanDetails = JSON.parse(window.localStorage.getItem('scanDetails'))
    const urlWithAuth = new URL(scanDetails.scanUrl)
    urlWithAuth.username = e.target.username.value
    urlWithAuth.password = e.target.password.value
    scanDetails.scanUrl = urlWithAuth.toString()
    setScanButtonIsClicked(true)
    startScan(scanDetails)
    setShowBasicAuthModal(false)
    return
  }

  return (
    <>
      <div id="home-page">
        <div>
          <button
            id="edit-user-details"
            onClick={() => setShowEditDataModal(true)}
          >
            Welcome <b>{name}</b> &nbsp;
            <img src={editIcon} aria-label="Edit profile"></img>
          </button>
        </div>
        <div id="home-page-main">
          <img
            id="a11y-logo"
            src={a11yLogo}
            alt="Logo of the GovTech Accessibility Enabling Team"
          />
          <h1 id="app-title">Accessibility Site Scanner</h1>
          <InitScanForm
            startScan={startScan}
            prevUrlErrorMessage={prevUrlErrorMessage}
            scanButtonIsClicked={scanButtonIsClicked}
            setScanButtonIsClicked={setScanButtonIsClicked}
            isAbortingScan={isAbortingScan}
          />
        </div>
        {showBasicAuthModal && (
          <Modal
            id="basic-auth-modal"
            showHeader={true}
            showModal={showBasicAuthModal}
            setShowModal={setShowBasicAuthModal}
            modalTitle={'Your website requires basic authentication'}
            modalBody={
              <>
                <BasicAuthForm handleBasicAuthSubmit={handleBasicAuthSubmit} />
                <p className="mb-0">
                  Oobee will solely capture your credentials for this scan and
                  promptly remove them thereafter.
                </p>
              </>
            }
            modalFooter={
              <BasicAuthFormFooter
                setShowBasicAuthModal={setShowBasicAuthModal}
              />
            }
          />
        )}
        {areUserDetailsSet && (
          <>
            <EditUserDetailsModal
              id={'edit-details-modal'}
              formID={'edit-details-form'}
              showModal={showEditDataModal}
              setShowEditDataModal={setShowEditDataModal}
              initialName={name}
              initialEmail={email}
              setUserData={setUserData}
            />
          </>
        )}
        {showNoChromeErrorModal && (
          <NoChromeErrorModal
            showModal={showNoChromeErrorModal}
            setShowModal={setShowNoChromeErrorModal}
          />
        )}
        {showWhatsNewModal && getReleaseNotesOnUpdate(appVersionInfo) && (
          <WhatsNewModal
            showModal={showWhatsNewModal}
            setShowModal={setShowWhatsNewModal}
            version={appVersionInfo.appVersion}
            releaseNotes={getReleaseNotesOnUpdate(appVersionInfo)}
          />
        )}
        {showAboutPhModal && (
          <AboutModal
            showModal={showAboutPhModal}
            setShowModal={setShowAboutPhModal}
            appVersionInfo={appVersionInfo}
            appVersionLabel={getVersionLabel(appVersionInfo.appVersion)}
            isLabMode={isLabMode}
            setIsLabMode={(bool) => editUserData({ isLabMode: bool })}
          />
        )}
        {showProxyModal && (
          <Modal
            id="proxy-config-modal"
            showHeader={true}
            showModal={showProxyModal}
            setShowModal={setShowProxyModal}
            modalTitle={'Configure Proxy Settings'}
            modalSizeClass="modal-dialog-centered"
            modalBody={
              <>
                <div className="user-form">
                  <form id="proxy-form" onSubmit={handleProxySubmit}>
                    <div className="user-form-field">
                      <label className="user-form-label" htmlFor="proxy-input">
                        ALL_PROXY Value
                      </label>
                      <input
                        type="text"
                        id="proxy-input"
                        className="user-form-input"
                        placeholder="socks5://localhost:1080"
                        value={proxyValue}
                        onChange={(e) => setProxyValue(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="user-form-field">
                      <label className="user-form-label" htmlFor="include-proxy-input">
                        INCLUDE_PROXY Value (optional)
                      </label>
                      <input
                        type="text"
                        id="include-proxy-input"
                        className="user-form-input"
                        value={includeProxyValue}
                        onChange={(e) => setIncludeProxyValue(e.target.value)}
                      />
                    </div>
                  </form>
                </div>
                <p>
                  Leave empty to clear proxy settings. This will be used for all scans.
                </p>
              </>
            }
            modalFooter={
              <button
                type="submit"
                form="proxy-form"
                className="btn-primary modal-button"
              >
                Save
              </button>
            }
          />
        )}
        <div id="home-page-footer">
          <img
            id="app-illustration"
            src={appIllustration}
            alt="Illustration showing people with sight, hearing, motor and cognitive disabilities"
          />
          <span id="footer-text">
            {
              <>
                <Button
                  type="btn-link"
                  className="purple-text"
                  onClick={() => setShowAboutPhModal(true)}
                >
                  <img
                    className="me-2"
                    src={isLabMode ? labModeOn : labModeOff}
                    alt=""
                  />
                  Version {appVersionInfo.appVersion}{' '}
                  {getVersionLabel(appVersionInfo.appVersion) &&
                    `(${getVersionLabel(appVersionInfo.appVersion)})`}
                </Button>{' '}
                | Powered by GovTech's A11y
              </>
            }
          </span>
        </div>
      </div>
    </>
  )
}

export default HomePage
