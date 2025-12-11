export type Sandbox = {
	run: (code: string, timeoutMs?: number) => Promise<unknown>;
	terminate: () => void;
};

const defaultTimeoutMs = 2000;

const MAX_CODE_SIZE = 64 * 1024; // 64 KB
const MAX_RESULT_SIZE = 1024 * 1024; // 1 MB

// Worker source: runs inside a Web Worker spawned by the sandboxed iframe.
const workerSource = `
// Harden surface: remove/replace high-risk globals and freeze prototypes.

// Capture postMessage before we kill it so we can still communicate with iframe.
const _postMessage = self.postMessage.bind(self);

(() => {
  const kill = (name) => {
    try { delete self[name]; } catch (_) {}
    try { self[name] = undefined; } catch (_) {}
  };

  [
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Navigator",
    "navigator",
    "importScripts",
    "BroadcastChannel",
    "SharedWorker",
    "MessageChannel",
    "MessagePort",
    "postMessage",
    "caches",
    "indexedDB",
    "localStorage",
    "sessionStorage",
    "crypto",
    "URL",
    "URLSearchParams",
    "Request",
    "Response",
    "Headers",
    "AbortController",
    "FileReader",
    "open",
    "close",
    "Client",
    "performance",
    "Performance",
    "PerformanceObserver",
    "Atomics",
    "SharedArrayBuffer"
  ].forEach(kill);

  // Freeze core prototypes and constructors.
  const freezeSafe = (obj) => { try { Object.freeze(obj); } catch (_) {} };
  [
    Object, Function, Array, Map, Set, WeakMap, WeakSet,
    Promise, RegExp, Date, Number, String, Boolean, Symbol, Error
  ].forEach((ctor) => {
    freezeSafe(ctor.prototype);
    freezeSafe(ctor);
  });
  freezeSafe(Object.prototype);
  freezeSafe(Array.prototype);
  freezeSafe(Function.prototype);
})();

// Keep private reference to Function before we shadow it.
const FunctionCtor = Function;

// Shadow dynamic code creators in global scope.
try { self.Function = undefined; } catch (_) {}
try { self.eval = undefined; } catch (_) {}
try { self.AsyncFunction = undefined; } catch (_) {}

const run = (code) => {
  const wrapped = "'use strict'; const Function = undefined; const AsyncFunction = undefined; const eval = undefined; return (async () => {\\n" + code + "\\n})()";
  const fn = FunctionCtor(wrapped);
  return fn();
};

const sanitizeError = (err) => {
  const msg = String(err);
  return msg.replace(/([A-Za-z]:|\\/).+?:\\d+/g, '[path]').slice(0, 500);
};

self.onmessage = async (event) => {
  const { id, code, maxResultSize } = event.data;
  try {
    const result = await run(code);
    const resultStr = JSON.stringify(result);
    if (resultStr && resultStr.length > (maxResultSize || 1048576)) {
      throw new Error('Result too large');
    }
    _postMessage({ id, ok: true, result });
  } catch (error) {
    _postMessage({ id, ok: false, error: sanitizeError(error) });
  }
};
`;

// Iframe HTML with strict CSP; hosts the worker and relays messages to parent.
function createIframeHtml(token: string): string {
	return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">
</head>
<body>
<script>
const token = ${JSON.stringify(token)};
const workerCode = ${JSON.stringify(workerSource)};
const blob = new Blob([workerCode], { type: 'application/javascript' });
const url = URL.createObjectURL(blob);
const worker = new Worker(url);

// Relay messages between parent and worker.
worker.onmessage = (e) => {
	parent.postMessage({ type: 'sandbox-result', token, payload: e.data }, '*');
};

window.addEventListener('message', (e) => {
	if (!e.data || e.data.token !== token) return;
	if (e.data.type === 'sandbox-run') {
    worker.postMessage(e.data.payload);
	} else if (e.data.type === 'sandbox-terminate') {
    worker.terminate();
    URL.revokeObjectURL(url);
  }
});

// Signal ready.
parent.postMessage({ type: 'sandbox-ready', token }, '*');
</script>
</body>
</html>
`;
}

export function createSandbox(): Sandbox {
	let dead = false;
	let seq = 0;
	let ready = false;
	const token =
		globalThis.crypto?.randomUUID?.() ?? `sandbox-${Math.random().toString(16).slice(2)}`;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: number }
	>();
	const queued: Array<{ id: number; code: string }> = [];

	// Create sandboxed iframe (no allow-same-origin = null origin, isolated).
	const iframe = document.createElement("iframe");
	iframe.sandbox.add("allow-scripts"); // only scripts, no same-origin/forms/popups/etc.
	iframe.style.display = "none";
	iframe.srcdoc = createIframeHtml(token);
	document.body.appendChild(iframe);

	const handleMessage = (event: MessageEvent) => {
		if (event.source !== iframe.contentWindow) return;
		const { type, payload, token: messageToken } = event.data ?? {};
		if (messageToken !== token) return;

		if (type === "sandbox-ready") {
			ready = true;
			// Flush queued runs.
			for (const q of queued) {
				iframe.contentWindow?.postMessage(
					{
						type: "sandbox-run",
						token,
						payload: { id: q.id, code: q.code, maxResultSize: MAX_RESULT_SIZE },
					},
					"*"
				);
			}
			queued.length = 0;
			return;
		}

		if (type === "sandbox-result") {
			const { id, ok, result, error } = payload ?? {};
			const entry = pending.get(id);
			if (!entry) return;
			pending.delete(id);
			clearTimeout(entry.timer);
			if (ok) {
				entry.resolve(result);
			} else {
				entry.reject(new Error(typeof error === "string" ? error : "Sandbox error"));
			}
		}
	};

	window.addEventListener("message", handleMessage);

	const terminate = () => {
		if (dead) return;
		dead = true;
		for (const { reject, timer } of pending.values()) {
			clearTimeout(timer);
			reject(new Error("Sandbox terminated"));
		}
		pending.clear();
		queued.length = 0;
		iframe.contentWindow?.postMessage({ type: "sandbox-terminate", token }, "*");
		window.removeEventListener("message", handleMessage);
		iframe.remove();
	};

	const run = (code: string, timeoutMs = defaultTimeoutMs) => {
		return new Promise<unknown>((resolve, reject) => {
			if (dead) {
				return reject(new Error("Sandbox is terminated"));
			}
			if (code.length > MAX_CODE_SIZE) {
				return reject(new Error("Code exceeds maximum size"));
			}
			const id = ++seq;
			const timer = window.setTimeout(() => {
				pending.delete(id);
				terminate(); // kill entire sandbox on timeout
				reject(new Error("Sandbox timed out"));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });

			if (ready) {
				iframe.contentWindow?.postMessage(
					{
						type: "sandbox-run",
						token,
						payload: { id, code, maxResultSize: MAX_RESULT_SIZE },
					},
					"*"
				);
			} else {
				queued.push({ id, code });
			}
		});
	};

	return { run, terminate };
}
