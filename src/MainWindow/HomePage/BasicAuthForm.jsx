import React from "react";
import { useTranslation } from "../../i18n";

export const BasicAuthForm = ({ handleBasicAuthSubmit }) => {
  const { t } = useTranslation();
  return (
    <div className="user-form">
      <form
        id="home-page-basic-auth-form"
        onSubmit={(e) => handleBasicAuthSubmit(e)}
      >
        <div className="user-form-field">
          <label className="user-form-label" htmlFor="username">
            {t("basicAuth.username")}
          </label>
          <input
            className="user-form-input"
            type="text"
            id="username"
            name="username"
          />
        </div>
        <div className="user-form-field">
          <label className="user-form-label" htmlFor="password">
            {t("basicAuth.password")}
          </label>
          <input
            className="user-form-input"
            type="password"
            id="password"
            name="password"
          />
        </div>
      </form>
    </div>
  );
};

export const BasicAuthFormFooter = ({ setShowBasicAuthModal }) => {
  const { t } = useTranslation();
  return (
    <>
      <button
        className="modal-button btn-secondary"
        aria-controls="basic-auth-modal"
        onClick={() => setShowBasicAuthModal(false)}
      >
        {t("common.close")}
      </button>
      <button
        form="home-page-basic-auth-form"
        className="modal-button btn-primary"
        type="submit"
      >
        {t("common.scan")}
      </button>
    </>
  );
};
