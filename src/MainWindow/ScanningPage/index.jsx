import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import "./ScanningPage.scss";
import ScanningComponent from "../../common/components/ScanningComponent";
import pagesSvg from "../../assets/first-timer-3.svg";
import Button from "../../common/components/Button";
import ToolTip from "../../common/components/ToolTip";
import Modal from "../../common/components/Modal";
import startingUrlIcon from "../../assets/starting-url.svg";

const ScanningPage = () => {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [url, setUrl] = useState(null);
  const [showAbortScanTooltip, setShowAbortScanTooltip] = useState(false);
  const [showAbortScanModal, setShowAbortScanModal] = useState(false);

  useEffect(() => {
    setUrl(state.url);
  }, []);

  const handleAbortScan = () => {
    navigate("/", { state: {abortingScan: true } }); 
    window.services.abortScan();
  };

  const handleAbortScanModalNo = () => {
    setShowAbortScanModal(false);
  };

  return (
    <div id="scanning-page">
      {url && (
        <>
          <div className="scanning-page-header">
            <img className="scanning-page-header-img" src={pagesSvg}></img>
            <div className="starting-url-outer-box">
              <div className="starting-url-inner-box">
                <img src={startingUrlIcon} aria-hidden="true"></img>
                <span className="starting-url">{url}</span>
              </div>
              <div className="abort-scan-tooltip-container">
                <ToolTip
                  description="Abort scan"
                  id="abort-scan-tooltip"
                  showToolTip={showAbortScanTooltip}
                />
                <button
                  type="button"
                  className="btn-close"
                  aria-label="Abort scan"
                  onMouseEnter={() => setShowAbortScanTooltip(true)}
                  onMouseLeave={() => setShowAbortScanTooltip(false)}
                  onClick={() => setShowAbortScanModal(true)}
                  tabIndex={0}
                />
              </div>
            </div>
          </div>
          <ScanningComponent
            scanningMessage={"Preparing Scan..."}
          ></ScanningComponent>
          <Modal
            id="abortScanModal"
            isConfirm={true}
            showModal={showAbortScanModal}
            setShowModal={setShowAbortScanModal}
            showHeader={true}
            modalTitle={"Are you sure?"}
            modalSizeClass="modal-dialog-centered"
            hideCloseButton={true}
            modalBody={
              <>
                <p className="mb-0">
                  Aborting the scan will lose any progress and return back to
                  the home screen.
                </p>
              </>
            }
            modalFooter={
              <>
                <Button
                  type="btn-secondary"
                  className="abort-modal-left-button"
                  onClick={handleAbortScan}
                >
                  Yes
                </Button>
                <Button
                  type="btn-primary"
                  className="abort-modal-right-button"
                  onClick={handleAbortScanModalNo}
                >
                  No
                </Button>
              </>
            }
          />
        </>
      )}
    </div>
  );
};

export default ScanningPage;
