import { useEffect, useMemo, useState } from "react";
import Button from "../../common/components/Button";
import "./ResultPage.scss";
import services from "../../services";
import { Link, useNavigate } from "react-router";
import { handleClickLink } from "../../common/constants";
import ButtonSvgIcon from "../../common/components/ButtonSvgIcon";
import { ReactComponent as MailIcon } from "../../assets/mail-purple.svg";
import houseIcon from "../../assets/house-purple.svg";
import thumbsUpIcon from "../../assets/hand-thumbs-up-purple.svg";
import arrowRepeatIcon from "../../assets/arrow-repeat-purple.svg";
import checkCircleIcon from "../../assets/check-circle.svg";
import boxArrowUpRightIcon from "../../assets/box-arrow-up-right-white.svg";
import EditMailDetailsModal from "./EditMailDetailsModal";

const ResultPage = ({ completedScanId: scanId }) => {
  const navigate = useNavigate();
  const [scanType, setScanType] = useState(null);
  const [email, setEmail] = useState("");
  const [isEvent, setIsEvent] = useState(false);
  const [resultsPath, setResultsPath] = useState(null);
  const [feedbackFormUrl, setFeedbackFormUrl] = useState(null);
  const [isWindows, setIsWindows] = useState(false);
  const [mailStatus, setMailStatus] = useState("send");
  const [showEditMailDetailsModal, setShowEditMailDetailsModal] =
    useState(false);

  useEffect(() => {
    const getDataForForm = async () => {
      const data = await services.getDataForForm();
      setScanType(data["scanType"]);
      setEmail(data["email"]);
      setIsEvent(data["event"]);
    };
    getDataForForm();

    (async () => {
      setIsWindows(await services.getIsWindows());
    })();
  }, []);

  useEffect(() => {
    const getResultsPath = async () => {
      const resultsPath = await services.getResultsFolderPath(scanId);
      setResultsPath(resultsPath);
    };

    getResultsPath();
  }, []);

  useEffect(() => {
    const getFeedbackFormUrl = async () => {
      const feedbackFormUrl = await services.getFeedbackFormUrl();
      setFeedbackFormUrl(feedbackFormUrl);
    };

    getFeedbackFormUrl();
  }, []);

  const initialSubject = useMemo(() => {
    if (!scanType) {
      return "";
    }

    const { scanUrl } = JSON.parse(window.localStorage.getItem("scanDetails"));

    return `[A11y] ${scanType
      .split(" ")
      .shift()} Scan Results for: ${scanUrl} (${scanType})`;
  }, [scanType]);

  const handleViewReport = () => {
    services.openReport(scanId);
  };

  const handleScanAgain = () => {
    window.sessionStorage.removeItem("latestCustomFlowScanDetails");
    window.sessionStorage.removeItem("latestCustomFlowEncryptionParams");
    navigate("/");
    return;
  };

  const handleOpenResultsFolder = async (e) => {
    e.preventDefault();

    window.services.openResultsFolder(resultsPath);
  };

  const handleSubmitMail = async (finalEmails, finalSubject) => {
    setMailStatus("sending");

    const emails = finalEmails.split(",").join(";");
    const response = await services.mailReport(
      { subject: finalSubject, emailAddresses: emails },
      scanId
    );

    if (response.success) {
      alert("Report successfully mailed");
    } else {
      alert("Report failed to mail");
    }
    setMailStatus("send");
  };

  return (
    <div id="result-page">
      <div id="main-container">
        <div id="main-contents">
          <img alt="" src={checkCircleIcon}></img>
          <h1>Scan completed</h1>
          <p id="download-content">
            You can find the downloaded report at{" "}
            <a href="#" onClick={handleOpenResultsFolder}>
              {resultsPath}
            </a>
            .
          </p>
          <div id="btn-container">
            <Button id="view-button" type="btn-primary" onClick={handleViewReport}>
              <img alt="" src={boxArrowUpRightIcon}></img>
              View report
            </Button>
            {isWindows && isEvent && (
              <>
                {mailStatus === "send" && (
                  <Button
                    id="mail-report-button"
                    type="btn-secondary"
                    onClick={() => setShowEditMailDetailsModal(true)}
                  >
                    <ButtonSvgIcon
                      svgIcon={<MailIcon />}
                      className={`mail-icon`}
                    />
                    Email report
                  </Button>
                )}
                {mailStatus === "sending" && (
                  <Button
                    id="mail-report-button"
                    type="btn-secondary"
                    disabled="disabled"
                  >
                    <ButtonSvgIcon
                      svgIcon={<MailIcon />}
                      className={`mail-icon`}
                    />
                    Sending mail...
                  </Button>
                )}
              </>
            )}
          </div>
          <hr class="my-5" />
          <div id="other-actions">
            <h2>Other actions</h2>
            <ul class="actions-list">
              <li>
                <a
                  href="#"
                  onClick={(e) => {
                    handleClickLink(e, feedbackFormUrl);
                  }}
                >
                  <img alt="" src={thumbsUpIcon}></img>
                  Help us improve
                </a>
              </li>
              <li>
                <hr />
                <Link to="/" onClick={handleScanAgain}>
                  <img alt="" src={houseIcon}></img>
                  Back To Home
                </Link>
              </li>
            </ul>
          </div>
          {showEditMailDetailsModal && (
            <EditMailDetailsModal
              showModal={showEditMailDetailsModal}
              onUpdateShowModal={setShowEditMailDetailsModal}
              onSubmitMail={handleSubmitMail}
              initialEmail={email}
              initialSubject={initialSubject}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ResultPage;
