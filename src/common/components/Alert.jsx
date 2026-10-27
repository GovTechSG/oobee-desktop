import { useTranslation } from "../../i18n";

const Alert = ({ alertClassName, children, icon, onClose }) => {
  const { t } = useTranslation();
  return (
    <div
      className={`alert d-flex flex-row ${alertClassName ? alertClassName : ""}`}
      role="alert"
    >
      {
        icon &&
        <div className="me-2">
          <img src={icon} alt="" />
        </div>
      }

      <div className="d-flex flex-grow-1">
        {children}
      </div>

      {
        onClose && (
          <button
            type="button"
            className="btn-close"
            aria-label={t("common.closeAlert")}
            onClick={onClose}
          />
        )
      }
    </div>
  );
};

export default Alert;