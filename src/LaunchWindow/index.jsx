import LoadingSpinner from '../common/components/LoadingSpinner'
import Button from '../common/components/Button'
import { useEffect, useState } from 'react'
import './LaunchWindow.scss'
import newUpdateImg from '../../src/assets/box-seam.svg'
import { useTranslation } from '../i18n'

const Prompt = ({
  header,
  desc,
  extraNote,
  proceedLabel,
  dismissLabel,
  proceedHandler,
  dismissHandler,
  hideProceed,
  showUpdateIcon,
}) => {
  const { t } = useTranslation()
  return (
    <div id='launch-window'>
      {showUpdateIcon ? (
        <div className='my-5'>
          <img src={newUpdateImg} alt={t('launch.newUpdateIconAlt')} />
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
  const { t } = useTranslation()
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
      main: t('launch.settingUp'),
      sub: t('launch.mayTakeFewMinutes'),
    },
    checkingUpdates: { main: t('launch.checkingUpdates') },
    updatingBackend: {
      main: t('launch.updatingApplication'),
      sub: t('launch.mayTakeFewMinutes'),
    },
    updatingFrontend: {
      main: t('launch.downloading'),
      sub: t('launch.mayTakeFewMinutes'),
    },
    offline: {
      main: t('launch.noInternet'),
      sub: t('launch.waitingReconnect'),
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
      ? t('launch.updateVersionDesc', {
          currentVersion: versionInfo.currentVersion,
          newVersion: versionInfo.newVersion,
        })
      : t('launch.updateDesc')
    const extraNote = versionInfo && versionInfo.adminByRequestPresent
      ? t('launch.adminRequiredNote')
      : null
    return (
      <Prompt
        header={t('launch.newUpdateAvailable')}
        showUpdateIcon={true}
        desc={versionDesc}
        extraNote={extraNote}
        proceedLabel={t('common.update')}
        proceedHandler={handlePromptUpdateResponse(true)}
        dismissLabel={t('common.later')}
        dismissHandler={handlePromptUpdateResponse(false)}
        hideProceed={!!extraNote}
      />
    )
  }

  if (launchStatus === 'frontendDownloadComplete') {
    return (
      <Prompt
        header={t('launch.installerDownloaded')}
        desc={t('launch.runInstallerPrompt')}
        proceedLabel={t('common.run')}
        proceedHandler={handlePromptLaunchInstallerResponse(true)}
        dismissLabel={t('common.later')}
        dismissHandler={handlePromptLaunchInstallerResponse(false)}
      />
    )
  }

  if (launchStatus === 'frontendDownloadCompleteMacOS') {
    return (
      <Prompt
        header={t('launch.appDownloaded')}
        desc={t('launch.restartAppPrompt')}
        proceedLabel={t('common.run')}
        proceedHandler={handlePromptRestartAppResponse(true)}
        dismissLabel={t('common.later')}
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
