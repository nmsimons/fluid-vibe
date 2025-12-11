import type { WorkerOptions } from "worker_threads"; // types only; browser Worker supports similar option shape

export type Sandbox = {
	run: (code: string, timeoutMs?: number) => Promise<unknown>;
	terminate: () => void;
};

const defaultTimeoutMs = 2000;

const MAX_CODE_SIZE = 64 * 1024; // 64 KB
const MAX_RESULT_SIZE = 1024 * 1024; // 1 MB

const workerSource = `
// Harden surface: remove/replace high-risk globals and freeze prototypes to block prototype-walking for egress primitives.

// Capture postMessage before we kill it so we can still communicate with host.
const _postMessage = self.postMessage.bind(self);

(() => {
	const kill = (name) => {
		try { delete self[name]; } catch (_) { /* ignore */ }
		try { self[name] = undefined; } catch (_) { /* ignore */ }
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

	// Freeze core prototypes and constructors to make resurrection harder.
	const freezeSafe = (obj) => { try { Object.freeze(obj); } catch (_) { /* ignore */ } };
	[
		Object,
		Function,
		Array,
		Map,
		Set,
		WeakMap,
		WeakSet,
		Promise,
		RegExp,
		Date,
		Number,
		String,
		Boolean,
		Symbol,
		Error
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

// Shadow dynamic code creators in the global scope.
try { self.Function = undefined; } catch (_) { /* ignore */ }
try { self.eval = undefined; } catch (_) { /* ignore */ }
try { self.AsyncFunction = undefined; } catch (_) { /* ignore */ }

const run = (code) => {
	// Inside user code, also shadow these names.
	const wrapped = "'use strict'; const Function = undefined; const AsyncFunction = undefined; const eval = undefined; return (async () => {\n" + code + "\n})()";
	const fn = FunctionCtor(wrapped);
	return fn();
};

const sanitizeError = (err) => {
	const msg = String(err);
	// Strip file paths and internal details
	return msg.replace(/([A-Za-z]:|\\/).+?:\\d+/g, '[path]').slice(0, 500);
};

self.onmessage = async (event) => {
	const { id, code, maxResultSize } = event.data;
	try {
		const result = await run(code);
		// Approximate size check on result
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

export function createSandbox(options?: WorkerOptions): Sandbox {
	const blob = new Blob([workerSource], { type: "application/javascript" });
	const url = URL.createObjectURL(blob);
	const worker = new Worker(url, { ...(options ?? {}), type: "module" });
	// Do not revoke immediately; keep URL valid for worker lifetime.

	let seq = 0;
	let dead = false;
	const pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: number }
	>();

	worker.onmessage = (event: MessageEvent) => {
		const { id, ok, result, error } = event.data ?? {};
		const entry = pending.get(id);
		if (!entry) return;
		pending.delete(id);
		clearTimeout(entry.timer);
		if (ok) {
			entry.resolve(result);
		} else {
			entry.reject(new Error(typeof error === "string" ? error : "Sandbox error"));
		}
	};

	const terminate = () => {
		if (dead) return;
		dead = true;
		for (const { reject, timer } of pending.values()) {
			clearTimeout(timer);
			reject(new Error("Sandbox terminated"));
		}
		pending.clear();
		worker.terminate();
		URL.revokeObjectURL(url);
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
				dead = true;
				worker.terminate();
				URL.revokeObjectURL(url);
				reject(new Error("Sandbox timed out"));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
			worker.postMessage({ id, code, maxResultSize: MAX_RESULT_SIZE });
		});
	};

	return { run, terminate };
}
