(() => {
  const PICKING_CLASS = "edge-element-tools-picking";
  const COPY_TOAST_CLASS = "edge-element-tools-copy-toast";
  const REF_ATTRIBUTE = "data-boxteam-ref";
  const DOCUMENT_REVISION = 0;
  const MAX_TEXT_LENGTH = 240;
  const CONSOLE_BRIDGE_SOURCE = "edge-element-tools-console-capture";
  const PERFORMANCE_SOURCE = "edge-element-tools-performance";
  const PERFORMANCE_DEBUG_ENABLED = (() => {
    try {
      return new URLSearchParams(location.search).get("edge_element_tools_debug") === "1";
    } catch {
      return false;
    }
  })();
  const state = {
    active: false,
    mode: "basic",
    currentElement: null,
    previousHighlight: null,
    toastElement: null,
    toastTimer: null
  };

  let performanceSelectionId = 0;

  function createPerformanceTiming(mode) {
    if (!PERFORMANCE_DEBUG_ENABLED) {
      return null;
    }
    return {
      selectionId: ++performanceSelectionId,
      mode,
      startedAt: performance.now(),
      stages: {},
      css: {
        styleSheetCount: 0,
        taskCount: 0,
        processedTaskCount: 0,
        idleCallbackCount: 0,
        timeoutCallbackCount: 0,
        ruleCount: 0,
        selectorCount: 0,
        matchedSelectorCount: 0,
        workMs: 0,
        waitMs: 0
      }
    };
  }

  function beginPerformanceStage(timing, name) {
    if (!timing) {
      return;
    }
    timing.stages[name] = { start: performance.now() };
  }

  function endPerformanceStage(timing, name, details = {}) {
    if (!timing || !timing.stages[name]) {
      return;
    }
    const stage = timing.stages[name];
    stage.durationMs = performance.now() - stage.start;
    Object.assign(stage, details);
  }

  function emitPerformanceEntry(entry) {
    if (!PERFORMANCE_DEBUG_ENABLED) {
      return;
    }
    window.postMessage({
      source: PERFORMANCE_SOURCE,
      type: "PERFORMANCE_ENTRY",
      entry: {
        ...entry,
        url: location.href,
        emittedAt: performance.now()
      }
    }, "*");
  }

  function forwardConsoleMessage(message) {
    chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
  }

  function handleConsoleBridgeMessage(event) {
    if (event.source !== window || event.data?.source !== CONSOLE_BRIDGE_SOURCE) {
      return;
    }
    if (event.data.type === "CONSOLE_ENTRY") {
      forwardConsoleMessage({ type: "CONSOLE_LOG", log: event.data.entry });
    }
    if (event.data.type === "CONSOLE_SNAPSHOT") {
      forwardConsoleMessage({ type: "CONSOLE_LOGS_SYNC", logs: event.data.logs });
    }
  }

  window.addEventListener("message", handleConsoleBridgeMessage);
  window.postMessage({ source: CONSOLE_BRIDGE_SOURCE, type: "GET_SNAPSHOT" }, "*");

  function getElementFromEvent(event) {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const pathElement = path.find((item) => item instanceof Element);
    const target = pathElement || (event.target instanceof Element ? event.target : null);
    return getInspectableElement(target);
  }

  function getInspectableElement(element) {
    if (!(element instanceof Element)) {
      return null;
    }
    return element.closest(
      'button,a,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="tab"]'
    ) || element;
  }

  function escapeCss(value) {
    return typeof CSS !== "undefined" && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : value.replace(/([\\.#:[\],>+~*'" ])/g, "\\$1");
  }

  function getElementText(element) {
    return String(
      element.getAttribute("aria-label")
      || element.getAttribute("alt")
      || element.getAttribute("title")
      || ("value" in element ? element.value : "")
      || element.textContent
      || ""
    ).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);
  }

  function getElementRef(element) {
    let ref = element.getAttribute(REF_ATTRIBUTE);
    if (!ref || !ref.startsWith(`r${DOCUMENT_REVISION}_`)) {
      ref = `r${DOCUMENT_REVISION}_e${Math.random().toString(36).slice(2, 8)}`;
      element.setAttribute(REF_ATTRIBUTE, ref);
    }
    return ref;
  }

  function getAncestors(element) {
    const ancestors = [];
    let current = element;
    while (current instanceof Element) {
      ancestors.unshift({
        tagName: current.localName,
        id: current.id || undefined,
        classNames: Array.from(current.classList).filter((className) => className !== PICKING_CLASS)
      });
      current = current.parentElement;
    }
    return ancestors;
  }

  function getComputedStyleText(element, timing = null) {
    beginPerformanceStage(timing, "cssScan");
    const keyComputedProperties = new Set([
      "display", "position", "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
      "padding", "padding-top", "padding-right", "padding-bottom", "padding-left", "font-size",
      "font-family", "color", "background-color"
    ]);
    const inheritableProperties = new Set([
      "color", "cursor", "direction", "font", "font-family", "font-size", "font-style", "font-weight",
      "letter-spacing", "line-height", "list-style", "text-align", "text-indent", "text-transform",
      "visibility", "white-space", "word-break", "word-spacing", "writing-mode"
    ]);
    const authorPropertyNames = new Set(["display", "height", "width"]);
    const referencedVars = new Set();
    const normalRuleLines = [];
    const pseudoRuleLines = [];
    const inheritedRuleLines = [];
    const seenRuleLines = new Set();

    function collectDeclarations(style, onlyInheritable = false) {
      for (const property of style) {
        const value = style.getPropertyValue(property);
        if (!value || property.startsWith("--") || (onlyInheritable && !inheritableProperties.has(property))) {
          continue;
        }
        authorPropertyNames.add(property);
        for (const match of value.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
          referencedVars.add(match[1]);
        }
      }
    }

    function selectorMatches(target, selector) {
      const pseudoMatch = selector.trim().match(/^(.*?)(::[a-zA-Z-]+)(?:\(.*\))?$/);
      const targetSelector = pseudoMatch ? pseudoMatch[1].trim() : selector.trim();
      try {
        return target.matches(targetSelector || "*");
      } catch {
        return false;
      }
    }

    function walkRules(rules, target, kind) {
      for (const rule of rules || []) {
        if (timing) {
          timing.css.ruleCount += 1;
        }
        if (rule.type === 1) {
          const matchingSelectors = String(rule.selectorText || "")
            .split(",")
            .map((selector) => selector.trim())
            .filter(Boolean)
            .filter((selector) => {
              if (timing) {
                timing.css.selectorCount += 1;
              }
              const matched = selectorMatches(target, selector);
              if (matched && timing) {
                timing.css.matchedSelectorCount += 1;
              }
              return matched;
            });
          if (matchingSelectors.length === 0) {
            continue;
          }
          const cssText = String(rule.style?.cssText || "").trim();
          if (!cssText) {
            continue;
          }
          const line = `${matchingSelectors.join(", ")} { ${cssText} }`;
          const lineKey = `${kind}:${line}`;
          if (seenRuleLines.has(lineKey)) {
            continue;
          }
          seenRuleLines.add(lineKey);
          const hasPseudoSelector = matchingSelectors.some((selector) => selector.includes("::"));
          collectDeclarations(rule.style, kind === "inherited");
          if (kind === "inherited") {
            inheritedRuleLines.push(line);
          } else if (hasPseudoSelector) {
            pseudoRuleLines.push(line);
          } else {
            normalRuleLines.push(line);
          }
          continue;
        }
        if (rule.cssRules) {
          walkRules(rule.cssRules, target, kind);
        }
      }
    }

    const inlineStyle = String(element.style?.cssText || "").trim();
    if (inlineStyle) {
      collectDeclarations(element.style);
      normalRuleLines.push(`element { ${inlineStyle} }`);
    }
    const styleTasks = [];
    const styleSheets = Array.from(document.styleSheets);
    if (timing) {
      timing.css.styleSheetCount = styleSheets.length;
    }
    const addTasks = (target, kind) => {
      for (const styleSheet of styleSheets) {
        try {
          styleTasks.push({ rules: styleSheet.cssRules, target, kind });
        } catch {
          // 跨域样式表无法读取 CSSOM，保留可访问样式表的结果。
        }
      }
    };
    addTasks(element, "direct");
    for (let ancestor = element.parentElement; ancestor instanceof Element; ancestor = ancestor.parentElement) {
      addTasks(ancestor, "inherited");
    }
    if (timing) {
      timing.css.taskCount = styleTasks.length;
    }

    let taskIndex = 0;
    const finish = () => {
      const computedStyle = window.getComputedStyle(element);
      const computedStyles = {};
      for (const property of keyComputedProperties) {
        const value = computedStyle.getPropertyValue(property);
        if (value) {
          computedStyles[property] = value;
        }
      }
      for (const variable of referencedVars) {
        const value = computedStyle.getPropertyValue(variable);
        if (value) {
          computedStyles[variable] = value;
        }
      }
      const lines = [...normalRuleLines];
      if (pseudoRuleLines.length > 0) {
        lines.push("", "/* Pseudo-elements */", ...pseudoRuleLines);
      }
      if (inheritedRuleLines.length > 0) {
        lines.push("", "/* Inherited */", ...inheritedRuleLines);
      }
      const resolvedLines = [...authorPropertyNames]
        .map((property) => `${property}: ${computedStyle.getPropertyValue(property)};`)
        .filter((line) => !line.endsWith(": ;"));
      if (resolvedLines.length > 0) {
        lines.push("", "/* Resolved values */", ...resolvedLines);
      }
      const variableLines = [...referencedVars]
        .map((property) => `${property}: ${computedStyle.getPropertyValue(property)};`)
        .filter((line) => !line.endsWith(": ;"));
      if (variableLines.length > 0) {
        lines.push("", "/* CSS variables */", ...variableLines);
      }
      const text = lines.join("\n");
      endPerformanceStage(timing, "cssScan", {
        outputLength: text.length,
        computedPropertyCount: Object.keys(computedStyles).length
      });
      return { text, values: computedStyles };
    };

    for (const task of styleTasks) {
      taskIndex += 1;
      const taskStartedAt = performance.now();
      try {
        walkRules(task.rules, task.target, task.kind);
      } catch {
        // 某些嵌套跨域规则无法读取，跳过该规则继续处理。
      }
      if (timing) {
        timing.css.processedTaskCount = taskIndex;
        timing.css.workMs += performance.now() - taskStartedAt;
      }
    }

    return finish();
  }

  function getCleanOuterHTML(element, timing = null) {
    beginPerformanceStage(timing, "outerHTML");
    const clone = element.cloneNode(true);
    clone.removeAttribute(REF_ATTRIBUTE);
    for (const descendant of clone.querySelectorAll(`[${REF_ATTRIBUTE}], .${COPY_TOAST_CLASS}`)) {
      if (descendant.classList.contains(COPY_TOAST_CLASS)) {
        descendant.remove();
      } else {
        descendant.removeAttribute(REF_ATTRIBUTE);
      }
    }
    const outerHTML = clone.outerHTML;
    endPerformanceStage(timing, "outerHTML", {
      outputLength: outerHTML.length,
      descendantCount: clone.querySelectorAll("*").length
    });
    return outerHTML;
  }

  function getAttributes(element) {
    return Object.fromEntries(
      Array.from(element.attributes)
        .filter((attribute) => attribute.name !== REF_ATTRIBUTE)
        .map((attribute) => [attribute.name, attribute.value])
    );
  }

  function snapshotElement(element, includeRichContext = false, timing = null) {
    const rect = element.getBoundingClientRect();
    const ref = getElementRef(element);
    const snapshot = {
      ref,
      selector: `[${REF_ATTRIBUTE}="${escapeCss(ref)}"]`,
      tag: element.localName,
      id: element.id || "",
      classes: typeof element.className === "string" ? element.className.trim().slice(0, MAX_TEXT_LENGTH) : "",
      text: getElementText(element),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
      title: document.title || "",
      url: location.href,
      outerHTML: getCleanOuterHTML(element, timing)
    };
    if (includeRichContext) {
      const applyStyle = (style) => {
        Object.assign(snapshot, {
          computedStyle: style.text,
          computedStyles: style.values,
          ancestors: getAncestors(element),
          attributes: getAttributes(element),
          innerText: element.textContent || "",
          document_revision: DOCUMENT_REVISION,
          bounds: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          dimensions: {
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height
          }
        });
        return snapshot;
      };
      const style = getComputedStyleText(element, timing);
      return style instanceof Promise ? style.then(applyStyle) : applyStyle(style);
    }
    return snapshot;
  }

  function formatElementPath(ancestors) {
    return ancestors.map((ancestor) => {
      const id = ancestor.id ? `#${ancestor.id}` : "";
      const classes = ancestor.classNames.length ? `.${ancestor.classNames.join(".")}` : "";
      return `${ancestor.tagName}${id}${classes}`;
    }).join(" > ");
  }

  function getClassNames(classes) {
    return typeof classes === "string"
      ? classes.split(/\s+/).filter(Boolean)
      : Array.isArray(classes) ? classes : [];
  }

  function formatElementDisplayName(snapshot) {
    const id = snapshot.id ? `#${snapshot.id}` : "";
    const classes = getClassNames(snapshot.classes);
    const classSuffix = classes.length ? `.${classes.join(".")}` : "";
    if (!Array.isArray(snapshot.ancestors) || snapshot.ancestors.length === 0) {
      return `${snapshot.tag}${id}${classSuffix}`;
    }
    let lastAncestor = snapshot.ancestors[snapshot.ancestors.length - 1];
    let pseudo = "";
    if (lastAncestor.tagName.startsWith("::") && snapshot.ancestors.length > 1) {
      pseudo = lastAncestor.tagName;
      lastAncestor = snapshot.ancestors[snapshot.ancestors.length - 2];
    }
    const ancestorId = lastAncestor.id ? `#${lastAncestor.id}` : "";
    const ancestorClasses = lastAncestor.classNames.length ? `.${lastAncestor.classNames.join(".")}` : "";
    return `${lastAncestor.tagName}${ancestorId}${ancestorClasses}${pseudo}`;
  }

  function formatRichContext(snapshot) {
    const sections = [
      "Attached Element Context from Integrated Browser",
      `Element: ${formatElementDisplayName(snapshot)}`,
    ];
    if (snapshot.url) {
      sections.push(`URL: ${snapshot.url}`);
    }
    const htmlPath = formatElementPath(snapshot.ancestors);
    if (htmlPath) {
      sections.push(`HTML Path: ${htmlPath}`);
    }
    sections.push(
      `Outer HTML:\n\`\`\`html\n${snapshot.outerHTML}\n\`\`\``,
      `Dimensions:\n- top: ${Math.round(snapshot.dimensions.top)}px\n- left: ${Math.round(snapshot.dimensions.left)}px\n- width: ${Math.round(snapshot.dimensions.width)}px\n- height: ${Math.round(snapshot.dimensions.height)}px`,
      `CSS:\n\`\`\`css\n${snapshot.computedStyle}\n\`\`\``
    );
    return sections.join("\n\n");
  }

  function restoreHighlight() {
    if (!state.currentElement || !state.previousHighlight) {
      return;
    }
    if (state.previousHighlight.styleAttribute === null) {
      state.currentElement.removeAttribute("style");
    } else {
      state.currentElement.setAttribute("style", state.previousHighlight.styleAttribute);
    }
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
      styleAttribute: element.getAttribute("style")
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
    restoreHighlight();
    restoreCursor();
  }

  async function startPicker(mode) {
    const nextMode = mode === "rich" ? "rich" : "basic";
    if (state.active) {
      if (state.mode === nextMode) {
        stopPicker();
        return;
      }
      state.mode = nextMode;
      return;
    }
    state.active = true;
    state.mode = nextMode;
    document.documentElement?.classList.add(PICKING_CLASS);
    document.addEventListener("pointermove", handlePointerMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function showCopyToast(message) {
    if (!document.body) {
      return;
    }
    if (!state.toastElement) {
      state.toastElement = document.createElement("div");
      state.toastElement.className = COPY_TOAST_CLASS;
      state.toastElement.setAttribute("role", "status");
      state.toastElement.setAttribute("aria-live", "polite");
      document.body.appendChild(state.toastElement);
    }
    state.toastElement.textContent = message;
    state.toastElement.hidden = false;
    if (state.toastTimer !== null) {
      window.clearTimeout(state.toastTimer);
    }
    state.toastTimer = window.setTimeout(() => {
      state.toastElement?.remove();
      state.toastElement = null;
      state.toastTimer = null;
    }, 1600);
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text)
        .then(() => true)
        .catch(() => copyTextFallback(text));
    }
    return Promise.resolve(copyTextFallback(text));
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

  async function finishSelection(element, timing = null) {
    const mode = state.mode;
    if (mode === "rich") {
      showCopyToast("正在准备完整元素上下文…");
    }
    beginPerformanceStage(timing, "snapshot");
    const snapshotResult = snapshotElement(element, mode === "rich", timing);
    const snapshot = snapshotResult instanceof Promise ? await snapshotResult : snapshotResult;
    endPerformanceStage(timing, "snapshot");
    beginPerformanceStage(timing, "format");
    const copiedValue = mode === "rich" ? formatRichContext(snapshot) : snapshot.outerHTML;
    const copiedText = copiedValue;
    endPerformanceStage(timing, "format", { outputLength: copiedText.length });
    beginPerformanceStage(timing, "clipboard");
    const copied = await copyText(copiedText);
    endPerformanceStage(timing, "clipboard", { copied });
    if (copied) {
      showCopyToast(mode === "rich" ? "已复制完整元素上下文" : "已复制元素 HTML");
    }
    if (timing) {
      emitPerformanceEntry({
        type: "selection-complete",
        selectionId: timing.selectionId,
        mode: timing.mode,
        totalMs: performance.now() - timing.startedAt,
        stages: timing.stages,
        css: timing.css
      });
    }
  }

  function handlePointerMove(event) {
    const element = getElementFromEvent(event);
    if (element) {
      highlight(element);
    }
  }

  function handleClick(event) {
    if (!state.active) {
      return;
    }
    const timing = createPerformanceTiming(state.mode);
    beginPerformanceStage(timing, "elementLookup");
    const element = getElementFromEvent(event);
    endPerformanceStage(timing, "elementLookup", {
      tag: element?.localName || null
    });
    if (!element) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // 保持拾取会话，但先移除悬停高亮，避免 outline 被写进复制的 Outer HTML。
    restoreHighlight();
    void finishSelection(element, timing);
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      stopPicker();
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "OPEN_SCREENSHOT_EDITOR") {
      stopPicker();
      return false;
    }
    if (message?.type !== "START_PICK") {
      return false;
    }
    startPicker(message.mode)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
