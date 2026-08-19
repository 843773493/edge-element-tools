const LOG_KEY = "selectionLogs";
const MAX_LOGS = 200;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_LOGS") {
    chrome.storage.local.get({ [LOG_KEY]: [] }, (result) => {
      sendResponse({ ok: true, logs: Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [] });
    });
    return true;
  }

  if (message?.type === "ELEMENT_SELECTED") {
    chrome.storage.local.get({ [LOG_KEY]: [] }, (result) => {
      const previousLogs = Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
      const nextLog = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        type: "element_selected",
        mode: message.mode === "append" ? "append" : "replace",
        copied: message.copied === true,
        page: message.page ?? {},
        selection: message.selection ?? null
      };
      const logs = [...previousLogs, nextLog].slice(-MAX_LOGS);
      chrome.storage.local.set({ [LOG_KEY]: logs }, () => {
        sendResponse({ ok: true, count: logs.length });
      });
    });
    return true;
  }

  return false;
});
