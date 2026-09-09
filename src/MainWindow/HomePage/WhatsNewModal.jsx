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

// Release notes / announcements come from a remotely-fetched release catalog,
// so treat the HTML as untrusted. Only these tags/attributes survive parsing;
// everything else (scripts, iframes, event handlers, javascript: hrefs) is
// dropped before it can reach React.createElement.
const ALLOWED_TAGS = new Set([
  "a","p","br","hr","strong","em","b","i","u","code","pre",
  "h1","h2","h3","h4","h5","h6","ul","ol","li","blockquote","span","div",
  // Markdown-authored release notes commonly embed screenshots/badges via
  // ![alt](url), which marked converts to <img>. Keep it in the allowlist so
  // those images survive sanitization; src is validated through isSafeHref.
  "img",
]);
const ALLOWED_ATTRS_BY_TAG = {
  a: new Set(["href","title"]),
  code: new Set(["class"]),
  pre: new Set(["class"]),
  span: new Set(["class"]),
  div: new Set(["class"]),
  img: new Set(["src","alt","title","width","height"]),
};
const SAFE_URL_SCHEMES = /^(https?:|mailto:)/i;

const isSafeHref = (v) => {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (s.startsWith("/") || s.startsWith("#")) return true;
  return SAFE_URL_SCHEMES.test(s);
};

// Walk an HTML DOM node and produce a React element tree. Every <a href>
// gets the external-link icon appended as an extra child so hyperlinks in
// markdown-authored release notes / announcements have the same visual
// affordance as the built-in "See previous versions" link.
const htmlNodeToReact = (node, key) => {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent;
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const tag = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tag)) return null;
  const allowedAttrs = ALLOWED_ATTRS_BY_TAG[tag] || new Set();
  const props = { key };
  for (const attr of node.attributes) {
    const rawName = attr.name.toLowerCase();
    if (rawName.startsWith("on")) continue;
    if (!allowedAttrs.has(rawName)) continue;
    if ((rawName === "href" || rawName === "src") && !isSafeHref(attr.value)) continue;
    const name = HTML_TO_REACT_ATTR[rawName] || rawName;
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

// Parse via DOMParser (inert document): unlike a live-document `<div>`,
// resources such as `<img src>` do NOT load and inline event handlers
// (onerror/onload/…) do NOT fire during parsing. That closes the XSS
// window that would otherwise open before htmlNodeToReact's allowlist
// gets a chance to strip them.
const htmlStringToReact = (html) => {
  if (typeof html !== "string" || html.length === 0) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.body.childNodes).map((c, i) => htmlNodeToReact(c, i));
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
    // Parse into an inert document so <img> in the release-notes HTML
    // doesn't kick off a network fetch and fire onerror before we walk
    // the tree. `body` is a drop-in replacement for the previous live
    // div; getElementsByTagName / childNodes / .innerHTML / .innerText
    // all work the same on a DOMParser-owned element in Chromium.
    const releaseNotesNode = new DOMParser()
      .parseFromString(releaseNotes || "", "text/html").body;

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
            const rawHref = child.getAttribute("href");
            const href = isSafeHref(rawHref) ? rawHref : "#";
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
