import Modal from "../../common/components/Modal";
import Button from "../../common/components/Button";
import UserDetailsForm from "../../common/components/UserDetailsForm";
import { policyUrlElem } from "../../common/constants";
import firstTimer1 from "../../assets/first-timer-1.svg";
import firstTimer2 from "../../assets/first-timer-2.svg";
import firstTimer3 from "../../assets/first-timer-3.svg";
import firstTimer1Circle from "../../assets/first-timer-1-circles.svg";
import firstTimer2Circle from "../../assets/first-timer-2-circles.svg";
import firstTimer3Circle from "../../assets/first-timer-3-circles.svg";
import firstTimer4Circle from "../../assets/first-timer-4-circles.svg";
import arrowRight from "../../assets/arrow-right.png";
import { useState } from "react";

const OnboardingComponent = ({
  handleSetUserData,
  setName,
  setEmail,
  userInputErrorMessage,
  setUserInputErrorMessage,
  name, 
  email
}) => {
  const [step, setStep] = useState(1);

  const handleOnBackClick = () => {
    setStep(step - 1);
  };

  const handleOnNextClick = () => {
    setStep(step + 1);
    resetFormInputs();
  };

  const resetFormInputs = () => {
    if (userInputErrorMessage) {
      setUserInputErrorMessage(null);
    }

    if (name) {
      setName("");
    }

    if (email) {
      setEmail("")
    }
  }

  const backButton = (
    <Button
      type="secondary"
      className="secondary modal-button modal-half-button modal-left-button"
      onClick={handleOnBackClick}
    >
      Back
    </Button>
  );
  const nextButton = (
    <Button
      type="primary"
      className="modal-button modal-half-button modal-right-button"
      onClick={handleOnNextClick}
    >
      Next
    </Button>
  );
  
  switch (step) {
    case 1: {
      return (
        <Modal
          showModal={true}
          showCloseButton={false}
          modalBody={
            <>
              <div className="modal-img-container">
                <img className="modal-img" src={firstTimer1}></img>
              </div>
              <h3 className="modal-title">Hi There!</h3>
              <p className="modal-desc">Making your website accessible is within reach. Let’s get started by taking a quick look at how Purple HATS work.</p>
              <img className="page-indicator" src={firstTimer1Circle} ></img>
            </>
          }
          modalFooter={
            <Button
              type="primary"
              className="modal-button modal-full-button"
              onClick={handleOnNextClick}
            >
              Let's go &nbsp;
              <img src={arrowRight}></img>
            </Button>
          }
          key={step}
        />
      );
    }
    case 2: {
      return (
        <Modal
          showModal={true}
          showCloseButton={false}
          modalBody={
            <>
              <div className="modal-img-container">
                <div id="first-timer-2-container">
                  <div className="typewriter">https://www.</div>
                  <img className="modal-img" src={firstTimer2}></img>
                </div>
              </div>
              <h3 className="modal-title">Get started</h3>
              <p className="modal-desc">You just need to enter your website/sitemap URL and Purple HATS will crawl through all the web pages to analyse for accessibility issues.</p>
              <img className="page-indicator" src={firstTimer2Circle} ></img>
            </>
          }
          modalFooter={
            <>
              {backButton}
              {nextButton}
            </>
          }
          key={step}
        />
      );
    }
    case 3: {
      return (
        <Modal
          showModal={true}
          showCloseButton={false}
          modalBody={
            <>
              <div className="modal-img-container">
                <img className="modal-img" src={firstTimer3}></img>
              </div>
              <h3 className="modal-title">Custom Flow</h3>
              <p className="modal-desc">You just need to enter your website/sitemap URL and Purple HATS will crawl through all the web pages to analyse for accessibility issues.</p>
              <img className="page-indicator" src={firstTimer3Circle} ></img>
            </>
          }
          modalFooter={
            <>
              {backButton}
              {nextButton}
            </>
          }
          key={step}
        />
      );
    }
    case 4: {
      const formID = "first-timer-form";
      const isSubmitDisabled = name.trim() === "" || email.trim() === "";
      
      return (
        <Modal
          showModal={true}
          showCloseButton={false}
          modalBody={
            <>
              <h3 className="modal-title">Get to know you</h3>
              <UserDetailsForm
                formID={formID}
                setName={setName}
                setEmail={setEmail}
                handleOnSubmit={handleSetUserData}
                userInputErrorMessage={userInputErrorMessage}
              />
              <p className="modal-desc">
                To personalise your experience, we will be collecting your name, email address and app usage data. Your information fully complies with {policyUrlElem}
              </p>
              <img className="page-indicator" src={firstTimer4Circle} ></img>
            </>
          }
          modalFooter={
            <>
              {backButton}
              <button
                type="submit"
                form={formID}
                className="primary modal-button modal-half-button modal-right-button"
                disabled={isSubmitDisabled}
              >
                I consent
              </button>
            </>
          }
          key={step}
        />
      );
    }
    default: {
      return null;
    }
  }
};

export default OnboardingComponent;