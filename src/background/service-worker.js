const LOG_KEY = "selectionLogs";
const BUFFER_KEY = "selectionBuffers";
const MAX_LOGS = 200;
const selectionStorage = chrome.storage.session ?? chrome.storage.local;

function getTabKey(sender) {
  return String(sender.tab?.id ?? "global");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_SELECTION_BUFFER") {
    const tabKey = getTabKey(sender);
    selectionStorage.get({ [BUFFER_KEY]: {} }, (result) => {
      const buffers = result[BUFFER_KEY] && typeof result[BUFFER_KEY] === "object" ? result[BUFFER_KEY] : {};
      sendResponse({ ok: true, selection: Array.isArray(buffers[tabKey]) ? buffers[tabKey] : [] });
    });
    return true;
  }

  if (message?.type === "GET_LOGS") {
    chrome.storage.local.get({ [LOG_KEY]: [] }, (result) => {
      sendResponse({ ok: true, logs: Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [] });
    });
    return true;
  }

  if (message?.type === "ELEMENT_SELECTED") {
    const tabKey = getTabKey(sender);
    selectionStorage.get({ [BUFFER_KEY]: {} }, (bufferResult) => {
      const buffers = bufferResult[BUFFER_KEY] && typeof bufferResult[BUFFER_KEY] === "object"
        ? bufferResult[BUFFER_KEY]
        : {};
      const previousSelection = Array.isArray(buffers[tabKey]) ? buffers[tabKey] : [];
      const selection = message.mode === "append"
        ? [...previousSelection, message.element]
        : [message.element];
      buffers[tabKey] = selection;
      selectionStorage.set({ [BUFFER_KEY]: buffers });

      chrome.storage.local.get({ [LOG_KEY]: [] }, (result) => {
        const previousLogs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
        const nextLog = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          timestamp: new Date().toISOString(),
          type: "element_selected",
          mode: message.mode === "append" ? "append" : "replace",
          copied: message.copied === true,
          page: message.page ?? {},
          selection
        };
        const logs = [...previousLogs, nextLog].slice(-MAX_LOGS);
        chrome.storage.local.set({ [LOG_KEY]: logs }, () => {
          sendResponse({ ok: true, count: logs.length, selection });
        });
      });
    });
    return true;
  }

  return false;
});
