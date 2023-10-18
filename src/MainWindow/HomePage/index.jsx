import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import a11yLogo from "../../assets/a11y-logo.svg";
import appIllustration from "../../assets/app-illustration.svg";
import editIcon from "../../assets/edit-icon.svg";
import InitScanForm from "./InitScanForm";
import "./HomePage.scss";
import services from "../../services";
import { cliErrorCodes, cliErrorTypes } from "../../common/constants";
import Modal from "../../common/components/Modal";
import { BasicAuthForm, BasicAuthFormFooter } from "./BasicAuthForm";
import EditUserDetailsModal from "./EditUserDetailsModal";
import NoChromeErrorModal from "./NoChromeErrorModal";
import Button from "../../common/components/Button";
import WhatsNewModal from "./WhatsNewModal";

const HomePage = ({ isProxy, appVersionInfo, setCompletedScanId }) => {
  const navigate = useNavigate();
  const [prevUrlErrorMessage, setPrevUrlErrorMessage] = useState('');
  const [{ name, email, browser }, setUserData] = useState({
    name: "", 
    email: "",
    browser: null,
  });
  const [showBasicAuthModal, setShowBasicAuthModal] = useState(false);
  const [showEditDataModal, setShowEditDataModal] = useState(false);
  const [showNoChromeErrorModal, setShowNoChromeErrorModal] = useState(false);
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false);
  const [url, setUrl] = useState('');
  const [scanButtonIsClicked, setScanButtonIsClicked] = useState(false);

  useEffect(() => {
    if (scanButtonIsClicked && prevUrlErrorMessage) {
      setPrevUrlErrorMessage('');
    }
  }, [scanButtonIsClicked])
  // useEffect(() => {
  //   console.log('1 scan button is clicked: ', scanButtonIsClicked);
  //   console.log('1 prev error msg: ', prevUrlErrorMessage);
  //   if (scanButtonIsClicked) {
  //     console.log('set error message to empty');
  //     setPrevUrlErrorMessage('');
  //     setScanButtonIsClicked(false);
  //   }
  // }, [scanButtonIsClicked])
  
  // useEffect(() => {
  //   console.log('2 scan button is clicked: ', scanButtonIsClicked);
  //   console.log('2 prev error msg: ', prevUrlErrorMessage);
  //   if (prevUrlErrorMessage && scanButtonIsClicked) {
  //     console.log('set scan button to false');
  //     setScanButtonIsClicked(false);
  //   }
  // }, [prevUrlErrorMessage])

  useEffect(() => {
    if (
      prevUrlErrorMessage !== null &&
      prevUrlErrorMessage.includes("Unauthorised Basic Authentication")
    ) {
      setShowBasicAuthModal(true);
    }

    if (prevUrlErrorMessage !== null && 
        prevUrlErrorMessage.includes("No chrome browser")
    ) {
      setShowNoChromeErrorModal(true);
    } 
  }, [prevUrlErrorMessage]);

  useEffect(() => {
    const getUserData = async () => {
      const userData = await services.getUserData();
      setUserData(userData);
      // to show what's new modal on successful update to latest version
      const handleShowModal = () => {
        setShowWhatsNewModal(!!userData["firstLaunchOnUpdate"] && appVersionInfo.isLatest);
        window.services.editUserData({ firstLaunchOnUpdate: false });
      }
      const whatsNewModalTimeout = setTimeout(
        handleShowModal,
        !!userData["firstLaunchOnUpdate"] ? 500 : 0,
      )
      return whatsNewModalTimeout;
    };

    const whatsNewModalTimeout = getUserData();
    return () => clearTimeout(whatsNewModalTimeout);
  }, []);

  useEffect(() => {
    const checkChromeExists = async () => {
      const chromeExists = await window.services.checkChromeExistsOnMac();
      
      if (!chromeExists) {
        setShowNoChromeErrorModal(true);
      }
    }
    checkChromeExists();
  }, [])

  const isValidHttpUrl = (input) => {
    const regexForUrl = new RegExp("^(http|https):/{2}.+$", "gmi");
    return regexForUrl.test(input);
  };

  const startScan = async (scanDetails) => {
    scanDetails.browser = isProxy ? "edge" : browser;

    if (scanDetails.scanUrl.length === 0) {
      setScanButtonIsClicked(false);
      setPrevUrlErrorMessage("URL cannot be empty.");
      return;
    }

    if (!isValidHttpUrl(scanDetails.scanUrl)) {
      setScanButtonIsClicked(false);
      setPrevUrlErrorMessage("Invalid URL.");
      return;
    }

    if (!navigator.onLine) {
      setScanButtonIsClicked(false);
      setPrevUrlErrorMessage("No internet connection.");
      return;
    }

    window.localStorage.setItem("scanDetails", JSON.stringify(scanDetails));

    const checkUrlResponse = await services.validateUrlConnectivity(scanDetails);
    // valid url -> success: true 
    // invalid url -> success: false, status code: xx, message: xx

    if (checkUrlResponse.success) {
      // if urlIsValid then we start scan or go custom flow page 
       if (scanDetails.scanType === 'Custom flow') {
          navigate('/custom_flow', { state: { scanDetails }});
          return;
        } else {
          navigate('/scanning', { state: { url: scanDetails.scanUrl } });
          const scanResponse = await services.startScan(scanDetails);
          
          // successful scan -> success: true, completedScanId: xx -> /result 
          // unsuccessful scan -> success: false -> /error
          if (scanResponse.failedToCreateExportDir) {
            setPrevUrlErrorMessage('Unable to create download directory');
            return;
          }

          if (scanResponse.success) {
            setCompletedScanId(scanResponse.scanId);
            navigate("/result");
            return;
          } else {
            /* When no pages were scanned (e.g. out of domain upon redirects when valid URL was entered),
                redirects user to error page to going to result page with empty result */
            navigate("/error");
            return; 
          }   
        }
    } else {
      setScanButtonIsClicked(false);
      if (checkUrlResponse.failedToCreateExportDir) {
        setPrevUrlErrorMessage('Unable to create download directory');
        return;
      }

      if (cliErrorCodes.has(checkUrlResponse.statusCode)) {
        let errorMessageToShow;
        switch (checkUrlResponse.statusCode) {
          /* technically urlErrorTypes.invalidUrl is not needed since this case
          was handled above, but just for completeness */
          case cliErrorTypes.unauthorisedBasicAuth:
            errorMessageToShow = "Unauthorised Basic Authentication.";
            break;
          case cliErrorTypes.invalidUrl:
          case cliErrorTypes.cannotBeResolved:
          case cliErrorTypes.errorStatusReceived:
            errorMessageToShow = "Invalid URL.";
            break;
          case cliErrorTypes.notASitemap:
            errorMessageToShow = "Invalid sitemap.";
            break;
          case cliErrorTypes.browserError:
            navigate('/error', { state: { isBrowserError: true }});
            return;
          case cliErrorTypes.systemError:
          default:
            errorMessageToShow = "Something went wrong. Please try again later.";
        }
        console.log(`status error: ${checkUrlResponse.statusCode}`);
        setPrevUrlErrorMessage(errorMessageToShow);
        return;
      } else if (checkUrlResponse.statusCode) {
        console.error(
          `unexpected status error: (code ${checkUrlResponse.statusCode})`,
          checkUrlResponse.message
        );
      }  
    }
  };

  const areUserDetailsSet = name !== "" && email !== "";

  const handleBasicAuthSubmit = (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    const scanDetails = JSON.parse(window.localStorage.getItem("scanDetails"));
    const splitUrl = scanDetails.scanUrl.split("://");
    scanDetails.scanUrl = `${splitUrl[0]}://${username}:${password}@${splitUrl[1]}`;
    startScan(scanDetails);
    setShowBasicAuthModal(false);
    return;
  };

  return (
    <div id="home-page">
      <div id="home-page-main">
        <div>
          <button
            id="edit-user-details"
            onClick={() => setShowEditDataModal(true)}
          >
            Welcome <b>{name}</b> &nbsp;
            <img src={editIcon} aria-label="Edit profile"></img>
          </button>
        </div>
        <img
          id="a11y-logo"
          src={a11yLogo}
          alt="Logo of the GovTech Accessibility Enabling Team"
        />
        <h1 id="app-title">Accessibility Site Scanner</h1>
        <InitScanForm
          isProxy={isProxy}
          startScan={startScan}
          prevUrlErrorMessage={prevUrlErrorMessage}
          scanButtonIsClicked={scanButtonIsClicked}
          setScanButtonIsClicked={setScanButtonIsClicked}
        />
      </div>
      {showBasicAuthModal && (
        <Modal
          id="basic-auth-modal"
          showHeader={true}
          showModal={showBasicAuthModal}
          setShowModal={setShowBasicAuthModal}
          modalTitle={"Your website requires basic authentication"}
          modalBody={
            <>
              <BasicAuthForm handleBasicAuthSubmit={handleBasicAuthSubmit} />
              <p className="mb-0">
                Purple HATS will solely capture your credentials for this scan
                and promptly remove them thereafter.
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
            id={"edit-details-modal"}
            formID={"edit-details-form"}
            showModal={showEditDataModal}
            setShowEditDataModal={setShowEditDataModal}
            initialName={name}
            initialEmail={email}
            setUserData={setUserData}
          />
        </>
      )}
      {showNoChromeErrorModal &&
        <NoChromeErrorModal showModal={showNoChromeErrorModal} setShowModal={setShowNoChromeErrorModal}/>            
      }
      {showWhatsNewModal &&
        <WhatsNewModal
          showModal={showWhatsNewModal}
          setShowModal={setShowWhatsNewModal}
          latestVersion={appVersionInfo.appVersion}
          latestReleaseNotes={appVersionInfo.latestReleaseNotes}
        />
      }
      <div id="home-page-footer">
        <img
          id="app-illustration"
          src={appIllustration}
          alt="Illustration showing people with sight, hearing, motor and cognitive disabilities"
        />
        <span id="footer-text">
          {
            appVersionInfo.isLatest ? (
              <>
                <Button
                  type="transparent"
                  className="purple-text"
                  onClick={() => setShowWhatsNewModal(true)}
                >
                  Version {appVersionInfo.appVersion} {appVersionInfo.isLatest && '(latest)'}
                </Button> | Built by GovTech Accessibility Enabling Team
              </>
            ) : `Version ${appVersionInfo.appVersion} | Built by GovTech Accessibility Enabling Team`
          }
        </span>
      </div>
    </div>
  );
};

export default HomePage;
