(() => {
  const SOURCE = "edge-element-tools-console-capture";
  const MAX_LOGS = 200;
  const CONSOLE_METHODS = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
    "dir",
    "table",
    "trace",
    "assert",
    "count",
    "countReset",
    "timeLog",
    "clear",
    "group",
    "groupCollapsed",
    "groupEnd",
    "dirxml",
    "profile",
    "profileEnd",
    "timeStamp"
  ];
  const logs = [];

  function formatValue(value) {
    if (typeof value === "string") {
      return value;
    }
    if (value === undefined) {
      return "undefined";
    }
    if (value === null) {
      return "null";
    }
    if (value instanceof Error) {
      return value.stack || `${value.name}: ${value.message}`;
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  function getLocation() {
    const stack = new Error().stack || "";
    const line = stack.split("\n").slice(3).find((item) => /https?:\/\//.test(item));
    if (!line) {
      return null;
    }
    const match = line.match(/(https?:\/\/[^\s)]+):(\d+):(\d+)/);
    if (!match) {
      return null;
    }
    return {
      url: match[1],
      lineNumber: Number(match[2]),
      columnNumber: Number(match[3])
    };
  }

  function postMessage(message) {
    window.postMessage({ source: SOURCE, ...message }, "*");
  }

  function appendLog(level, args) {
    const entry = {
      level,
      text: args.map(formatValue).join(" "),
      location: getLocation(),
      occurred_at: new Date().toISOString()
    };
    logs.push(entry);
    if (logs.length > MAX_LOGS) {
      logs.shift();
    }
    postMessage({ type: "CONSOLE_ENTRY", entry });
  }

  for (const method of CONSOLE_METHODS) {
    const original = console[method];
    if (typeof original !== "function") {
      continue;
    }
    console[method] = function capturedConsoleMethod(...args) {
      if (method === "assert" && args[0]) {
        return original.apply(this, args);
      }
      const level = method === "warn" ? "warning" : method === "assert" ? "error" : method;
      const values = method === "assert" && args[0] === false
        ? ["Assertion failed", ...args.slice(1)]
        : args;
      appendLog(level, values);
      return original.apply(this, args);
    };
  }

  window.addEventListener("error", (event) => {
    if (event.error || event.message) {
      appendLog("error", [event.error || event.message]);
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    appendLog("error", [event.reason ?? "Unhandled promise rejection"]);
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== SOURCE) {
      return;
    }
    if (event.data.type === "GET_SNAPSHOT") {
      postMessage({ type: "CONSOLE_SNAPSHOT", logs });
    }
  });
})();
