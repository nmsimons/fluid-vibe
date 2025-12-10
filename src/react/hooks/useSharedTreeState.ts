import React from "react";
import { TreeBeta } from "@fluidframework/tree/alpha";
import type { TreeNode } from "@fluidframework/tree";

type TreeEvent = "nodeChanged" | "treeChanged";

/**
 * General-purpose tree subscription: give it any Tree node and a selector for derived state.
 * Defaults to `nodeChanged` (faster, ignores child edits). Pass `event="treeChanged"` to include subtree changes.
 */
export function useSharedTreeState<TNode extends TreeNode, T>(
	node: TNode,
	selector: (target: TNode) => T,
	event: TreeEvent = "nodeChanged"
): T {
	const compute = React.useCallback(() => selector(node), [selector, node]);

	const [snapshot, setSnapshot] = React.useState<T>(() => compute());

	React.useEffect(() => {
		const offTree = TreeBeta.on(node, event, () => setSnapshot(compute()));
		return () => {
			offTree();
		};
	}, [node, event, compute]);

	return snapshot;
}
