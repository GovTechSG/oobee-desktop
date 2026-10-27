import React, { useEffect } from "react";
import { useTranslation } from "../../i18n";

const Modal = ({
  id,
  key,
  showModal,
  showHeader,
  isOnboarding,
  modalTitle,
  modalBody,
  modalFooter,
  setShowModal,
  modalSizeClass = "",
  hideCloseButton,
}) => {
  const { t } = useTranslation();
  const modalClassName = getModalClassName(showModal, isOnboarding);
  const modalHeaderClassName = showHeader
    ? "modal-header show"
    : "modal-header hide";
  const modalBodyClassName = isOnboarding
    ? "modal-body text-center"
    : "modal-body";

  useEffect(() => {
    const modalBodyElement = document.querySelector(".modal-body");
    if (isOnboarding) {
      modalBodyElement.setAttribute("tabindex", "-1");
    }

    return () => {
      modalBodyElement.removeAttribute("tabindex");
    };
  }, [isOnboarding]);

  useEffect(() => {
    if (!showModal) {
      return () => {};
    }
    const modalElement = document.querySelector(`#${id}`);

    const handleTabKey = (event) => {
      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = Array.from(
        modalElement.querySelectorAll("button:not([disabled]), a, input")
      ).filter((el) => {
        const computedStyle = getComputedStyle(el);
        return computedStyle?.visibility !== "hidden";
      });
      if (focusableElements.length === 0) return;
      
      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement =
        focusableElements[focusableElements.length - 1];

      if (!modalElement.contains(event.target)) {
        event.preventDefault();
        firstFocusableElement.focus();
      } else if (event.shiftKey && event.target === firstFocusableElement) {
        event.preventDefault();
        lastFocusableElement.focus();
      } else if (!event.shiftKey && event.target === lastFocusableElement) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    };

    const handleEscapeKey = (event) => {
      if (event.key !== "Escape") {
        return;
      }

      // only apply for modals with close button displayed
      if (showHeader) {
        setShowModal(false);
      }
    };

    document.addEventListener("keydown", handleTabKey);
    document.addEventListener("keydown", handleEscapeKey);

    return () => {
      document.removeEventListener("keydown", handleTabKey);
      document.removeEventListener("keydown", handleEscapeKey);
    };
  }, [setShowModal, showHeader, id, showModal]);

  return (
    <div className={modalClassName} id={id}>
      <div className={`modal-dialog ${modalSizeClass}`}>
        <div className="modal-content">
          <div className={modalHeaderClassName}>
            <h3 className="modal-title" defaultValue={"modalTitle"}>
              {modalTitle}
            </h3>
            {!hideCloseButton && (
              <button
                type="button"
                className="btn-close"
                onClick={() => setShowModal(false)}
                aria-label={t("common.close")}
                aria-controls={id}
              />
            )}
          </div>
          <div className={modalBodyClassName} key={key}>
            {modalBody}
          </div>
          <div className="modal-footer">{modalFooter}</div>
        </div>
      </div>
    </div>
  );
};

const getModalClassName = (showModal, isOnboarding) => {
  let modalClassName;
  if (showModal) {
    modalClassName = "modal fade show";
    if (isOnboarding) {
      modalClassName = "onboarding-modal " + modalClassName;
    }
  } else {
    modalClassName = "modal d-none";
  }
  return modalClassName;
};

export default Modal;
