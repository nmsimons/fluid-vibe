import React from "react";
import { TreeBeta } from "@fluidframework/tree/alpha";
import { StarterTreeView, AppModel } from "../../schema/starterSchema.js";

export function useSharedTreeState<T>(tree: StarterTreeView, selector: (root: AppModel) => T): T {
	const getRoot = React.useCallback(() => {
		const root = tree.root as AppModel | undefined;
		if (!root) {
			throw new Error("SharedTree root not initialized");
		}
		return root;
	}, [tree]);

	const compute = React.useCallback(() => selector(getRoot()), [selector, getRoot]);

	const [snapshot, setSnapshot] = React.useState<T>(() => compute());

	React.useEffect(() => {
		const root = getRoot();
		const offTree = TreeBeta.on(root, "treeChanged", () => setSnapshot(compute()));
		return () => {
			offTree();
		};
	}, [getRoot, compute]);

	return snapshot;
}
