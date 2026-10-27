import Modal from '../../common/components/Modal'
import Button from '../../common/components/Button'
import DownloadFolderDropdown from '../../common/components/DownloadFolderDropdown'
import UserDetailsForm from '../../common/components/UserDetailsForm'
import PageIndicator from './components/PageIndicator'
import { PolicyLink } from '../../common/constants'
import { useTranslation } from '../../i18n'
import firstTimer1 from '../../assets/first-timer-1.svg'
import firstTimer2 from '../../assets/first-timer-2.svg'
import firstTimer3 from '../../assets/first-timer-3.svg'
import firstTimer4 from '../../assets/first-timer-4.svg'
import arrowRight from '../../assets/arrow-right-white.svg'
import { useEffect, useState } from 'react'

const TOTAL_STEPS = 5

const OnboardingComponent = ({ setDataExistStatus }) => {
  const { t, localeInfo } = useTranslation()
  const showTelemetryOptOut = localeInfo.telemetryOptOutAvailable
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [telemetryOptOut, setTelemetryOptOut] = useState(false)
  const [nameInputErrorMessage, setNameInputErrorMessage] = useState(null)
  const [emailInputErrorMessage, setEmailInputErrorMessage] = useState(null)

  const isOptedOut = showTelemetryOptOut && telemetryOptOut

  useEffect(() => {
    setFocus()
  }, [step])

  const handleOnBackClick = () => {
    setStep(step - 1)
  }

  const handleOnNextClick = () => {
    setStep(step + 1)
    resetFormInputs()
  }

  const handleSetUserData = () => {
    const userData = isOptedOut
      ? { name: '', email: '', telemetryOptOut: true }
      : { name, email }
    if (showTelemetryOptOut && !isOptedOut) userData.telemetryOptOut = false
    window.services.setUserData(userData)
    setDataExistStatus('exists')
  }

  const resetFormInputs = () => {
    setNameInputErrorMessage(null)
    setEmailInputErrorMessage(null)
    setName('')
    setEmail('')
    setTelemetryOptOut(false)
  }

  const setFocus = () => {
    const modalBody = document.querySelector('.modal-body')
    modalBody.focus()
  }

  const stepStatus = (current) => (
    <div className="visually-hidden" aria-live="polite" role="status">
      {t('onboarding.itemOf', { current, total: TOTAL_STEPS })}
    </div>
  )

  const policy = (text) => <PolicyLink>{text}</PolicyLink>

  const backButton = (
    <Button
      type="btn-secondary"
      className="secondary modal-button modal-half-button modal-left-button"
      onClick={handleOnBackClick}
    >
      {t('common.back')}
    </Button>
  )
  const nextButton = (
    <Button
      type="btn-primary"
      className="modal-button modal-half-button modal-right-button"
      onClick={handleOnNextClick}
    >
      {t('common.next')}
    </Button>
  )

  const formID = 'first-timer-form'

  const isSubmitDisabled = isOptedOut
    ? false
    : name.trim() === '' ||
      email.trim() === '' ||
      nameInputErrorMessage ||
      emailInputErrorMessage

  const renderOnboardingBody = () => {
    switch (step) {
      case 1: {
        return (
          <>
            {stepStatus(1)}
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <img
                className="modal-img"
                src={firstTimer1}
                alt={t('onboarding.step1Alt')}
              ></img>
            </div>
            <h3 className="modal-title fade-in-left">{t('onboarding.step1Title')}</h3>
            <p className="modal-desc fade-in-left">{t('onboarding.step1Desc')}</p>
            <PageIndicator page={1}></PageIndicator>
          </>
        )
      }
      case 2: {
        return (
          <>
            {stepStatus(2)}
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <div id="first-timer-2-container">
                <div className="typewriter">https://www.</div>
                <img className="modal-img" src={firstTimer2}></img>
              </div>
            </div>
            <h3 className="modal-title fade-in-left">{t('onboarding.step2Title')}</h3>
            <p className="modal-desc fade-in-left">{t('onboarding.step2Desc')}</p>
            <PageIndicator page={2}></PageIndicator>
          </>
        )
      }
      case 3: {
        return (
          <>
            {stepStatus(3)}
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <img
                className="modal-img"
                src={firstTimer3}
                alt={t('onboarding.step3Alt')}
              ></img>
            </div>
            <h3 className="modal-title fade-in-left">{t('onboarding.step3Title')}</h3>
            <p className="modal-desc fade-in-left">{t('onboarding.step3Desc')}</p>
            <PageIndicator page={3}></PageIndicator>
          </>
        )
      }
      case 4: {
        return (
          <>
            {stepStatus(4)}
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <img className="modal-img" src={firstTimer4}></img>
            </div>
            <h3 className="modal-title fade-in-left">{t('onboarding.step4Title')}</h3>
            <DownloadFolderDropdown
              isOnboarding={true}
            ></DownloadFolderDropdown>
            <p className="modal-desc fade-in-left">{t('onboarding.step4Desc')}</p>
            <PageIndicator page={4}></PageIndicator>
          </>
        )
      }
      case 5: {
        return (
          <>
            {stepStatus(5)}
            <h3 className="modal-title fade-in-left">{t('onboarding.step5Title')}</h3>
            <UserDetailsForm
              formID={formID}
              name={name}
              email={email}
              setName={setName}
              setEmail={setEmail}
              nameInputErrorMessage={nameInputErrorMessage}
              emailInputErrorMessage={emailInputErrorMessage}
              setNameInputErrorMessage={setNameInputErrorMessage}
              setEmailInputErrorMessage={setEmailInputErrorMessage}
              handleOnSubmit={handleSetUserData}
              isOnboarding={true}
              showTelemetryOptOut={showTelemetryOptOut}
              telemetryOptOut={telemetryOptOut}
              setTelemetryOptOut={setTelemetryOptOut}
            />
            <p className="modal-desc fade-in-left">
              {isOptedOut
                ? t('telemetry.optedOutDesc')
                : t('onboarding.consentDesc', { policy })}
            </p>
            <PageIndicator page={5}></PageIndicator>
          </>
        )
      }
      default:
        return null
    }
  }

  const renderOnboardingFooter = () => {
    switch (step) {
      case 1: {
        return (
          <Button
            type="btn-primary"
            className="modal-button modal-full-button"
            onClick={handleOnNextClick}
          >
            {t('onboarding.letsGo')} &nbsp;
            <img src={arrowRight} alt=""></img>
          </Button>
        )
      }
      case 2:
      case 3:
      case 4: {
        return (
          <>
            {backButton}
            {nextButton}
          </>
        )
      }
      case 5: {
        return (
          <>
            {backButton}
            <button
              type="submit"
              form={formID}
              className={`btn-primary modal-button modal-half-button modal-right-button`}
              disabled={isSubmitDisabled}
            >
              {isOptedOut ? t('onboarding.continue') : t('onboarding.consent')}
            </button>
          </>
        )
      }
      default:
        return null
    }
  }

  return (
    <Modal
      id="onboarding-modal"
      showModal={true}
      showHeader={false}
      isOnboarding={true}
      modalBody={renderOnboardingBody()}
      modalFooter={renderOnboardingFooter()}
      key={step}
    />
  )
}

export default OnboardingComponent
