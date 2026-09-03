const elements = {
  pick: document.querySelector("#pick"),
  pickRich: document.querySelector("#pick-rich"),
  copyLog: document.querySelector("#copy-log"),
  captureScreenshot: document.querySelector("#capture-screenshot"),
  logCount: document.querySelector("#log-count"),
  message: document.querySelector("#message"),
  status: document.querySelector("#status")
};

function setMessage(message, kind = "") {
  elements.message.textContent = message;
  elements.message.classList.toggle("is-error", kind === "error");
}

function setBusy(isBusy, status = "就绪", unavailable = false) {
  for (const button of [elements.pick, elements.pickRich, elements.copyLog, elements.captureScreenshot]) {
    button.disabled = isBusy;
  }
  elements.status.textContent = status;
  elements.status.classList.toggle("is-unavailable", unavailable);
}

function queryActiveTab() {
  const testTargetUrl = new URLSearchParams(location.search).get("target");
  return new Promise((resolve, reject) => {
    const query = testTargetUrl ? { url: testTargetUrl } : { active: true, lastFocusedWindow: true };
    chrome.tabs.query(query, (tabs) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(tabs[0]);
    });
  });
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendToRuntime(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response);
    });
  });
}

function getPageRestrictionMessage(url) {
  if (!url) {
    return "无法读取当前页面地址，请打开普通网页后重试。";
  }
  try {
    const protocol = new URL(url).protocol;
    if (protocol !== "http:" && protocol !== "https:") {
      return "Edge 内置页面不能注入选择器，请打开普通网页后再试。";
    }
  } catch {
    return "当前页面不支持元素选择，请打开普通网页后再试。";
  }
  return "";
}

function getConnectionErrorMessage(error) {
  if (/Receiving end does not exist|Could not establish connection/i.test(error.message)) {
    return "当前网页还没有加载插件脚本，请刷新网页后再试。";
  }
  return `无法开始选择：${error.message}`;
}

function getScreenshotErrorMessage(error) {
  if (/message port closed|Receiving end does not exist|Could not establish connection/i.test(error.message)) {
    return "扩展刚刚更新，请先在 edge://extensions 点击“重新加载”，再刷新当前网页后重试。";
  }
  return `截图失败：${error.message}`;
}

async function startPicker(mode) {
  setBusy(true, "选择中");
  setMessage("请在当前网页中点击目标元素。按 Esc 可取消。 ");

  try {
    const tab = await queryActiveTab();
    if (!tab?.id) {
      throw new Error("找不到当前网页");
    }

    const restrictionMessage = getPageRestrictionMessage(tab.url);
    if (restrictionMessage) {
      setBusy(false, "仅支持网页", true);
      setMessage(restrictionMessage, "error");
      return;
    }

    const response = await sendToTab(tab.id, { type: "START_PICK", mode });
    if (!response?.ok) {
      throw new Error(response?.error || "元素选择器没有响应");
    }

    window.close();
  } catch (error) {
    setBusy(false, "不可用", true);
    setMessage(getConnectionErrorMessage(error), "error");
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the user-gesture-compatible legacy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("浏览器拒绝了剪贴板写入");
  }
}

async function copyLog() {
  setBusy(true, "处理中");

  try {
    const tab = await queryActiveTab();
    if (!tab?.id) {
      throw new Error("找不到当前网页");
    }
    const response = await sendToRuntime({ type: "GET_CONSOLE_LOGS", tabId: tab.id });
    const logs = Array.isArray(response?.logs) ? response.logs : [];
    await writeClipboard(formatConsoleLogs(logs));
    setBusy(false, "已复制");
    setMessage(logs.length ? `已复制 ${logs.length} 条控制台消息。` : "当前还没有控制台消息。 ");
  } catch (error) {
    setBusy(false, "不可用", true);
    setMessage(`复制日志失败：${error.message}`, "error");
  }
}

async function captureScreenshot() {
  setBusy(true, "截图中");
  setMessage("正在立即截取当前网页并打开编辑器…");

  try {
    const tab = await queryActiveTab();
    if (!tab?.id) {
      throw new Error("找不到当前网页");
    }

    const restrictionMessage = getPageRestrictionMessage(tab.url);
    if (restrictionMessage) {
      setBusy(false, "仅支持网页", true);
      setMessage(restrictionMessage, "error");
      return;
    }

    const response = await sendToRuntime({ type: "CAPTURE_SCREENSHOT", tabId: tab.id });
    if (!response?.ok) {
      throw new Error(response?.error || "截图没有响应");
    }
    setBusy(false, "编辑中");
    setMessage("截图已打开编辑器；原网页画面已经截取完成，可以安全调整区域。");
  } catch (error) {
    setBusy(false, "不可用", true);
    setMessage(getScreenshotErrorMessage(error), "error");
  }
}

function formatConsoleLogs(logs) {
  return logs.map((log) => {
    const timestamp = log.occurred_at || "未知时间";
    const level = log.level || "log";
    const text = log.text || "";
    const location = log.location?.url
      ? `\n  at ${log.location.url}:${log.location.lineNumber ?? 0}:${log.location.columnNumber ?? 0}`
      : "";
    return `[${timestamp}] ${level}: ${text}${location}`;
  }).join("\n");
}

async function refreshLogCount() {
  try {
    const tab = await queryActiveTab();
    if (!tab?.id) {
      elements.logCount.textContent = "—";
      return;
    }
    const response = await sendToRuntime({ type: "GET_CONSOLE_LOGS", tabId: tab.id });
    const count = Array.isArray(response?.logs) ? response.logs.length : 0;
    elements.logCount.textContent = `${count} 条`;
  } catch {
    elements.logCount.textContent = "—";
  }
}

elements.pick.addEventListener("click", () => startPicker("basic"));
elements.pickRich.addEventListener("click", () => startPicker("rich"));
elements.copyLog.addEventListener("click", copyLog);
elements.captureScreenshot.addEventListener("click", captureScreenshot);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if ((areaName === "session" || areaName === "local") && changes.consoleLogsByTab) {
    void refreshLogCount();
  }
});

refreshLogCount();
