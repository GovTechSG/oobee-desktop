import Modal from "../../common/components/Modal";
import boxRightArrow from "../../assets/box-arrow-up-right-purple.svg";
import { createElement } from "react";
import { handleClickLink } from "../../common/constants";

// Attribute names that need renaming when converting HTML → React props.
// Only the ones we're likely to encounter in release-notes / announcement
// markdown output — extend as needed.
const HTML_TO_REACT_ATTR = {
  class: "className",
  for: "htmlFor",
};

// Walk an HTML DOM node and produce a React element tree. Every <a href>
// gets the external-link icon appended as an extra child so hyperlinks in
// markdown-authored release notes / announcements have the same visual
// affordance as the built-in "See previous versions" link.
const htmlNodeToReact = (node, key) => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  const props = { key };
  for (const attr of node.attributes) {
    const name = HTML_TO_REACT_ATTR[attr.name] || attr.name;
    props[name] = attr.value;
  }
  const children = Array.from(node.childNodes).map((c, i) => htmlNodeToReact(c, i));
  if (tag === "a" && props.href) {
    children.push(
      createElement("img", {
        key: "__external_icon",
        className: "external-link",
        src: boxRightArrow,
      })
    );
  }
  return createElement(tag, props, ...children);
};

const htmlStringToReact = (html) => {
  if (typeof html !== "string" || html.length === 0) return null;
  const container = document.createElement("div");
  container.innerHTML = html;
  return Array.from(container.childNodes).map((c, i) => htmlNodeToReact(c, i));
};

const WhatsNewModal = ({
  showModal,
  setShowModal,
  version,
  releaseNotes,
  title,
  modalId,
  // When true, render `releaseNotes` as free-form HTML (any structure of
  // headings/paragraphs/lists) rather than walking it as release-notes
  // structure (h4 sections + bullet lists). Also hides the "See previous
  // versions" GitHub link. Used by the announcement modal.
  rawHtml = false,
  // Repo root URL for building the "See previous versions" link. Sourced
  // from `baseUrl` in latest-release.json so a repo migration/rename doesn't
  // require a client rebuild. If missing, the link is hidden entirely.
  baseUrl,
}) => {
  // Event-delegated click handler for the whole modal body. Catches any
  // <a href> click and routes it through shell.openExternal so the URL opens
  // in the user's default OS browser instead of hijacking the Electron window.
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
            // Preserve the real href and append the external-link icon so it
            // matches "See previous versions" and the announcement anchors.
            // The parent modal-body div has a delegated click handler that
            // intercepts the click and routes it through shell.openExternal.
            const href = child.getAttribute("href");
            liChildElems.push(
              createElement(
                "a",
                { href },
                child.textContent,
                createElement("img", { className: "external-link", src: boxRightArrow })
              )
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
    ? <div className="whats-new-section">{htmlStringToReact(releaseNotes)}</div>
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
