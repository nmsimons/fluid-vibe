import type { WorkerOptions } from "worker_threads"; // types only; browser Worker supports similar option shape

export type Sandbox = {
	run: (code: string, timeoutMs?: number) => Promise<unknown>;
	terminate: () => void;
};

const defaultTimeoutMs = 2000;

const workerSource = `
// Harden surface: remove/replace high-risk globals and freeze prototypes to block prototype-walking for egress primitives.
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
		"postMessage", // host communication is handled via onmessage; we leave self.postMessage but shadow global variable
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
		"Client"
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

// Keep private references to Function/AsyncFunction before we shadow them.
const FunctionCtor = Function;
const AsyncFunctionCtor = Object.getPrototypeOf(async function () {}).constructor;

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

self.onmessage = async (event) => {
	const { id, code } = event.data;
	try {
		const result = await run(code);
		self.postMessage({ id, ok: true, result });
	} catch (error) {
		self.postMessage({ id, ok: false, error: String(error) });
	}
};
`;

export function createSandbox(options?: WorkerOptions): Sandbox {
	const blob = new Blob([workerSource], { type: "application/javascript" });
	const url = URL.createObjectURL(blob);
	const worker = new Worker(url, { ...(options ?? {}), type: "module" });
	// Do not revoke immediately; keep URL valid for worker lifetime.

	let seq = 0;
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
			const id = ++seq;
			const timer = window.setTimeout(() => {
				pending.delete(id);
				worker.terminate();
				URL.revokeObjectURL(url);
				reject(new Error("Sandbox timed out"));
			}, timeoutMs);
			pending.set(id, { resolve, reject, timer });
			worker.postMessage({ id, code });
		});
	};

	return { run, terminate };
}
