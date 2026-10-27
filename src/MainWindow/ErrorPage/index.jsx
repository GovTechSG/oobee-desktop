import Button from "../../common/components/Button";
import ButtonSvgIcon from "../../common/components/ButtonSvgIcon";
import "./ErrorPage.scss";
import { useNavigate, useLocation } from "react-router";
import { ReactComponent as ExclamationCircleIcon } from "../../assets/exclamation-circle.svg";
import { useState, useEffect } from "react";
import { errorStates } from "../../common/constants";
import services from "../../services"
import { useTranslation } from "../../i18n";

const ErrorPage = () => {
  const { t } = useTranslation();
  const { state } = useLocation();
  const navigate = useNavigate();
  const [ errorState, setErrorState ] = useState('');
  const [errorLog, setErrorLog] = useState(null);

  useEffect(() => {
    if (state?.errorState) setErrorState(state.errorState);
    const getErrorLog = async () => {
      const timeOfScan = state?.timeOfScan;
      const timeOfError = new Date();
      const log = await services.getErrorLog(timeOfScan, timeOfError);
      setErrorLog(log);
    }
    getErrorLog();
  }, []);

  const handleBackToHome = () => {
    navigate("/");
    return;
  }

  const errorMessageToDisplay = () => {
    switch (errorState) {
      case errorStates.browserError:
        return (
          <>
            <h1>{t("errorPage.browserTitle")}</h1>
            <p>{t("errorPage.browserDesc")}</p>
          </>
        )
      case errorStates.noPagesScannedError:
        return (<><h1>{t("errorPage.noPagesScanned")}</h1></>)
      default:
        return (<><h1>{t("errorPage.somethingWrong")}</h1></>)
    }

  }

  const copyErrorLog = async () => {
    await navigator.clipboard.writeText(errorLog);
    const result = await window.services.openErrorLog();
    if (!result?.success) {
      alert(t("errorPage.logCopied"));
    }
  }

  return (
    <div id="error-page">
      <ButtonSvgIcon
        className={`exclamation-circle-icon`}
        svgIcon={<ExclamationCircleIcon />}
      />
      {errorMessageToDisplay()}
      <div class='btn-container'>
        <Button role="link" type="btn-primary" onClick={handleBackToHome}>
          {t("errorPage.tryAgain")}
        </Button>
        {errorLog && <Button type="btn-secondary" onClick={copyErrorLog}>{t("errorPage.copyLog")}</Button>}

      </div>
    </div>
  );
};

export default ErrorPage;


