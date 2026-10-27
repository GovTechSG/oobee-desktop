import { useState, useEffect, useRef } from "react";
import { useTranslation } from "../i18n";

const ConnectionNotification = () => {
  const { t } = useTranslation();
  const [noConnection, setNoConnection] = useState(false);
  const [reconnected, setReconnected] = useState(false);
  const ref = useRef();
  const hideNotificationTimeout = useRef();

  useEffect(() => {
    const handleNoConnection = () => {
        if (reconnected) {
          ref.current.classList.remove("reconnected");
          clearTimeout(hideNotificationTimeout.current);
          setReconnected(false);
        }
    
        setNoConnection(true);

        window.addEventListener(
          "online",
          () => {
            setReconnected(true);
            ref.current.classList.add("reconnected");
            hideNotificationTimeout.current = setTimeout(() => {
              setNoConnection(false);
              setReconnected(false);
            }, 3800);
          },
          { once: true }
        );
      };

    window.addEventListener("offline", handleNoConnection);
    return () => window.removeEventListener("offline", handleNoConnection);
  });

  if (!noConnection) {
    return null;
  }

  return (
    <div id="connection-notification" ref={ref}>
      {reconnected ? t("connection.restored") : t("connection.none")}
    </div>
  );
};

export default ConnectionNotification;
