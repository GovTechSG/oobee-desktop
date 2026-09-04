import { useEffect, useState } from "react";
import Button from "../../common/components/Button";
import "./ResultPage.scss";
import services from "../../services";
import { Link, useNavigate } from "react-router";
import { handleClickLink } from "../../common/constants";
import houseIcon from "../../assets/house-purple.svg";
import thumbsUpIcon from "../../assets/hand-thumbs-up-purple.svg";
import checkCircleIcon from "../../assets/check-circle.svg";
import boxArrowUpRightIcon from "../../assets/box-arrow-up-right-white.svg";

const ResultPage = ({ completedScanId: scanId }) => {
  const navigate = useNavigate();
  const [resultsPath, setResultsPath] = useState(null);
  const [feedbackFormUrl, setFeedbackFormUrl] = useState(null);

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
        </div>
      </div>
    </div>
  );
};

export default ResultPage;
