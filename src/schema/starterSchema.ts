import { SchemaFactoryAlpha } from "@fluidframework/tree/alpha";
import { TreeViewConfiguration, TreeView } from "@fluidframework/tree";

const sf = new SchemaFactoryAlpha("8e2f6e9a-2d5a-4c43-8b11-7cf5f5c60f4f");

export class Item extends sf.object("Item", {
	id: sf.string,
	text: sf.string,
	done: sf.required(sf.boolean, { metadata: { description: "Whether the item is complete" } }),
	author: sf.optional(sf.string),
	updatedAt: sf.optional(sf.number),
}) {}

export class Items extends sf.array("Items", Item) {}

export class AppModel extends sf.object("AppModel", {
	title: sf.string,
	items: Items,
}) {}

export const starterTreeConfiguration = new TreeViewConfiguration({ schema: AppModel });

export type StarterTreeView = TreeView<typeof AppModel>;

export function getDefaultStarterContent(): AppModel {
	return new AppModel({
		title: "Fluid Starter",
		items: new Items([]),
	});
}
