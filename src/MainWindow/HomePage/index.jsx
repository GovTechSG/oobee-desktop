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
  const [url, setUrl] = useState('')
  const [scanButtonIsClicked, setScanButtonIsClicked] = useState(false)
  const [isAbortingScan, setIsAbortingScan] = useState(false)

  const location = useLocation()
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
      prevUrlErrorMessage.includes('Unauthorised Basic Authentication')
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

    if (scanDetails.scanType === 'Sitemap crawl') {
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

    const checkUrlResponse = await services.validateUrlConnectivity(scanDetails)
    if (checkUrlResponse.success) {
      navigate('/scanning', {
        state: { url: urlWithoutAuth(scanDetails.scanUrl).toString() },
      })
      const scanResponse = await services.startScan(scanDetails)

      if (scanResponse.cancelled) {
        return
      }

      if (scanResponse.failedToCreateExportDir) {
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
      } else {
        /* When no pages were scanned (e.g. out of domain upon redirects when valid URL was entered),
                redirects user to error page to going to result page with empty result */
        navigate('/error', {
          state: { errorState: errorStates.noPagesScannedError, timeOfScan },
        })
        return
      }
    } else {
      setScanButtonIsClicked(false)
      if (checkUrlResponse.failedToCreateExportDir) {
        setPrevUrlErrorMessage('Unable to create download directory')
        return
      }

      if (cliErrorCodes.has(checkUrlResponse.statusCode)) {
        let errorMessageToShow
        switch (checkUrlResponse.statusCode) {
          /* technically urlErrorTypes.invalidUrl is not needed since this case
          was handled above, but just for completeness */
          case cliErrorTypes.unauthorisedBasicAuth:
            errorMessageToShow = 'Unauthorised Basic Authentication.'
            break
          case cliErrorTypes.invalidUrl:
          case cliErrorTypes.cannotBeResolved:
          case cliErrorTypes.errorStatusReceived:
            errorMessageToShow = 'Invalid URL.'
            break
          case cliErrorTypes.notASitemap:
            errorMessageToShow = 'Invalid sitemap.'
            break
          case cliErrorTypes.notALocalFile:
            errorMessageToShow = 'File is not a local html or sitemap file.'
            break
          case cliErrorTypes.browserError:
            navigate('/error', {
              state: { errorState: errorStates.browserError, timeOfScan },
            })
            return
          case cliErrorTypes.systemError:
          default:
            errorMessageToShow = 'Something went wrong. Please try again later.'
        }
        console.log(`status error: ${checkUrlResponse.statusCode}`)
        setPrevUrlErrorMessage(errorMessageToShow)
        return
      } else if (checkUrlResponse.statusCode) {
        console.error(
          `unexpected status error: (code ${checkUrlResponse.statusCode})`,
          checkUrlResponse.message
        )
      }
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
