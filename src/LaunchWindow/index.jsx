import LoadingSpinner from '../common/components/LoadingSpinner'
import Button from '../common/components/Button'
import { useEffect, useState } from 'react'
import './LaunchWindow.scss'
import newUpdateImg from '../../src/assets/box-seam.svg'

const Prompt = ({
  header,
  desc,
  extraNote,
  proceedLabel,
  dismissLabel,
  proceedHandler,
  dismissHandler,
  hideProceed,
}) => {
  return (
    <div id='launch-window'>
      {header === 'New update available' ? (
        <div className='my-5'>
          <img src={newUpdateImg} alt='new update icon' />
        </div>
      ) : (
        <div></div>
      )}
      <div>
        <h1>{header}</h1>
        <p>{desc}</p>
        {extraNote && (
          <p className='extra-note' style={{ fontWeight: 700 }}>
            {extraNote}
          </p>
        )}
        <div className='d-flex justify-content-center'>
          <Button
            type={hideProceed ? 'btn-primary' : 'btn-secondary'}
            onClick={dismissHandler}
          >
            {dismissLabel}
          </Button>
          {!hideProceed && (
            <Button
              id='proceed-button'
              type='btn-primary'
              onClick={proceedHandler}
            >
              {proceedLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

const LaunchWindow = () => {
  const [launchStatus, setLaunchStatus] = useState(null)
  const [promptUpdate, setPromptUpdate] = useState(false)
  const [versionInfo, setVersionInfo] = useState(null)

  useEffect(() => {
    window.services.launchStatus((s) => {
      if (typeof s === 'object' && s.status === 'promptFrontendUpdate') {
        setVersionInfo({
          currentVersion: s.currentVersion,
          newVersion: s.newVersion,
          adminByRequestPresent: s.adminByRequestPresent,
        })
        setPromptUpdate(true)
      } else if (s === 'promptFrontendUpdate' || s === 'promptBackendUpdate') {
        setPromptUpdate(true)
      } else {
        setLaunchStatus(s)
      }
    })
  }, [])

  useEffect(() => {
    window.addEventListener('offline', () => {
      const lastKnownStatus = launchStatus
      setLaunchStatus('offline')

      window.addEventListener(
        'online',
        () => {
          setLaunchStatus(lastKnownStatus)
        },
        { once: true }
      )
    })
    if (launchStatus === 'frontendDownloadComplete') {
      setPromptUpdate(false)
    }
  }, [launchStatus])

  useEffect(() => {
    if (!promptUpdate) return
    if (!window.services?.checkNeedsElevation) return
    const intervalId = setInterval(async () => {
      try {
        const needsElevation = await window.services.checkNeedsElevation()
        setVersionInfo((prev) => {
          if (!prev) return prev
          if (prev.adminByRequestPresent === needsElevation) return prev
          return { ...prev, adminByRequestPresent: needsElevation }
        })
      } catch (err) {
        console.error('[ABR-poll] checkNeedsElevation failed:', err)
      }
    }, 5000)
    return () => clearInterval(intervalId)
  }, [promptUpdate])

  const messages = {
    settingUp: {
      main: 'Setting up',
      sub: 'This may take a few minutes. Please do not close the application.',
    },
    checkingUpdates: { main: 'Checking for Updates' },
    updatingBackend: {
      main: 'Updating application',
      sub: 'This may take a few minutes. Please do not close the application.',
    },
    updatingFrontend: {
      main: 'Downloading',
      sub: 'This may take a few minutes. Please do not close the application.',
    },
    offline: {
      main: 'No internet connection',
      sub: 'Waiting for reconnection.',
    },
  }

  if (!launchStatus) {
    return null
  }

  const handlePromptUpdateResponse = (response) => () => {
    window.services.proceedUpdate(response)
    setPromptUpdate(false)
  }

  const handlePromptLaunchInstallerResponse = (response) => () => {
    window.services.launchInstaller(response)
    // setPromptUpdate(false);
  }

  const handlePromptRestartAppResponse = (response) => () => {
    window.services.restartAppAfterMacOSFrontendUpdate(response)
    // setPromptUpdate(false);
  }

  if (promptUpdate) {
    const versionDesc = versionInfo
      ? `Current installed: ${versionInfo.currentVersion}, new version ${versionInfo.newVersion} available. Would you like to update now? It may take a few minutes.`
      : 'Would you like to update now? It may take a few minutes.'
    const extraNote = versionInfo && versionInfo.adminByRequestPresent
      ? 'Note: Admin user rights for this device is required for this update to be successful.'
      : null
    return (
      <Prompt
        header='New update available'
        desc={versionDesc}
        extraNote={extraNote}
        proceedLabel='Update'
        proceedHandler={handlePromptUpdateResponse(true)}
        dismissLabel='Later'
        dismissHandler={handlePromptUpdateResponse(false)}
        hideProceed={!!extraNote}
      />
    )
  }

  if (launchStatus === 'frontendDownloadComplete') {
    return (
      <Prompt
        header='New installer has been downloaded'
        desc='Would you like to run the installer now?'
        proceedLabel='Run'
        proceedHandler={handlePromptLaunchInstallerResponse(true)}
        dismissLabel='Later'
        dismissHandler={handlePromptLaunchInstallerResponse(false)}
      />
    )
  }

  if (launchStatus === 'frontendDownloadCompleteMacOS') {
    return (
      <Prompt
        header='New App has been downloaded'
        desc='Would you like to restart the application?'
        proceedLabel='Run'
        proceedHandler={handlePromptRestartAppResponse(true)}
        dismissLabel='Later'
        dismissHandler={handlePromptRestartAppResponse(false)}
      />
    )
  }

  const { main: displayedMessage, sub: displayedSub } = messages[launchStatus]
  return (
    <div id='launch-window'>
      <LoadingSpinner />
      <h1>{displayedMessage}</h1>
      {displayedSub && <p>{displayedSub}</p>}
    </div>
  )
}

export default LaunchWindow
