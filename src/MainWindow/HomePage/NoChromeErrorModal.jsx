import { handleClickLink,installChromeUrl } from "../../common/constants";
import Modal from "../../common/components/Modal";

const NoChromeErrorModal = ({showModal, setShowModal}) => {
    const onClickInstallChrome = (e) => {
        handleClickLink(e, installChromeUrl);
        setShowModal(false);
    }

    return (
        <Modal
            id='no-chrome-browser-modal'
            showModal={showModal}
            showHeader={true}
            modalTitle={'Please install Google Chrome'}
            modalBody={'To run a scan using Oobee, please install Google Chrome.'}
            modalFooter={
                <button className='btn-primary modal-button modal-full-button' onClick={(e) => onClickInstallChrome(e)}>Download Google Chrome</button>
            }
            setShowModal={setShowModal}
        />
    )
}

export default NoChromeErrorModal;