import Alert from '../../common/components/Alert'
import Modal from '../../common/components/Modal'
import arrowRepeat from '../../assets/arrow-repeat-white.svg'
import boxRightArrow from '../../assets/box-arrow-up-right-purple.svg'
import labModeOff from '../../assets/lab-icon-off.svg'
import labModeOn from '../../assets/lab-icon-on.svg'
import phLogo from '../../assets/logo-oobee-emblem-full-colour.svg'
import { handleClickLink, versionComparator } from '../../common/constants'
import { useEffect, useState } from 'react'
import Button from '../../common/components/Button'
import { useTranslation } from '../../i18n'

const UpdateAlert = ({ latestVer, isPrerelease }) => {
  const { t } = useTranslation()
  const handleRestartApp = (e) => {
    window.services.restartApp()
  }

  return (
    <Alert alertClassName='alert-primary mb-5 gap-5'>
      <div className='flex-grow-1'>
        <h4>
          {t('about.updateAvailable', {
            version: latestVer,
            label: isPrerelease
              ? t('version.latestPrerelease')
              : t('version.latestStable'),
          })}
        </h4>
        <p className='mb-0'>{t('about.restartToUpdate')}</p>
      </div>
      <Button
        type='btn-primary'
        className='align-self-center'
        onClick={handleRestartApp}
        aria-label={t('about.restartAriaLabel')}
      >
        <img src={arrowRepeat} alt='' />
        {t('common.restart')}
      </Button>
    </Alert>
  )
}

const LabModeDescription = ({ isLabMode, setIsLabMode }) => {
  const { t } = useTranslation()
  const handleToggleLabMode = (e) => {
    const checked = e.target.checked
    setIsLabMode(checked)
  }

  return (
    <div className='card'>
      <div className='card-body p-3'>
        <div className='d-flex gap-2 align-items-center mb-2'>
          <p id='labmode-label' className='bold-text card-title mb-0 me-2'>
            <img
              className='me-2'
              src={isLabMode ? labModeOn : labModeOff}
              alt=''
            />
            {t('about.labMode')}
          </p>
          {/* custom toggle switch */}
          <div class='form-switch form-check mb-2'>
            <input
              aria-labelledby='labmode-label'
              id='labmode-toggle'
              class='form-check-input'
              type='checkbox'
              onChange={handleToggleLabMode}
              checked={isLabMode}
            />
          </div>
        </div>
        <p className='card-text'>
          {t('about.labModeDesc', { strong: (text) => <strong>{text}</strong> })}
        </p>
      </div>
    </div>
  )
}

const ExternalLink = ({ url, children, linkClass }) => {
  const finalClass = `link ${linkClass ? linkClass : ''}`
  return (
    <a
      role='link'
      className={finalClass}
      href='#'
      onClick={(e) => handleClickLink(e, url)}
    >
      {children}
      <img className='external-link' src={boxRightArrow} alt=''></img>
    </a>
  )
}

const AppDescription = ({ version, versionLabel }) => {
  const { t } = useTranslation()
  const releaseNotesUrl = `https://github.com/GovTechSG/oobee-desktop/releases/tag/${version}`;
  const a11yWebsiteUrl = 'https://go.gov.sg/a11y';
  const privacyStatementUrl = 'https://go.gov.sg/oobee-privacy-statement';
  const termsOfUseUrl = 'https://go.gov.sg/oobee-terms-of-use';
  const reportVulnerabilityUrl = 'https://go.gov.sg/oobee-report-vulnerability';
  const thirdPartyDesktop = 'https://go.gov.sg/oobee-third-party-licenses';
  const thirdPartyCLI = 'https://go.gov.sg/oobee-cli-third-party-licenses';
  const thirdPartyReport = 'https://go.gov.sg/oobee-report-third-party-licenses';

  return (
    <div className='mb-5'>
      <div className='d-flex gap-3'>
        <img src={phLogo} alt={t('about.logoAlt')} />
        <div>
          <p className='m-0 bold-text'>{t('about.appName')}</p>
          <p className='m-0 d-inline-block me-3'>
            {t('about.version', { version })} {versionLabel && `(${versionLabel})`}
          </p>
          <ExternalLink url={releaseNotesUrl}>{t('about.releaseNotes')}</ExternalLink>
        </div>
      </div>
      <p className='mt-3 mb-2'>{t('about.builtBy')}</p>
      <div className='d-flex gap-3'>
        <ExternalLink url={a11yWebsiteUrl}>{t('about.a11yWebsite')}</ExternalLink>
        <ExternalLink url={privacyStatementUrl}>{t('about.privacyStatement')}</ExternalLink>
        <ExternalLink url={termsOfUseUrl}>{t('about.termsOfUse')}</ExternalLink>
        <ExternalLink url={reportVulnerabilityUrl}>{t('about.reportVulnerability')}</ExternalLink>
      </div>

      <p className='mt-3 mb-2'>{t('about.thirdPartyLicenses')}</p>
      <div className='d-flex gap-3'>
          <ExternalLink url={thirdPartyDesktop}>{t('about.licenseDesktop')}</ExternalLink>
          <ExternalLink url={thirdPartyCLI}>{t('about.licenseCli')}</ExternalLink>
          <ExternalLink url={thirdPartyReport}>{t('about.licenseReport')}</ExternalLink>
      </div>

    </div>
  )
}

const AboutModal = ({
  showModal,
  setShowModal,
  appVersionInfo,
  appVersionLabel,
  isLabMode,
  setIsLabMode,
}) => {
  const { t } = useTranslation()
  const { appVersion, latestVer, latestVerForLab } = appVersionInfo
  const [toUpdateVer, setToUpdateVer] = useState(undefined)

  useEffect(() => {
    if (!latestVer || !latestVerForLab) {
      // if unable to fetch release info, dont show update alert
      return setToUpdateVer(undefined)
    }

    const toCompare = isLabMode ? latestVerForLab : latestVer
    const isNeedUpdate = versionComparator(appVersion, toCompare) === -1

    if (isNeedUpdate) {
      setToUpdateVer(toCompare)
    } else {
      setToUpdateVer(undefined)
    }
  }, [isLabMode])

  return (
    <Modal
      id='about-ph-modal'
      showModal={showModal}
      showHeader={true}
      modalBodyClassName='pt-1'
      modalBody={
        <>
          {toUpdateVer && (
            <UpdateAlert
              latestVer={toUpdateVer}
              isPrerelease={toUpdateVer !== latestVer}
            />
          )}
          <AppDescription version={appVersion} versionLabel={appVersionLabel} />
          <LabModeDescription
            isLabMode={isLabMode}
            setIsLabMode={setIsLabMode}
          />
        </>
      }
      modalSizeClass='modal-lg modal-dialog-centered'
      modalTitle={t('about.title')}
      setShowModal={setShowModal}
    />
  )
}

export default AboutModal
