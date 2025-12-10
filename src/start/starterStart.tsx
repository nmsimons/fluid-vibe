import React from "react";
import { createRoot } from "react-dom/client";
import { AzureClient } from "@fluidframework/azure-client";
import { AttachState } from "fluid-framework";
import { getClientProps } from "../infra/azure/azureClientProps.js";
import { loadStarterContainer } from "../infra/sharedTreeClient.js";
import { createPresenceClients, PresenceUser } from "../infra/presenceClient.js";
import { createLlmClient } from "../infra/llmClient.js";
import { FluidProvider } from "../react/contexts/FluidContext.js";
import { StarterApp } from "../App.js";
import { adjectives, animals, colors, uniqueNamesGenerator } from "unique-names-generator";

function makeUser(): PresenceUser {
	const name = uniqueNamesGenerator({ dictionaries: [adjectives, colors, animals], length: 2 });
	return { id: crypto.randomUUID(), name };
}

export async function startStarter() {
	const host = document.getElementById("root");
	if (!host) {
		throw new Error("Root element '#root' not found");
	}

	const client = new AzureClient(getClientProps());
	const params = new URLSearchParams(window.location.search);
	let containerId = params.get("id") ?? "";

	const me = makeUser();
	const { container, tree } = await loadStarterContainer({ client, containerId });
	const presence = createPresenceClients(container, me);
	const llm = createLlmClient();

	if (container.attachState === AttachState.Detached) {
		containerId = await container.attach();
		const next = new URL(window.location.href);
		next.searchParams.set("id", containerId);
		window.history.replaceState({}, "", next.toString());
	}

	const root = createRoot(host);
	root.render(
		<React.StrictMode>
			<FluidProvider value={{ container, tree, presence, llm, me }}>
				<StarterApp />
			</FluidProvider>
		</React.StrictMode>
	);
}
