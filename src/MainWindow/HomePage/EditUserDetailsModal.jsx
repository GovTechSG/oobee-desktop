import { useState } from "react";
import { PolicyLink } from "../../common/constants";
import Modal from "../../common/components/Modal";
import UserDetailsForm from "../../common/components/UserDetailsForm";
import { useTranslation } from "../../i18n";

const EditUserDetailsModal = ({
  id,
  formID,
  showModal,
  initialName,
  initialEmail,
  initialTelemetryOptOut = false,
  setShowEditDataModal,
  setUserData,
}) => {
  const { t, localeInfo, refreshLocaleInfo } = useTranslation();
  const showTelemetryOptOut = localeInfo.telemetryOptOutAvailable;
  const [editedName, setEditedName] = useState(initialName);
  const [editedEmail, setEditedEmail] = useState(initialEmail);
  const [editedTelemetryOptOut, setEditedTelemetryOptOut] = useState(initialTelemetryOptOut);
  const [nameInputErrorMessage, setNameInputErrorMessage] = useState(null);
  const [emailInputErrorMessage, setEmailInputErrorMessage] = useState(null);

  const isOptedOut = showTelemetryOptOut && editedTelemetryOptOut;
  const isUnchanged =
    editedName === initialName &&
    editedEmail === initialEmail &&
    editedTelemetryOptOut === initialTelemetryOptOut;

  const isSubmitDisabled =
    isUnchanged ||
    (!isOptedOut &&
      (editedName.trim() === "" ||
        editedEmail.trim() === "" ||
        nameInputErrorMessage ||
        emailInputErrorMessage));

  const handleEditUserData = () => {
    const name = isOptedOut ? "" : editedName;
    const email = isOptedOut ? "" : editedEmail;
    const update = { name, email };
    if (showTelemetryOptOut) update.telemetryOptOut = isOptedOut;
    window.services.editUserData(update);
    setShowEditDataModal(false);
    setUserData((userData) => ({ ...userData, ...update }));
    refreshLocaleInfo();
  };

  const setShowModal = (show) => {
    setEditedEmail(initialEmail);
    setEditedName(initialName);
    setEditedTelemetryOptOut(initialTelemetryOptOut);
    setEmailInputErrorMessage(null);
    setNameInputErrorMessage(null);
    setShowEditDataModal(show);
  };

  const policy = (text) => <PolicyLink>{text}</PolicyLink>;

  if (showModal) {
    return (
      <Modal
        id={id}
        showModal={showModal}
        showHeader={true}
        modalTitle={t("editProfile.title")}
        modalSizeClass="modal-dialog-centered"
        modalBody={
          <>
            <UserDetailsForm
              formID={formID}
              name={editedName}
              email={editedEmail}
              setName={setEditedName}
              setEmail={setEditedEmail}
              handleOnSubmit={handleEditUserData}
              nameInputErrorMessage={nameInputErrorMessage}
              emailInputErrorMessage={emailInputErrorMessage}
              setNameInputErrorMessage={setNameInputErrorMessage}
              setEmailInputErrorMessage={setEmailInputErrorMessage}
              showTelemetryOptOut={showTelemetryOptOut}
              telemetryOptOut={editedTelemetryOptOut}
              setTelemetryOptOut={setEditedTelemetryOptOut}
            />
            <p>
              {isOptedOut
                ? t("telemetry.optedOutDesc")
                : t("editProfile.consentDesc", { policy })}
            </p>
            {initialTelemetryOptOut && !editedTelemetryOptOut && (
              <p className="telemetry-opt-out-hint">
                {t("telemetry.optInRestartNote")}
              </p>
            )}
          </>
        }
        modalFooter={
          <button
            type="submit"
            form={formID}
            className={`btn-primary modal-button`}
            disabled={isSubmitDisabled}
          >
            {t("common.update")}
          </button>
        }
        setShowModal={setShowModal}
      />
    );
  }
};

export default EditUserDetailsModal;
