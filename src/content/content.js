(() => {
  const PICKING_CLASS = "edge-element-tools-picking";
  const MAX_TEXT_LENGTH = 240;
  const state = {
    active: false,
    mode: "replace",
    currentElement: null,
    previousHighlight: null,
    selectedElements: []
  };

  function getElementFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const pathElement = path.find((item) => item instanceof Element);
    return pathElement || (event.target instanceof Element ? event.target : null);
  }

  function escapeCss(value) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : value.replace(/([\\.#:[\],>+~*'" ])/g, "\\$1");
  }

  function isUniqueSelector(selector) {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function getCssSelector(element) {
    if (element.id) {
      const idSelector = `#${escapeCss(element.id)}`;
      if (isUniqueSelector(idSelector)) {
        return idSelector;
      }
    }

    const segments = [];
    let current = element;
    while (current instanceof Element && current !== document.documentElement) {
      let segment = current.localName;
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.localName === current.localName) {
          index += 1;
        }
      }
      segment += `:nth-of-type(${index})`;
      segments.unshift(segment);
      current = current.parentElement;
    }
    return segments.join(" > ");
  }

  function getXPath(element) {
    const segments = [];
    let current = element;
    while (current instanceof Element) {
      let index = 1;
      let sibling = current;
      while ((sibling = sibling.previousElementSibling)) {
        if (sibling.localName === current.localName) {
          index += 1;
        }
      }
      segments.unshift(`${current.localName}[${index}]`);
      current = current.parentElement;
    }
    return `/${segments.join("/")}`;
  }

  function getElementText(element) {
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
  }

  function getAttributes(element) {
    return Object.fromEntries(Array.from(element.attributes, (attribute) => [attribute.name, attribute.value]));
  }

  function snapshotElement(element) {
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.localName,
      id: element.id || null,
      classes: typeof element.className === "string" ? element.className.trim().split(/\s+/).filter(Boolean) : [],
      text: getElementText(element),
      selector: getCssSelector(element),
      xpath: getXPath(element),
      attributes: getAttributes(element),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  }

  function setStyleValue(element, property, value, priority) {
    if (value) {
      element.style.setProperty(property, value, priority);
    } else {
      element.style.removeProperty(property);
    }
  }

  function restoreHighlight() {
    if (!state.currentElement || !state.previousHighlight) {
      return;
    }
    setStyleValue(state.currentElement, "outline", state.previousHighlight.outline, state.previousHighlight.outlinePriority);
    setStyleValue(state.currentElement, "outline-offset", state.previousHighlight.outlineOffset, state.previousHighlight.outlineOffsetPriority);
    state.currentElement = null;
    state.previousHighlight = null;
  }

  function highlight(element) {
    if (state.currentElement === element) {
      return;
    }
    restoreHighlight();
    state.currentElement = element;
    state.previousHighlight = {
      outline: element.style.getPropertyValue("outline"),
      outlinePriority: element.style.getPropertyPriority("outline"),
      outlineOffset: element.style.getPropertyValue("outline-offset"),
      outlineOffsetPriority: element.style.getPropertyPriority("outline-offset")
    };
    element.style.setProperty("outline", "2px solid #2f6fed", "important");
    element.style.setProperty("outline-offset", "1px", "important");
  }

  function restoreCursor() {
    document.documentElement?.classList.remove(PICKING_CLASS);
  }

  function stopPicker() {
    if (!state.active) {
      restoreHighlight();
      restoreCursor();
      return;
    }
    state.active = false;
    document.removeEventListener("pointermove", handlePointerMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    window.removeEventListener("blur", stopPicker, true);
    restoreHighlight();
    restoreCursor();
  }

  function getStoredSelectionBuffer() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "GET_SELECTION_BUFFER" }, (response) => {
        if (chrome.runtime.lastError) {
          resolve([]);
          return;
        }
        resolve(Array.isArray(response?.selection) ? response.selection : []);
      });
    });
  }

  async function startPicker(mode) {
    stopPicker();
    state.active = true;
    state.mode = mode === "append" ? "append" : "replace";
    if (state.mode === "replace") {
      state.selectedElements = [];
    } else if (state.selectedElements.length === 0) {
      state.selectedElements = await getStoredSelectionBuffer();
    }
    document.documentElement?.classList.add(PICKING_CLASS);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("blur", stopPicker, true);
  }

  function copyText(text) {
    if (copyTextFallback(text)) {
      return Promise.resolve(true);
    }
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
    }
    return Promise.resolve(false);
  }

  function copyTextFallback(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }

  async function finishSelection(element) {
    const snapshot = snapshotElement(element);
    if (state.mode === "replace") {
      state.selectedElements = [snapshot];
    } else {
      state.selectedElements = [...state.selectedElements, snapshot];
    }

    const copiedValue = state.mode === "append" ? state.selectedElements : snapshot;
    const copiedText = JSON.stringify(copiedValue, null, 2);
    const copied = await copyText(copiedText);
    stopPicker();

    chrome.runtime.sendMessage({
      type: "ELEMENT_SELECTED",
      mode: state.mode,
      element: snapshot,
      selection: copiedValue,
      copied,
      page: {
        url: location.href,
        title: document.title
      }
    }, () => void chrome.runtime.lastError);
  }

  function handlePointerMove(event) {
    const element = getElementFromEvent(event);
    if (element) {
      highlight(element);
    }
  }

  function handleClick(event) {
    const element = getElementFromEvent(event);
    if (!element) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    void finishSelection(element);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      stopPicker();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "START_PICK") {
      return false;
    }
    startPicker(message.mode)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
