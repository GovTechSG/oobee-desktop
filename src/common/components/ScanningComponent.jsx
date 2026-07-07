import { useEffect, useState } from "react";
import LoadingSpinner from "../../common/components/LoadingSpinner";
import checkIcon from "../../assets/check-circle.svg";
import slashCircleIcon from "../../assets/slash-circle.svg";
import crossCircleIcon from "../../assets/cross-circle.svg";
import LoadingScanningStatus from "./LoadingScanningStatus";

const ScanningComponent = ({ scanningMessage }) => {
  const [urlItems, setUrlItems] = useState([]);
  const [urlItemComponents, setUrlItemComponents] = useState([]);
  const [pagesScanned, setPagesScanned] = useState(0);
  const [displayPageNum, setDisplayPageNum] = useState(0);
  const [scanCompleted, setScanCompleted] = useState(false);
  const [displayPageWord, setDisplayPageWord] = useState("page");
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);

  useEffect(() => {
    window.services.generatingReport(() => {
      setIsGeneratingReport(true);
    });
  }, []);

  useEffect(() => {
    window.services.scanningUrl((urlItem) => {
      if (urlItem.status === "scanned") {
        setDisplayPageNum(urlItem.urlScannedNum);
        setPagesScanned(urlItem.urlScannedNum);
      } else {
        setPagesScanned((prev) => {
          setDisplayPageNum(prev);
          return prev;
        });
      }

      setUrlItems((prev) => {
        const newUrlItems = [urlItem, ...prev].slice(0, 50);
        setUrlItemComponents(
          newUrlItems.map((item, index) => (
            <UrlItemComponent key={index} index={index} urlItem={item} />
          ))
        );
        return newUrlItems;
      });
    });

    window.services.scanningCompleted(() => {
      setPagesScanned((prev) => {
        setDisplayPageNum(prev);
        return prev;
      });
      setUrlItems((prev) => {
        setUrlItemComponents(
          prev.slice(0, 50).map((item, index) => (
            <UrlItemComponent
              key={index}
              index={index}
              urlItem={item}
              scanCompleted={true}
            />
          ))
        );
        return prev;
      });
      setScanCompleted(true);
    });

    return () => {
      window.services.removeAllScanListeners();
    };
  }, []);

  useEffect(() => {
    setDisplayPageWord(displayPageNum === 1 ? "page" : "pages");
  }, [displayPageNum]);

  const UrlItemComponent = ({ index, urlItem, scanCompleted }) => {
    const isMostRecent = index === 0;
    const urlItemClassName = !isMostRecent
      ? "scanning-url-list-item fade-in-top"
      : "scanning-url-list-item";
    const statusIcon = () => {
      if (isMostRecent && !scanCompleted) {
        return <LoadingSpinner></LoadingSpinner>;
      } else {
        switch (urlItem.status) {
          case "scanned": {
            return <img className="scanning-check-icon" src={checkIcon}></img>;
          }
          case "skipped": {
            return (
              <img className="scanning-check-icon" src={slashCircleIcon}></img>
            );
          }
          case "error": {
            return (
              <img className="scanning-check-icon" src={crossCircleIcon}></img>
            );
          }
        }
      }
    };
    return (
      <li className={urlItemClassName} key={index}>
        {statusIcon()}
        <p className="scanning-url">{urlItem.url}</p>
      </li>
    );
  };
  return (
    <div className="scanning-component">
      {isGeneratingReport ? (
        <LoadingScanningStatus scanningMessage="Finalising your report, please give it some time." />
      ) : urlItems.length > 0 ? (
        <>
          <h1 className="scanning-url-title">
            Scanned: {displayPageNum} {displayPageWord}
          </h1>
          <div className="scanning-url-list-container">
            <ul className="scanning-url-list">{urlItemComponents}</ul>
            <div className="blurred-overlay"></div>
          </div>
        </>
      ) : (
        <LoadingScanningStatus scanningMessage={scanningMessage} />
      )}
    </div>
  );
};

export default ScanningComponent;
