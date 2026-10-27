import { handleClickLink,installChromeUrl } from "../../common/constants";
import Modal from "../../common/components/Modal";
import { useTranslation } from "../../i18n";

const NoChromeErrorModal = ({showModal, setShowModal}) => {
    const { t } = useTranslation();
    const onClickInstallChrome = (e) => {
        handleClickLink(e, installChromeUrl);
        setShowModal(false);
    }

    return (
        <Modal
            id='no-chrome-browser-modal'
            showModal={showModal}
            showHeader={true}
            modalTitle={t('noChrome.title')}
            modalBody={t('noChrome.body')}
            modalFooter={
                <button className='btn-primary modal-button modal-full-button' onClick={(e) => onClickInstallChrome(e)}>{t('noChrome.download')}</button>
            }
            setShowModal={setShowModal}
        />
    )
}

export default NoChromeErrorModal;