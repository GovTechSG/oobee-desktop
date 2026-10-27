import services from "../../services";
import { useTranslation } from "../../i18n";

const UserDetailsForm = ({
  formID,
  name,
  email,
  setName,
  setEmail,
  handleOnSubmit,
  nameInputErrorMessage,
  emailInputErrorMessage,
  setNameInputErrorMessage,
  setEmailInputErrorMessage,
  isOnboarding,
  // Telemetry opt-out (only rendered when showTelemetryOptOut is true, i.e.
  // the user's OS region is outside Singapore or they already opted out).
  showTelemetryOptOut = false,
  telemetryOptOut = false,
  setTelemetryOptOut,
}) => {
  const { t } = useTranslation();
  const userFormClassName = isOnboarding
    ? "user-form fade-in-left"
    : "user-form";
  const isOptedOut = showTelemetryOptOut && telemetryOptOut;

  const validateName = () => {
    if (!services.isValidName(name)) {
      setNameInputErrorMessage(t("userForm.invalidName"));
      return false;
    }

    return true;
  };

  const validateEmail = () => {
    if (!services.isValidEmail(email)) {
      setEmailInputErrorMessage(t("userForm.invalidEmail"));
      return false;
    }

    return true;
  };

  const onHandleNameChange = (e) => {
    setNameInputErrorMessage(null);
    setName(e.target.value);
  };

  const onHandleEmailChange = (e) => {
    setEmailInputErrorMessage(null);
    setEmail(e.target.value);
  };

  const onHandleTelemetryOptOutChange = (e) => {
    const checked = e.target.checked;
    setTelemetryOptOut(checked);
    if (checked) {
      // Opting out blanks out name and e-mail.
      setName("");
      setEmail("");
      setNameInputErrorMessage(null);
      setEmailInputErrorMessage(null);
    }
  };

  const onSubmitHandler = (e) => {
    e.preventDefault();

    if (!isOptedOut) {
      const validated = validateName() && validateEmail();
      if (!validated) return;
    }

    handleOnSubmit();
  };

  return (
    <div className={userFormClassName}>
      <form id={formID} onSubmit={onSubmitHandler}>
        <div className="user-form-field">
          <label className="user-form-label" htmlFor="name">
            {t("userForm.name")}
          </label>
          <input
            className="user-form-input"
            type="text"
            id="name"
            value={name}
            onChange={onHandleNameChange}
            onBlur={isOptedOut ? undefined : validateName}
            disabled={isOptedOut}
            aria-describedby="invalid-name-error"
            aria-invalid={!!nameInputErrorMessage}
          ></input>
        </div>
        <div className="user-form-error error-text" id="invalid-name-error">
          {nameInputErrorMessage}
        </div>
        <div className="user-form-field">
          <label className="user-form-label" htmlFor="email">
            {t("userForm.workEmail")}
          </label>
          <input
            className="user-form-input"
            type="text"
            id="email"
            value={email}
            onChange={onHandleEmailChange}
            onBlur={isOptedOut ? undefined : validateEmail}
            disabled={isOptedOut}
            aria-describedby="invalid-email-error"
            aria-invalid={!!emailInputErrorMessage}
          ></input>
        </div>
        <div className="user-form-error error-text" id="invalid-email-error">
          {emailInputErrorMessage}
        </div>
        {showTelemetryOptOut && (
          <div className="telemetry-opt-out">
            <input
              type="checkbox"
              id={`${formID}-telemetry-opt-out`}
              checked={telemetryOptOut}
              onChange={onHandleTelemetryOptOutChange}
              aria-describedby={
                telemetryOptOut ? undefined : `${formID}-telemetry-opt-out-hint`
              }
            />
            <div>
              <label htmlFor={`${formID}-telemetry-opt-out`}>
                {t("telemetry.optOutLabel")}
              </label>
              {/* Once ticked, the parent shows telemetry.optedOutDesc instead. */}
              {!telemetryOptOut && (
                <p
                  className="telemetry-opt-out-hint"
                  id={`${formID}-telemetry-opt-out-hint`}
                >
                  {t("telemetry.optOutHint")}
                </p>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
};

export default UserDetailsForm;