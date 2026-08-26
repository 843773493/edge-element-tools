const LOG_KEY = "consoleLogsByTab";
const MAX_LOGS = 200;
const logWriteChains = new Map();

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
