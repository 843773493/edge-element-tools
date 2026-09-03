const elements = {
  canvas: document.querySelector("#screenshot-canvas"),
  status: document.querySelector("#status"),
  reset: document.querySelector("#reset"),
  applyCrop: document.querySelector("#apply-crop"),
  download: document.querySelector("#download"),
  close: document.querySelector("#close")
};

const captureId = new URLSearchParams(location.search).get("captureId") || "";
const state = {
  originalCanvas: null,
  workingCanvas: null,
  selection: null,
  dragStart: null
};

function setStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("is-error", isError);
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

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("截图图像无法加载"));
    image.src = dataUrl;
  });
}

function cloneCanvas(source) {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d").drawImage(source, 0, 0);
  return copy;
}

function normalizeSelection(start, end) {
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(width, Math.max(start.x, end.x));
  const bottom = Math.min(height, Math.max(start.y, end.y));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(Math.max(0, right - left)),
    height: Math.round(Math.max(0, bottom - top))
  };
}

function pointFromEvent(event) {
  const rect = elements.canvas.getBoundingClientRect();
  const scaleX = elements.canvas.width / rect.width;
  const scaleY = elements.canvas.height / rect.height;
  return {
    x: Math.max(0, Math.min(elements.canvas.width, (event.clientX - rect.left) * scaleX)),
    y: Math.max(0, Math.min(elements.canvas.height, (event.clientY - rect.top) * scaleY))
  };
}

function render() {
  const source = state.workingCanvas;
  if (!source) {
    return;
  }
  elements.canvas.width = source.width;
  elements.canvas.height = source.height;
  const context = elements.canvas.getContext("2d");
  context.clearRect(0, 0, source.width, source.height);
  context.drawImage(source, 0, 0);

  const selection = state.selection;
  if (!selection || selection.width < 1 || selection.height < 1) {
    elements.applyCrop.disabled = true;
    return;
  }
  context.save();
  context.fillStyle = "rgba(9, 24, 52, 0.48)";
  context.fillRect(0, 0, source.width, source.height);
  context.clearRect(selection.x, selection.y, selection.width, selection.height);
  context.strokeStyle = "#2f6fed";
  context.lineWidth = Math.max(2, source.width / 700);
  context.strokeRect(selection.x, selection.y, selection.width, selection.height);
  context.restore();
  elements.applyCrop.disabled = selection.width < 4 || selection.height < 4;
}

function initializeCanvas(image) {
  const source = document.createElement("canvas");
  source.width = image.naturalWidth;
  source.height = image.naturalHeight;
  source.getContext("2d").drawImage(image, 0, 0);
  state.originalCanvas = cloneCanvas(source);
  state.workingCanvas = source;
  state.selection = null;
  elements.download.disabled = false;
  render();
  setStatus("截图已加载。拖拽选择区域后，可裁剪或直接下载。");
}

function applyCrop() {
  const selection = state.selection;
  if (!selection || selection.width < 4 || selection.height < 4) {
    return;
  }
  const cropped = document.createElement("canvas");
  cropped.width = selection.width;
  cropped.height = selection.height;
  cropped.getContext("2d").drawImage(
    state.workingCanvas,
    selection.x,
    selection.y,
    selection.width,
    selection.height,
    0,
    0,
    selection.width,
    selection.height
  );
  state.workingCanvas = cropped;
  state.selection = null;
  render();
  setStatus(`已裁剪为 ${cropped.width} × ${cropped.height} 像素。`);
}

async function downloadEditedScreenshot() {
  if (!state.workingCanvas) {
    return;
  }
  elements.download.disabled = true;
  setStatus("正在保存编辑后的截图…");
  try {
    const response = await sendToRuntime({
      type: "DOWNLOAD_EDITED_SCREENSHOT",
      dataUrl: state.workingCanvas.toDataURL("image/png")
    });
    if (!response?.ok) {
      throw new Error(response?.error || "下载失败");
    }
    elements.status.dataset.downloadId = String(response.downloadId ?? "");
    setStatus(`已保存到下载目录：${response.filename}`);
  } catch (error) {
    setStatus(`保存失败：${error.message}`, true);
  } finally {
    elements.download.disabled = false;
  }
}

async function closeEditor() {
  await sendToRuntime({ type: "RELEASE_SCREENSHOT_CAPTURE", captureId }).catch(() => {});
  window.close();
}

elements.canvas.addEventListener("pointerdown", (event) => {
  if (!state.workingCanvas) {
    return;
  }
  state.dragStart = pointFromEvent(event);
  state.selection = null;
  elements.canvas.setPointerCapture(event.pointerId);
});

elements.canvas.addEventListener("pointermove", (event) => {
  if (!state.dragStart) {
    return;
  }
  state.selection = normalizeSelection(state.dragStart, pointFromEvent(event));
  render();
});

elements.canvas.addEventListener("pointerup", (event) => {
  if (!state.dragStart) {
    return;
  }
  state.selection = normalizeSelection(state.dragStart, pointFromEvent(event));
  state.dragStart = null;
  render();
});

elements.canvas.addEventListener("pointercancel", () => {
  state.dragStart = null;
  state.selection = null;
  render();
});

elements.reset.addEventListener("click", () => {
  if (!state.originalCanvas) {
    return;
  }
  state.workingCanvas = cloneCanvas(state.originalCanvas);
  state.selection = null;
  render();
  setStatus("已恢复原始截图。");
});
elements.applyCrop.addEventListener("click", applyCrop);
elements.download.addEventListener("click", downloadEditedScreenshot);
elements.close.addEventListener("click", closeEditor);

async function initialize() {
  if (!captureId) {
    setStatus("缺少截图标识，请重新按快捷键截图。", true);
    return;
  }
  try {
    const response = await sendToRuntime({ type: "GET_SCREENSHOT_CAPTURE", captureId });
    if (!response?.ok) {
      throw new Error(response?.error || "读取截图失败");
    }
    initializeCanvas(await loadImage(response.dataUrl));
  } catch (error) {
    setStatus(`加载失败：${error.message}`, true);
  }
}

void initialize();
