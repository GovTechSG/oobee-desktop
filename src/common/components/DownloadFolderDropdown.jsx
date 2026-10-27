import folder from "../../assets/folder-grey.svg";
import { useEffect, useState } from "react";
import services from "../../services";
import editIcon from "../../assets/edit-pencil-purple.svg";
import { useTranslation } from "../../i18n";

const DownloadFolderDropdown = ({
  isOnboarding
}) => {
    const { t } = useTranslation();
    const dropdownClassName = isOnboarding ? "download-dropdown fade-in-left" : "download-dropdown";
    const [exportDir, setExportDir] = useState();
    
    useEffect(() => {
        const getExportDir = async () => {
            const userData = await services.getUserData();
            setExportDir(userData.exportDir);
        };

        getExportDir();
    }, [])


    const handleSetExportDir = async (e) => { 
      if (!e.currentTarget.disabled) {
        const exportDir = await window.services.setExportDir(); 
        setExportDir(exportDir);
      } 
    }

    return (
        <div className={dropdownClassName}>
          <button className="dir-info-button download-dropdown-btn" aria-describedby="download-folder-label" onClick={(e) => handleSetExportDir(e)}>
            <div className="d-flex download-path">
              <img src={folder}></img>
              <span id="dir-info">{exportDir}</span>
            </div>
            <div className="change-download-btn">
              <img src={editIcon} aria-label={t("download.change")}></img>
            </div>
        </button>
      </div>
    )
}

export default DownloadFolderDropdown;