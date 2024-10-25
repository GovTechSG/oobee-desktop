import LoadingSpinner from '../common/components/LoadingSpinner'
import Button from '../common/components/Button'
import { useEffect, useState } from 'react'
import './LaunchWindow.scss'
import newUpdateImg from '../../src/assets/box-seam.svg'

const Prompt = ({
  header,
  desc,
  proceedLabel,
  dismissLabel,
  proceedHandler,
  dismissHandler,
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
        <div className='d-flex justify-content-center'>
          <Button type='btn-secondary' onClick={dismissHandler}>
            {dismissLabel}
          </Button>
          <Button
            id='proceed-button'
            type='btn-primary'
            onClick={proceedHandler}
          >
            {proceedLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

const LaunchWindow = () => {
  const [launchStatus, setLaunchStatus] = useState(null)
  const [promptUpdate, setPromptUpdate] = useState(false)

  useEffect(() => {
    window.services.launchStatus((s) => {
      if (s === 'promptFrontendUpdate' || s === 'promptBackendUpdate') {
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
    return (
      <Prompt
        header='New update available'
        desc='Would you like to update now? It may take a few minutes.'
        proceedLabel='Update'
        proceedHandler={handlePromptUpdateResponse(true)}
        dismissLabel='Later'
        dismissHandler={handlePromptUpdateResponse(false)}
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
