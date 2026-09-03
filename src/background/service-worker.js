const LOG_KEY = "consoleLogsByTab";
const MAX_LOGS = 200;
const logWriteChains = new Map();
const SCREENSHOT_COMMAND = "capture-and-edit-screenshot";
const SCREENSHOT_CAPTURE_KEY = "pendingScreenshotCapture";
const screenshotRuns = new Map();

function getPageRestrictionMessage(url) {
  if (!url) {
    return "无法读取当前页面地址，请打开普通网页后重试。";
  }
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
    return "Edge 内置页面不能截图，请打开普通网页后再试。";
    }
  } catch {
    return "当前页面不支持截图，请打开普通网页后再试。";
  }
  return "";
}

function getTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

function activateTab(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { active: true }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      if (!dataUrl) {
        reject(new Error("截图没有返回图像数据"));
        return;
      }
      resolve(dataUrl);
    });
  });
}

function downloadScreenshot(dataUrl) {
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const filename = `web-developer-tools-screenshot-${timestamp}.png`;
  return new Promise((resolve, reject) => {
    chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs: false,
      conflictAction: "uniquify"
    }, (downloadId) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve({ downloadId, filename });
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    getStorageArea().set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function storageGet(keys) {
  return new Promise((resolve, reject) => {
    getStorageArea().get(keys, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    getStorageArea().remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function createEditorTab(captureId) {
  const editorUrl = `${chrome.runtime.getURL("src/screenshot/index.html")}?captureId=${encodeURIComponent(captureId)}`;
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: editorUrl, active: true }, (tab) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tab);
    });
  });
}

async function captureScreenshotForEditor(tab) {
  const restrictionMessage = getPageRestrictionMessage(tab?.url);
  if (restrictionMessage) {
    throw new Error(restrictionMessage);
  }
  if (!Number.isInteger(tab?.id) || !Number.isInteger(tab?.windowId)) {
    throw new Error("找不到当前网页窗口");
  }

  if (!tab.active) {
    await activateTab(tab.id);
  }
  // 关键顺序：先捕获当前可见画面，不向原页面注入选区或冻结层。
  const dataUrl = await captureVisibleTab(tab.windowId);
  const captureId = crypto.randomUUID();
  await storageSet({
    [SCREENSHOT_CAPTURE_KEY]: {
      captureId,
      dataUrl,
      sourceTabId: tab.id,
      createdAt: new Date().toISOString()
    }
  });
  try {
    const editorTab = await createEditorTab(captureId);
    return { captureId, editorTabId: editorTab.id };
  } catch (error) {
    await storageRemove(SCREENSHOT_CAPTURE_KEY).catch(() => {});
    throw error;
  }
}

function runScreenshotOnce(tab) {
  if (screenshotRuns.has(tab.id)) {
    return screenshotRuns.get(tab.id);
  }
  const run = captureScreenshotForEditor(tab).finally(() => {
    if (screenshotRuns.get(tab.id) === run) {
      screenshotRuns.delete(tab.id);
    }
  });
  screenshotRuns.set(tab.id, run);
  return run;
}

function getStorageArea() {
  return chrome.storage.session || chrome.storage.local;
}

function normalizeLog(log) {
  if (!log || typeof log !== "object") {
    return null;
  }
  return {
    level: typeof log.level === "string" ? log.level : "log",
    text: typeof log.text === "string" ? log.text : String(log.text ?? ""),
    location: log.location && typeof log.location === "object" ? log.location : null,
    occurred_at: typeof log.occurred_at === "string" ? log.occurred_at : new Date().toISOString()
  };
}

function getAllBuffers(callback) {
  getStorageArea().get({ [LOG_KEY]: {} }, (result) => {
    const buffers = result?.[LOG_KEY];
    callback(buffers && typeof buffers === "object" && !Array.isArray(buffers) ? buffers : {});
  });
}

function setAllBuffers(buffers, callback = () => {}) {
  getStorageArea().set({ [LOG_KEY]: buffers }, callback);
}

function enqueueBufferWrite(tabId, update) {
  const previous = logWriteChains.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => new Promise((resolve, reject) => {
    getAllBuffers((buffers) => {
      try {
        update(buffers);
        setAllBuffers(buffers, () => {
          const error = chrome.runtime.lastError;
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }));
  logWriteChains.set(tabId, next);
  const cleanup = () => {
    if (logWriteChains.get(tabId) === next) {
      logWriteChains.delete(tabId);
    }
  };
  next.then(cleanup, cleanup);
  return next;
}

function getTabId(message, sender) {
  const tabId = Number(message?.tabId ?? sender?.tab?.id);
  return Number.isInteger(tabId) && tabId >= 0 ? tabId : null;
}

function saveSnapshot(tabId, rawLogs, sendResponse) {
  const logs = (Array.isArray(rawLogs) ? rawLogs : [])
    .map(normalizeLog)
    .filter(Boolean)
    .slice(-MAX_LOGS);
  enqueueBufferWrite(tabId, (buffers) => {
    buffers[String(tabId)] = logs;
  })
    .then(() => sendResponse({ ok: true, count: logs.length }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
}

function appendLog(tabId, rawLog) {
  const log = normalizeLog(rawLog);
  if (!log) {
    return;
  }
  void enqueueBufferWrite(tabId, (buffers) => {
    const previousLogs = Array.isArray(buffers[String(tabId)]) ? buffers[String(tabId)] : [];
    buffers[String(tabId)] = [...previousLogs, log].slice(-MAX_LOGS);
  }).catch(() => {});
}

chrome.commands.onCommand.addListener((command) => {
  if (command !== SCREENSHOT_COMMAND) {
    return;
  }

  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    const error = chrome.runtime.lastError;
    if (error || !tabs?.[0]) {
      return;
    }
    const tab = tabs[0];
    void runScreenshotOnce(tab)
      .catch(() => {});
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CAPTURE_SCREENSHOT") {
    const tabId = getTabId(message, sender);
    if (tabId === null) {
      sendResponse({ ok: false, error: "找不到目标标签页" });
      return false;
    }
    getTab(tabId)
      .then((tab) => runScreenshotOnce(tab))
      .then(({ captureId, editorTabId }) => {
        sendResponse({
          ok: true,
          captureId,
          editorTabId
        });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "GET_SCREENSHOT_CAPTURE") {
    const captureId = typeof message.captureId === "string" ? message.captureId : "";
    storageGet({ [SCREENSHOT_CAPTURE_KEY]: null })
      .then((result) => {
        const capture = result?.[SCREENSHOT_CAPTURE_KEY];
        if (!capture || capture.captureId !== captureId || typeof capture.dataUrl !== "string") {
          sendResponse({ ok: false, error: "截图已过期，请重新截图" });
          return;
        }
        sendResponse({
          ok: true,
          dataUrl: capture.dataUrl,
          sourceTabId: capture.sourceTabId,
          createdAt: capture.createdAt
        });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "DOWNLOAD_EDITED_SCREENSHOT") {
    const dataUrl = typeof message.dataUrl === "string" ? message.dataUrl : "";
    if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 50_000_000) {
      sendResponse({ ok: false, error: "编辑后的截图数据无效或过大" });
      return false;
    }
    downloadScreenshot(dataUrl)
      .then(({ filename, downloadId }) => sendResponse({ ok: true, filename, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "RELEASE_SCREENSHOT_CAPTURE") {
    storageGet({ [SCREENSHOT_CAPTURE_KEY]: null })
      .then((result) => {
        if (result?.[SCREENSHOT_CAPTURE_KEY]?.captureId === message.captureId) {
          return storageRemove(SCREENSHOT_CAPTURE_KEY);
        }
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_CONSOLE_LOGS") {
    const tabId = getTabId(message, sender);
    if (tabId === null) {
      sendResponse({ ok: false, error: "找不到目标标签页" });
      return false;
    }
    getAllBuffers((buffers) => {
      const logs = Array.isArray(buffers[String(tabId)]) ? buffers[String(tabId)] : [];
      sendResponse({ ok: true, logs });
    });
    return true;
  }

  if (message?.type === "CONSOLE_LOGS_SYNC") {
    const tabId = getTabId(message, sender);
    if (tabId !== null) {
      saveSnapshot(tabId, message.logs, sendResponse);
      return true;
    }
    sendResponse({ ok: false, error: "找不到来源标签页" });
    return false;
  }

  if (message?.type === "CONSOLE_LOG") {
    const tabId = getTabId(message, sender);
    if (tabId !== null) {
      appendLog(tabId, message.log);
    }
    return false;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") {
    return;
  }
  void enqueueBufferWrite(tabId, (buffers) => {
    delete buffers[String(tabId)];
  }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueueBufferWrite(tabId, (buffers) => {
    delete buffers[String(tabId)];
  }).catch(() => {});
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove("selectionLogs");
});
