import Modal from "../../common/components/Modal";
import boxRightArrow from "../../assets/box-arrow-up-right-purple.svg";
import { createElement } from "react";
import { handleClickLink } from "../../common/constants";

const WhatsNewModal = ({
  showModal,
  setShowModal,
  version,
  releaseNotes,
}) => {

  // create react elements from release notes html string
  const getReleaseNotes = () => {
    // inject parsed release notes into div element
    const releaseNotesNode = document.createElement("div");
    releaseNotesNode.innerHTML = releaseNotes;

    // remove unneeded info
    const allElements = releaseNotesNode.childNodes;
    const toRemoveUpToId = "whatsnew";
    for (const element of allElements) {
      element.remove();
      if (element.id === toRemoveUpToId) break;
    }

    const headings = releaseNotesNode.getElementsByTagName("h4");
    const headingsLen = headings.length;
    const uls = releaseNotesNode.getElementsByTagName("ul");
    const reactElems = [];
    for (let i = 0; i < headingsLen; i++) {
      const heading = headings[i];
      const ul = uls[i];

      const headingElem = createElement("h4", {}, heading.innerHTML);
      const liElems = [];
      for (let li of ul.getElementsByTagName("li")) {
        const liChildren = li.childNodes;
        const liChildElems = [];
        for (let child of liChildren) {
          const tag = child.nodeName;
          if (tag === "#text") {
            liChildElems.push(child.textContent);
          } else {
            liChildElems.push(createElement(tag.toLowerCase(), {}, child.innerText));
          }
        }
        const liElem = createElement("li", {}, ...liChildElems);
        liElems.push(liElem);
      }
      const ulElem = createElement("ul", {}, ...liElems);
      const section = createElement("div", { className: "whats-new-section" }, headingElem, ulElem);
      reactElems.push(section);
    }
    return reactElems;
  };

  const getGithubLink = () => {
    return (
      <a
        href="#"
        role="link"
        onClick={(e) => handleClickLink(e, "https://github.com/GovTechSG/oobee-desktop/releases/")}
      >
        See previous versions{" "}
        <img className="external-link" src={boxRightArrow}></img>
      </a>
    );
  };

  return (
    <Modal
      id="whats-new-modal"
      showModal={showModal}
      showHeader={true}
      modalBody={[...getReleaseNotes(), getGithubLink()]}
      modalSizeClass="modal-lg modal-dialog-centered"
      modalTitle={"What's new in v" + version}
      setShowModal={setShowModal}
    />
  );
};

export default WhatsNewModal;
