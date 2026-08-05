import Modal from "../../common/components/Modal";
import boxRightArrow from "../../assets/box-arrow-up-right-purple.svg";
import { createElement } from "react";
import { handleClickLink } from "../../common/constants";

const WhatsNewModal = ({
  showModal,
  setShowModal,
  version,
  releaseNotes,
  title,
  modalId,
  // When true, render `releaseNotes` as raw HTML instead of walking it as
  // release-notes structure (h4 sections + bullet lists). Also hides the
  // "See previous versions" GitHub link. Used by the announcement modal,
  // whose author-supplied markdown may use any structure (h3s, paragraphs,
  // plain text) that the release-notes parser would strip to nothing.
  rawHtml = false,
  // Repo root URL for building the "See previous versions" link. Sourced
  // from `baseUrl` in latest-release.json so a repo migration/rename doesn't
  // require a client rebuild. If missing, the link is hidden entirely.
  baseUrl,
}) => {
  // Event-delegated click handler for the whole modal body. Catches any
  // <a href> click — regardless of whether it came from the release-notes
  // parser, dangerouslySetInnerHTML, or a hand-rolled JSX anchor — and
  // routes it through shell.openExternal so the URL opens in the user's
  // default OS browser instead of hijacking the Electron window.
  const handleAnchorClick = (e) => {
    const anchor = e.target.closest("a[href]");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || href === "#") return;
    handleClickLink(e, href);
  };

  // create react elements from release notes html string
  const getReleaseNotes = () => {
    // inject parsed release notes into div element
    const releaseNotesNode = document.createElement("div");
    releaseNotesNode.innerHTML = releaseNotes;

    // remove unneeded info
    const allElements = releaseNotesNode.childNodes;
    const toRemoveUpToId = "whats-new";
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
          } else if (tag === "A") {
            // Preserve the real href — the parent modal-body div has a
            // delegated click handler that intercepts every anchor click
            // and routes it through shell.openExternal, so we don't need
            // per-anchor onClick handlers here.
            const href = child.getAttribute("href");
            liChildElems.push(
              createElement("a", { href }, child.textContent)
            );
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
    if (typeof baseUrl !== "string" || baseUrl.length === 0) return null;
    // Strip a trailing slash so we don't build "…//releases/".
    const releasesUrl = baseUrl.replace(/\/$/, "") + "/releases/";
    return (
      <a href={releasesUrl}>
        See previous versions{" "}
        <img className="external-link" src={boxRightArrow}></img>
      </a>
    );
  };

  const innerBody = rawHtml
    ? (
      <div
        className="whats-new-section"
        dangerouslySetInnerHTML={{ __html: releaseNotes || "" }}
      />
    )
    : [...getReleaseNotes(), getGithubLink()];

  const modalBody = <div onClick={handleAnchorClick}>{innerBody}</div>;

  return (
    <Modal
      id={modalId || "whats-new-modal"}
      showModal={showModal}
      showHeader={true}
      modalBody={modalBody}
      modalSizeClass="modal-lg modal-dialog-centered"
      modalTitle={title || ("What's new in v" + version)}
      setShowModal={setShowModal}
    />
  );
};

export default WhatsNewModal;
