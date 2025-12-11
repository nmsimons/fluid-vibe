import type { WorkerOptions } from "worker_threads"; // types only; browser Worker supports similar option shape

export type Sandbox = {
	run: (code: string, timeoutMs?: number) => Promise<unknown>;
	terminate: () => void;
};

const defaultTimeoutMs = 2000;

const workerSource = `
// Remove or neuter common egress primitives.
self.fetch = undefined;
self.XMLHttpRequest = undefined;
self.WebSocket = undefined;
try { delete self.EventSource; } catch (_) { /* ignore */ }
self.EventSource = undefined;
self.importScripts = undefined;
self.navigator = undefined;
self.caches = undefined;
self.indexedDB = undefined;
self.localStorage = undefined;
self.sessionStorage = undefined;

const run = (code) => {
	const fn = new Function("return (async () => { 'use strict';\n" + code + "\n})()");
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
	const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: number }>();

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
