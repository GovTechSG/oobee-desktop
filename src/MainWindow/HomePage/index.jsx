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
  urlCheckStatuses,
  urlCheckMessageKey,
} from '../../common/constants'
import Modal from '../../common/components/Modal'
import { BasicAuthForm, BasicAuthFormFooter } from './BasicAuthForm'
import EditUserDetailsModal from './EditUserDetailsModal'
import NoChromeErrorModal from './NoChromeErrorModal'
import Button from '../../common/components/Button'
import WhatsNewModal from './WhatsNewModal'
import AboutModal from './AboutModal'
import { useTranslation } from '../../i18n'

// Sentinel error identifiers. The displayed text is translated, so effects
// that need to react to a specific error must compare these, never the text.
const URL_ERROR_LOGIN_REQUIRED = 'loginRequired'
const URL_ERROR_NO_CHROME = 'noChrome'

const HomePage = ({ appVersionInfo, setCompletedScanId }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [prevUrlErrorMessage, setPrevUrlErrorMessage] = useState('')
  const [prevUrlErrorType, setPrevUrlErrorType] = useState(null)
  const [{ name, email, browser, isLabMode, telemetryOptOut }, setUserData] = useState({
    name: '',
    email: '',
    browser: null,
    isLabMode: false,
    telemetryOptOut: false,
  })
  const [showBasicAuthModal, setShowBasicAuthModal] = useState(false)
  const [showEditDataModal, setShowEditDataModal] = useState(false)
  const [showNoChromeErrorModal, setShowNoChromeErrorModal] = useState(false)
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false)
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false)
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
        if (latestVer === version) return t('version.latestStable')
        if (latestVerForLab === version) return t('version.latestPrerelease')

        if (allReleaseTags.includes(version)) {
          return t('version.stable')
        } else if (allPreReleaseTags.includes(version)) {
          return t('version.prerelease')
        }
      } catch (error) {
        console.log('Unable to show version label')
      }

      return undefined // if cannot be determined, this should not happen
    },
    [appVersionInfo, t]
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
      setUrlError('')
    }
  }, [scanButtonIsClicked])

  useEffect(() => {
    if (prevUrlErrorType === URL_ERROR_LOGIN_REQUIRED) {
      setShowBasicAuthModal(true)
    }

    if (prevUrlErrorType === URL_ERROR_NO_CHROME) {
      setShowNoChromeErrorModal(true)
    }
  }, [prevUrlErrorMessage, prevUrlErrorType])

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

  // Show the announcement modal whenever the release catalog contains a
  // non-empty `alwaysShowAnnouncement` field. Independent of the update
  // "What's New" modal — dismissing it just closes the modal for the
  // session, next launch shows it again as long as the field is still set.
  useEffect(() => {
    const announcement = appVersionInfo && appVersionInfo.alwaysShowAnnouncement
    if (typeof announcement === 'string' && announcement.length > 0) {
      setShowAnnouncementModal(true)
    }
  }, [appVersionInfo && appVersionInfo.alwaysShowAnnouncement])

  const editUserData = (info) => {
    setUserData((initData) => ({ ...initData, ...info }))
    window.services.editUserData(info)
  }

  const setUrlError = (message, type = null) => {
    setPrevUrlErrorType(type)
    setPrevUrlErrorMessage(message)
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
      setUrlError(t('scanError.urlEmpty'))
      return
    }

    if (scanDetails.scanType === 'Sitemap crawler') {
      if (
        !isValidHttpUrl(scanDetails.scanUrl) &&
        !isValidFilepath(scanDetails.scanUrl)
      ) {
        setScanButtonIsClicked(false)
        setUrlError(t('scanError.invalidSitemap'))
        return
      }
    } else if (scanDetails.scanType === 'Local file') {
      if (!isValidFilepath(scanDetails.scanUrl)) {
        setScanButtonIsClicked(false)
        setUrlError(t('scanError.notLocalFile'))
        return
      }
    } else if (scanDetails.scanType === 'Custom flow') {
      if (
        !isValidHttpUrl(scanDetails.scanUrl) &&
        !isValidFilepath(scanDetails.scanUrl)
      ) {
        setScanButtonIsClicked(false)
        setUrlError(t('scanError.invalidUrl'))
        return
      }
    } else if (!isValidHttpUrl(scanDetails.scanUrl)) {
      setScanButtonIsClicked(false)
      setUrlError(t('scanError.invalidUrl'))
      return
    }

    if (!navigator.onLine) {
      setScanButtonIsClicked(false)
      setUrlError(t('scanError.noInternet'))
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
      setUrlError(t('scanError.cannotCreateDownloadDir'))
      return
    }

    if (scanResponse.success) {
      setCompletedScanId(scanResponse.scanId)
      // All scan types, including Custom flow, go straight to the result
      // page. The custom flow report label is collected in the scan browser.
      navigate('/result')
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
      const messageKey = urlCheckMessageKey(scanResponse.statusCode)
      let msg = messageKey ? t(messageKey) : t('scanError.generic')
      if (scanResponse.httpResponseCode) {
        msg += ` (HTTP ${scanResponse.httpResponseCode})`
      }
      console.log(msg)
      setUrlError(
        msg,
        scanResponse.statusCode === urlCheckStatuses.unauthorised.code
          ? URL_ERROR_LOGIN_REQUIRED
          : null
      )
      return
    }

    if (hasNavigatedToScanning) {
      navigate('/error', {
        state: { errorState: errorStates.noPagesScannedError, timeOfScan },
      })
    } else {
      setScanButtonIsClicked(false)
      setUrlError(t('scanError.generic'))
    }
  }

  const areUserDetailsSet = (name !== '' && email !== '') || telemetryOptOut === true

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
            {telemetryOptOut
              ? t('home.welcomeOptedOut')
              : t('home.welcome', { name, b: (text) => <b>{text}</b> })}{' '}
            &nbsp;
            <img src={editIcon} aria-label={t('home.editProfile')}></img>
          </button>
        </div>
        <div id="home-page-main">
          <img
            id="a11y-logo"
            src={a11yLogo}
            alt={t('home.logoAlt')}
          />
          <h1 id="app-title">{t('home.appTitle')}</h1>
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
            modalTitle={t('home.basicAuthTitle')}
            modalBody={
              <>
                <BasicAuthForm handleBasicAuthSubmit={handleBasicAuthSubmit} />
                <p className="mb-0">{t('home.basicAuthDesc')}</p>
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
              initialTelemetryOptOut={telemetryOptOut === true}
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
            baseUrl={appVersionInfo.baseUrl}
          />
        )}
        {showAnnouncementModal && appVersionInfo.alwaysShowAnnouncement && (
          <WhatsNewModal
            modalId="announcement-modal"
            title={t('home.announcement')}
            showModal={showAnnouncementModal}
            setShowModal={setShowAnnouncementModal}
            version={appVersionInfo.appVersion}
            releaseNotes={appVersionInfo.alwaysShowAnnouncement}
            rawHtml
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
            modalTitle={t('home.proxyTitle')}
            modalSizeClass="modal-dialog-centered"
            modalBody={
              <>
                <div className="user-form">
                  <form id="proxy-form" onSubmit={handleProxySubmit}>
                    <div className="user-form-field">
                      <label className="user-form-label" htmlFor="proxy-input">
                        {t('home.proxyAllLabel')}
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
                        {t('home.proxyIncludeLabel')}
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
                <p>{t('home.proxyDesc')}</p>
              </>
            }
            modalFooter={
              <button
                type="submit"
                form="proxy-form"
                className="btn-primary modal-button"
              >
                {t('common.save')}
              </button>
            }
          />
        )}
        <div id="home-page-footer">
          <img
            id="app-illustration"
            src={appIllustration}
            alt={t('home.illustrationAlt')}
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
                  {t('home.version', { version: appVersionInfo.appVersion })}{' '}
                  {getVersionLabel(appVersionInfo.appVersion) &&
                    `(${getVersionLabel(appVersionInfo.appVersion)})`}
                </Button>{' '}
                | {t('home.poweredBy')}
              </>
            }
          </span>
        </div>
      </div>
    </>
  )
}

export default HomePage
