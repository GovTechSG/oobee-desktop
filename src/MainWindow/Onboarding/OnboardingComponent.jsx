import Modal from '../../common/components/Modal'
import Button from '../../common/components/Button'
import DownloadFolderDropdown from '../../common/components/DownloadFolderDropdown'
import UserDetailsForm from '../../common/components/UserDetailsForm'
import PageIndicator from './components/PageIndicator'
import { policyUrlElem } from '../../common/constants'
import firstTimer1 from '../../assets/first-timer-1.svg'
import firstTimer2 from '../../assets/first-timer-2.svg'
import firstTimer3 from '../../assets/first-timer-3.svg'
import firstTimer4 from '../../assets/first-timer-4.svg'
import arrowRight from '../../assets/arrow-right-white.svg'
import { useEffect, useState } from 'react'

const OnboardingComponent = ({ setDataExistStatus }) => {
  const [step, setStep] = useState(1)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [nameInputErrorMessage, setNameInputErrorMessage] = useState(null)
  const [emailInputErrorMessage, setEmailInputErrorMessage] = useState(null)

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
    window.services.setUserData({ name, email })
    setDataExistStatus('exists')
  }

  const resetFormInputs = () => {
    setNameInputErrorMessage(null)
    setEmailInputErrorMessage(null)
    setName('')
    setEmail('')
  }

  const setFocus = () => {
    const modalBody = document.querySelector('.modal-body')
    modalBody.focus()
  }

  const backButton = (
    <Button
      type="btn-secondary"
      className="secondary modal-button modal-half-button modal-left-button"
      onClick={handleOnBackClick}
    >
      Back
    </Button>
  )
  const nextButton = (
    <Button
      type="btn-primary"
      className="modal-button modal-half-button modal-right-button"
      onClick={handleOnNextClick}
    >
      Next
    </Button>
  )

  const formID = 'first-timer-form'

  const isSubmitDisabled =
    name.trim() === '' ||
    email.trim() === '' ||
    nameInputErrorMessage ||
    emailInputErrorMessage

  const renderOnboardingBody = () => {
    switch (step) {
      case 1: {
        return (
          <>
            <div className="visually-hidden" aria-live="polite" role="status">
              Item 1 of 5
            </div>
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <img
                className="modal-img"
                src={firstTimer1}
                alt="person saying hello"
              ></img>
            </div>
            <h3 className="modal-title fade-in-left">Hi there!</h3>
            <p className="modal-desc fade-in-left">
              Making your website accessible is within reach. Let’s get started
              by taking a quick look at how Oobee Desktop works.
            </p>
            <PageIndicator page={1}></PageIndicator>
          </>
        )
      }
      case 2: {
        return (
          <>
            <div className="visually-hidden" aria-live="polite" role="status">
              Item 2 of 4
            </div>
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <div id="first-timer-2-container">
                <div className="typewriter">https://www.</div>
                <img className="modal-img" src={firstTimer2}></img>
              </div>
            </div>
            <h3 className="modal-title fade-in-left">Get started</h3>
            <p className="modal-desc fade-in-left">
              Enter your website or sitemap URL and Oobee Desktop will crawl
              through them to analyse and identify accessibility issues.
            </p>
            <PageIndicator page={2}></PageIndicator>
          </>
        )
      }
      case 3: {
        return (
          <>
            <div className="visually-hidden" aria-live="polite" role="status">
              Item 3 of 4
            </div>
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <img
                className="modal-img"
                src={firstTimer3}
                alt="custom flow step-by-step animation illustration"
              ></img>
            </div>
            <h3 className="modal-title fade-in-left">Custom flow scan</h3>
            <p className="modal-desc fade-in-left">
              This scan type allows you to specify a user journey by enabling
              you to click the scan button on each desired webpage on a browser
              to initiate scan.
            </p>
            <PageIndicator page={3}></PageIndicator>
          </>
        )
      }
      case 4: {
        return (
          <>
            <div className="visually-hidden" aria-live="polite" role="status">
              Item 4 of 5
            </div>
            <div
              className="modal-img-container fade-in-left"
              aria-hidden="true"
            >
              <img className="modal-img" src={firstTimer4}></img>
            </div>
            <h3 className="modal-title fade-in-left">
              Download report location
            </h3>
            <DownloadFolderDropdown
              isOnboarding={true}
            ></DownloadFolderDropdown>
            <p className="modal-desc fade-in-left">
              All reports generated from Oobee Desktop will be auto-downloaded
              into this folder.
            </p>
            <PageIndicator page={4}></PageIndicator>
          </>
        )
      }
      case 5: {
        return (
          <>
            <div className="visually-hidden" aria-live="polite" role="status">
              Item 5 of 5
            </div>
            <h3 className="modal-title fade-in-left">Get to know you</h3>
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
            />
            <p className="modal-desc fade-in-left">
              To personalise your experience, we will be collecting your name,
              email address and app usage data. The collection and usage of your
              data will fully comply with {policyUrlElem}
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
            Let's go &nbsp;
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
              I consent
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
