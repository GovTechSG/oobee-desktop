import { useState, useRef, useEffect } from "react";
import Button from "../../common/components/Button";
import AdvancedScanOptions from "./AdvancedScanOptions";
import {
  scanTypes,
  viewportTypes,
  devices,
  fileTypes,
  getDefaultAdvancedOptions,
} from "../../common/constants";
import ButtonSvgIcon from "../../common/components/ButtonSvgIcon";
import { ReactComponent as ChevronUpIcon } from "../../assets/chevron-up-purple.svg";
import { ReactComponent as ChevronDownIcon } from "../../assets/chevron-down-white.svg";
import LoadingSpinner from "../../common/components/LoadingSpinner";

const InitScanForm = ({
  isProxy,
  startScan,
  prevUrlErrorMessage,
  scanButtonIsClicked,
  setScanButtonIsClicked,
  isAbortingScan,
}) => {
  const [openPageLimitAdjuster, setOpenPageLimitAdjuster] = useState(false);
  const [pageWord, setPageWord] = useState("pages");
  const pageLimitAdjuster = useRef();
  const scanTypeOptions = Object.keys(scanTypes);
  const fileTypesOptions = Object.keys(fileTypes);
  const [selectedFile, setSelectedFile] = useState(null); // State for selected file
  const [fileUrl, setFileUrl] = useState(""); // State for the file URL

  if (isProxy) {
    delete viewportTypes.specific;
  }

  const viewportOptions = viewportTypes;
  const deviceOptions = isProxy ? [] : Object.keys(devices);

  const cachedPageLimit = sessionStorage.getItem("pageLimit");
  const cachedAdvancedOptions = sessionStorage.getItem("advancedOptions");
  const cachedScanUrl = sessionStorage.getItem("scanUrl");

  const [pageLimit, setPageLimit] = useState(() => {
    return cachedPageLimit ? JSON.parse(cachedPageLimit) : "100";
  });
  const [advancedOptions, setAdvancedOptions] = useState(() => {
    return cachedAdvancedOptions
      ? JSON.parse(cachedAdvancedOptions)
      : getDefaultAdvancedOptions(isProxy);
  });

  const [scanUrl, setScanUrl] = useState("") ;

  useEffect(() => {
      const cachedScanUrl = sessionStorage.getItem("scanUrl");
      if (cachedScanUrl) {
        setScanUrl(JSON.parse(cachedScanUrl));
      } else if (advancedOptions.scanType === scanTypeOptions[3]) {
        setScanUrl("file:///");
      } else {
        setScanUrl("https://");
      }
    }, [advancedOptions.scanType]);

  useEffect(() => {
    const urlBarElem = document.getElementById("url-bar");
    const urlBarInputList = urlBarElem.querySelectorAll("input, button");
    urlBarInputList.forEach((elem) => (elem.disabled = scanButtonIsClicked));
    setOpenPageLimitAdjuster(false);
  }, [scanButtonIsClicked, prevUrlErrorMessage]);

  useEffect(() => {
    setPageWord(pageLimit === "1" ? "page" : "pages");
  }, [pageLimit]);

  const togglePageLimitAdjuster = (e) => {
    if (!e.currentTarget.disabled) {
      if (!openPageLimitAdjuster) {
        setOpenPageLimitAdjuster(true);
      } else {
        pageLimitAdjuster.current.style.animationName = "button-fade-out";
        setTimeout(() => setOpenPageLimitAdjuster(false), 200);
      }
    }
  };

  const handleScanButtonClicked = () => {
    if (isProxy && advancedOptions.viewport === viewportTypes.mobile) {
      advancedOptions.viewport = viewportTypes.custom;
      advancedOptions.viewportWidth = 414;
    }

    setScanButtonIsClicked(true);
    sessionStorage.setItem("pageLimit", JSON.stringify(pageLimit));
    sessionStorage.setItem("advancedOptions", JSON.stringify(advancedOptions));
    sessionStorage.setItem("scanUrl", JSON.stringify(scanUrl));
    if (advancedOptions.scanType === scanTypeOptions[3] && selectedFile) {
      startScan({ file: selectedFile, scanUrl, pageLimit, ...advancedOptions });
    } else {
      startScan({ scanUrl: scanUrl.trim(), pageLimit, ...advancedOptions });
    }
  };

  // styles are in HomePage.scss
  return (
    <div id="init-scan-form">
      <label htmlFor="url-input" id="url-bar-label">
        Enter your URL to get started
      </label>
      <div id="url-bar-group">
        <div id="url-bar">
          <input
            id="url-input"
            type="text"
            value={scanUrl}
            onChange={(e) => setScanUrl(e.target.value)}
            style={{
              display:
                advancedOptions.scanType === scanTypeOptions[3]
                  ? "none"
                  : "block",
            }} // Hide URL input for file scan
          />
          {advancedOptions.scanType === scanTypeOptions[3] && (
            <div id="file-input-container">
              <input
                type="file"
                id="file-input"
                accept=".xml"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (file) {
                    setScanUrl("file://" + file.path);
                  }
                }}
              />
              <label htmlFor="file-input" id="file-input-label">
                {scanUrl ? scanUrl : "Choose file"}
              </label>
            </div>
          )}

          {advancedOptions.scanType !== scanTypeOptions[2] &&
            advancedOptions.scanType !== scanTypeOptions[3] && (
              <div>
                <Button
                  type="btn-link"
                  id="page-limit-toggle-button"
                  onClick={(e) => togglePageLimitAdjuster(e)}
                >
                  capped at{" "}
                  <span className="purple-text">
                    {pageLimit} {pageWord}{" "}
                    {openPageLimitAdjuster ? (
                      <ButtonSvgIcon
                        className={`chevron-up-icon`}
                        svgIcon={<ChevronUpIcon />}
                      />
                    ) : (
                      // <i className="bi bi-chevron-up" />
                      <ButtonSvgIcon
                        className={`chevron-down-icon`}
                        svgIcon={<ChevronDownIcon />}
                      />
                      // <i className="bi bi-chevron-down" />
                    )}
                  </span>
                </Button>
                {openPageLimitAdjuster && (
                  <div id="page-limit-adjuster" ref={pageLimitAdjuster}>
                    <input
                      type="number"
                      id="page-limit-input"
                      step="10"
                      min="1"
                      value={pageLimit}
                      onChange={(e) => setPageLimit(e.target.value)}
                      onBlur={(e) => {
                        if (Number(e.target.value) <= 0) {
                          setPageLimit(1);
                        }
                      }}
                    />
                    <label htmlFor="page-limit-input">{pageWord}</label>
                  </div>
                )}
              </div>
            )}
          <Button
            type="btn-primary"
            className="scan-btn"
            onClick={handleScanButtonClicked}
            disabled={scanButtonIsClicked || isAbortingScan}
          >
            {scanButtonIsClicked || isAbortingScan ? (
              <LoadingSpinner></LoadingSpinner>
            ) : (
              "Scan"
            )}
          </Button>
        </div>
        {prevUrlErrorMessage && (
          <span id="url-error-message" className="error-text">
            {prevUrlErrorMessage}
          </span>
        )}
      </div>
      <AdvancedScanOptions
        isProxy={isProxy}
        scanTypeOptions={scanTypeOptions}
        fileTypesOptions={fileTypesOptions}
        viewportOptions={viewportOptions}
        deviceOptions={deviceOptions}
        advancedOptions={advancedOptions}
        setAdvancedOptions={setAdvancedOptions}
        scanButtonIsClicked={scanButtonIsClicked}
      />
    </div>
  );
};

export default InitScanForm;
