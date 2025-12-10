import { AzureClient } from "@fluidframework/azure-client";
import { IFluidContainer, Tree } from "fluid-framework";
import { loadFluidData } from "./fluid.js";
import { containerSchema } from "../schema/containerSchema.js";
import {
	starterTreeConfiguration,
	getDefaultStarterContent,
	StarterTreeView,
	AppModel,
	Items,
	Item,
} from "../schema/starterSchema.js";

export type StarterContainerAssets = {
	container: IFluidContainer<typeof containerSchema>;
	tree: StarterTreeView;
};

export async function loadStarterContainer(props: {
	client: AzureClient;
	containerId: string;
}): Promise<StarterContainerAssets> {
	const { client, containerId } = props;
	const { container } = await loadFluidData(containerId, containerSchema, client);

	const tree = container.initialObjects.appData.viewWith(starterTreeConfiguration);
	if (tree.compatibility.canInitialize) {
		tree.initialize(getDefaultStarterContent());
	}

	return { container, tree };
}

export function addItem(tree: StarterTreeView, text: string, author?: string): void {
	const root = requireRoot(tree);
	Tree.runTransaction(root, () => {
		const newItem = new Item({
			id: crypto.randomUUID(),
			text,
			done: false,
			author,
			updatedAt: Date.now(),
		});
		root.items.insertAtEnd(newItem);
	});
}

export function toggleItem(tree: StarterTreeView, id: string): void {
	const root = requireRoot(tree);
	Tree.runTransaction(root, () => {
		const targetIndex = root.items.findIndex((item) => item.id === id);
		if (targetIndex === -1) {
			return;
		}
		const existing = root.items[targetIndex];
		root.items.removeAt(targetIndex);
		root.items.insertAt(
			targetIndex,
			new Item({
				...existing,
				done: !existing.done,
				updatedAt: Date.now(),
			})
		);
	});
}

export function updateTitle(tree: StarterTreeView, title: string): void {
	const root = requireRoot(tree);
	Tree.runTransaction(root, () => {
		root.title = title;
	});
}

export function replaceItems(tree: StarterTreeView, items: Item[]): void {
	const root = requireRoot(tree);
	Tree.runTransaction(root, () => {
		root.items = new Items(items);
	});
}

export type StarterSnapshot = Pick<AppModel, "title" | "items">;

export function getSnapshot(tree: StarterTreeView): StarterSnapshot {
	const root = requireRoot(tree);
	return {
		title: root.title,
		items: root.items,
	};
}

function requireRoot(tree: StarterTreeView) {
	const root = tree.root as AppModel | undefined;
	if (!root) {
		throw new Error("SharedTree root is missing or uninitialized");
	}
	return root;
}
