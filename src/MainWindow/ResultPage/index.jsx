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
import { useTranslation } from "../../i18n";

const ResultPage = ({ completedScanId: scanId }) => {
  const { t } = useTranslation();
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
    // Legacy cleanup: the removed /custom_flow page stored the last custom
    // flow scan details (including the scan URL) here and never cleared it.
    window.localStorage.removeItem("latestCustomFlowScanDetails");
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
          <h1>{t("result.title")}</h1>
          <p id="download-content">
            {t("result.downloadLocation", {
              path: resultsPath,
              link: (text) => (
                <a href="#" onClick={handleOpenResultsFolder}>
                  {text}
                </a>
              ),
            })}
          </p>
          <div id="btn-container">
            <Button id="view-button" type="btn-primary" onClick={handleViewReport}>
              <img alt="" src={boxArrowUpRightIcon}></img>
              {t("result.viewReport")}
            </Button>
          </div>
          <hr class="my-5" />
          <div id="other-actions">
            <h2>{t("result.otherActions")}</h2>
            <ul class="actions-list">
              <li>
                <a
                  href="#"
                  onClick={(e) => {
                    handleClickLink(e, feedbackFormUrl);
                  }}
                >
                  <img alt="" src={thumbsUpIcon}></img>
                  {t("result.helpImprove")}
                </a>
              </li>
              <li>
                <hr />
                <Link to="/" onClick={handleScanAgain}>
                  <img alt="" src={houseIcon}></img>
                  {t("result.backToHome")}
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
