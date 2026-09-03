(() => {
  const EDITOR_HOST_ID = "edge-element-tools-screenshot-editor";
  let session = null;

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

  function setStatus(message, isError = false) {
    if (!session) {
      return;
    }
    session.status.textContent = message;
    session.status.classList.toggle("is-error", isError);
  }

  function normalizeSelection(start, end) {
    const width = session.canvas.width;
    const height = session.canvas.height;
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
    const rect = session.canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(session.canvas.width, (event.clientX - rect.left) * session.canvas.width / rect.width)),
      y: Math.max(0, Math.min(session.canvas.height, (event.clientY - rect.top) * session.canvas.height / rect.height))
    };
  }

  function render() {
    const source = session.workingCanvas;
    if (session.canvas.width !== source.width) {
      session.canvas.width = source.width;
    }
    if (session.canvas.height !== source.height) {
      session.canvas.height = source.height;
    }
    const context = session.canvas.getContext("2d");
    context.clearRect(0, 0, source.width, source.height);
    context.drawImage(source, 0, 0);

    const selection = session.selection;
    if (!selection || selection.width < 1 || selection.height < 1) {
      session.applyCrop.disabled = true;
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
    session.applyCrop.disabled = selection.width < 4 || selection.height < 4;
  }

  function applyCrop() {
    const selection = session.selection;
    if (!selection || selection.width < 4 || selection.height < 4) {
      return;
    }
    const cropped = document.createElement("canvas");
    cropped.width = selection.width;
    cropped.height = selection.height;
    cropped.getContext("2d").drawImage(
      session.workingCanvas,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      selection.width,
      selection.height
    );
    session.workingCanvas = cropped;
    session.selection = null;
    render();
    setStatus(`已裁剪为 ${cropped.width} × ${cropped.height} 像素。`);
  }

  async function downloadEditedScreenshot() {
    session.download.disabled = true;
    setStatus("正在保存编辑后的截图…");
    try {
      const response = await sendToRuntime({
        type: "DOWNLOAD_EDITED_SCREENSHOT",
        dataUrl: session.workingCanvas.toDataURL("image/png")
      });
      if (!response?.ok) {
        throw new Error(response?.error || "下载失败");
      }
      session.status.dataset.downloadId = String(response.downloadId ?? "");
      setStatus(`已保存到下载目录：${response.filename}`);
    } catch (error) {
      setStatus(`保存失败：${error.message}`, true);
    } finally {
      session.download.disabled = false;
    }
  }

  async function closeEditor() {
    const current = session;
    if (!current) {
      return;
    }
    session = null;
    document.removeEventListener("keydown", current.handleKeyDown, true);
    if (current.dragHandlers) {
      document.removeEventListener("pointermove", current.dragHandlers.move, true);
      document.removeEventListener("pointerup", current.dragHandlers.up, true);
      current.dragHandlers = null;
    }
    await sendToRuntime({
      type: "RELEASE_SCREENSHOT_CAPTURE",
      captureId: current.captureId
    }).catch(() => {});
    current.host.remove();
  }

  function createEditorHost() {
    const host = document.createElement("div");
    host.id = EDITOR_HOST_ID;
    host.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "pointer-events:auto"
    ].join(";");
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .backdrop {
          align-items: center;
          background: rgba(15, 27, 49, 0.46);
          display: flex;
          font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
          height: 100vh;
          justify-content: center;
          padding: 20px;
          width: 100vw;
        }
        .panel {
          background: #f5f8fc;
          border: 1px solid #d7e0ed;
          border-radius: 12px;
          box-shadow: 0 18px 60px rgba(11, 27, 54, 0.32);
          color: #172033;
          display: flex;
          flex-direction: column;
          max-height: calc(100vh - 40px);
          max-width: min(1400px, calc(100vw - 40px));
          overflow: hidden;
          width: 1120px;
        }
        .toolbar {
          align-items: center;
          background: #fff;
          border-bottom: 1px solid #dfe6f0;
          display: flex;
          justify-content: space-between;
          padding: 13px 16px;
        }
        h2 { font-size: 16px; margin: 0; }
        .toolbar-actions { display: flex; gap: 7px; }
        button {
          background: #fff;
          border: 1px solid #cfd9e8;
          border-radius: 7px;
          color: #25324a;
          cursor: pointer;
          font: 13px "Segoe UI", "Microsoft YaHei", sans-serif;
          padding: 7px 11px;
        }
        button:hover:not(:disabled) { border-color: #7298e2; }
        button:disabled { cursor: not-allowed; opacity: 0.45; }
        button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
        .body { display: flex; flex-direction: column; min-height: 0; padding: 12px; }
        .status { color: #2763c8; font: 12px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0 0 8px; }
        .status.is-error { color: #b13c3c; }
        .hint { color: #63708a; font: 12px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0 0 9px; }
        .canvas-wrap {
          align-items: flex-start;
          background: #dce4f0;
          border-radius: 8px;
          display: flex;
          justify-content: center;
          min-height: 180px;
          overflow: auto;
          padding: 12px;
        }
        canvas { background: #fff; box-shadow: 0 2px 10px rgba(24, 39, 67, 0.18); cursor: crosshair; display: block; height: auto; max-height: calc(100vh - 190px); max-width: 100%; }
      </style>
      <div class="backdrop">
        <section class="panel" role="dialog" aria-label="截图编辑器">
          <div class="toolbar">
            <h2>截图编辑器</h2>
            <div class="toolbar-actions">
              <button id="reset" type="button">重置</button>
              <button id="apply-crop" class="primary" type="button" disabled>裁剪选区</button>
              <button id="download" class="primary" type="button" disabled>下载 PNG</button>
              <button id="close" type="button">关闭</button>
            </div>
          </div>
          <div class="body">
            <p id="status" class="status" role="status">正在加载截图…</p>
            <p class="hint">拖拽选择区域；这里编辑的是快捷键刚刚截取的静态画面，不会再改变原网页。</p>
            <div class="canvas-wrap"><canvas id="screenshot-canvas" aria-label="截图画布"></canvas></div>
          </div>
        </section>
      </div>
    `;
    return {
      host,
      shadow,
      canvas: shadow.querySelector("#screenshot-canvas"),
      status: shadow.querySelector("#status"),
      reset: shadow.querySelector("#reset"),
      applyCrop: shadow.querySelector("#apply-crop"),
      download: shadow.querySelector("#download"),
      close: shadow.querySelector("#close")
    };
  }

  async function openEditor(captureId) {
    if (session) {
      await closeEditor();
    }
    const current = createEditorHost();
    current.captureId = captureId;
    current.originalCanvas = null;
    current.workingCanvas = null;
    current.selection = null;
    current.dragStart = null;
    current.dragHandlers = null;
    current.handleKeyDown = (event) => {
      if (event.key === "Escape") {
        void closeEditor();
      }
    };
    session = current;
    (document.body || document.documentElement).appendChild(current.host);

    current.canvas.addEventListener("pointerdown", (event) => {
      if (!session.workingCanvas) {
        return;
      }
      session.dragStart = pointFromEvent(event);
      session.selection = null;
      if (current.dragHandlers) {
        document.removeEventListener("pointermove", current.dragHandlers.move, true);
        document.removeEventListener("pointerup", current.dragHandlers.up, true);
      }
      const handleMove = (moveEvent) => {
        if (session !== current || !current.dragStart) {
          return;
        }
        current.selection = normalizeSelection(current.dragStart, pointFromEvent(moveEvent));
        render();
      };
      const handleUp = (upEvent) => {
        if (session === current && current.dragStart) {
          current.selection = normalizeSelection(current.dragStart, pointFromEvent(upEvent));
          current.dragStart = null;
          render();
        }
        document.removeEventListener("pointermove", handleMove, true);
        document.removeEventListener("pointerup", handleUp, true);
        if (current.dragHandlers?.move === handleMove) {
          current.dragHandlers = null;
        }
      };
      current.dragHandlers = { move: handleMove, up: handleUp };
      document.addEventListener("pointermove", handleMove, true);
      document.addEventListener("pointerup", handleUp, true);
    });
    current.reset.addEventListener("click", () => {
      if (!session.originalCanvas) {
        return;
      }
      session.workingCanvas = cloneCanvas(session.originalCanvas);
      session.selection = null;
      render();
      setStatus("已恢复原始截图。");
    });
    current.applyCrop.addEventListener("click", applyCrop);
    current.download.addEventListener("click", downloadEditedScreenshot);
    current.close.addEventListener("click", () => void closeEditor());
    document.addEventListener("keydown", current.handleKeyDown, true);

    try {
      const response = await sendToRuntime({ type: "GET_SCREENSHOT_CAPTURE", captureId });
      if (!response?.ok) {
        throw new Error(response?.error || "读取截图失败");
      }
      const image = await loadImage(response.dataUrl);
      if (session !== current) {
        return { ok: true };
      }
      const source = document.createElement("canvas");
      source.width = image.naturalWidth;
      source.height = image.naturalHeight;
      source.getContext("2d").drawImage(image, 0, 0);
      current.originalCanvas = cloneCanvas(source);
      current.workingCanvas = source;
      current.selection = null;
      current.download.disabled = false;
      render();
      setStatus("截图已加载。拖拽选择区域后，可裁剪或直接下载。");
      return { ok: true };
    } catch (error) {
      setStatus(`加载失败：${error.message}`, true);
      return { ok: false, error: error.message };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "OPEN_SCREENSHOT_EDITOR") {
      return false;
    }
    openEditor(message.captureId)
      .then((response) => sendResponse(response))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });
})();
