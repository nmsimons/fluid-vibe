import React from "react";
import { IFluidContainer } from "fluid-framework";
import { getPresence } from "@fluidframework/presence/beta";
import { createUsersManager } from "../presence/users.js";
import { createCursorManager } from "../presence/cursor.js";
import { User, UsersManager } from "../presence/Interfaces/UsersManager.js";
import { CursorManager, CursorState } from "../presence/Interfaces/CursorManager.js";

export type PresenceClients = {
	users: UsersManager;
	cursor: CursorManager;
	dispose: () => void;
};

export type PresenceUser = { id: string; name: string; image?: string };

export function createPresenceClients(
	container: IFluidContainer,
	me: PresenceUser
): PresenceClients {
	const presence = getPresence(container);
	const workspace = presence.states.getWorkspace("workspace:starter", {});

	const users = createUsersManager({
		name: "users:starter",
		workspace,
		me,
	});

	const cursor = createCursorManager({
		name: "cursor:starter",
		workspace,
	});

	const dispose = () => {
		// No-op cleanup placeholder; managers expose unsubscribe per listener.
	};

	return { users, cursor, dispose };
}

export function usePresenceUsers(users: UsersManager): readonly User[] {
	const [current, setCurrent] = React.useState<readonly User[]>(users.getConnectedUsers());

	React.useEffect(() => {
		const update = () => setCurrent(users.getConnectedUsers());
		const offLocal = users.events.on("localUpdated", update);
		const offRemote = users.events.on("remoteUpdated", update);
		update();
		return () => {
			offLocal();
			offRemote();
		};
	}, [users]);

	return current;
}

export function useCursorPresence(cursor: CursorManager): CursorState | null {
	const [state, setState] = React.useState<CursorState | null>(cursor.state.local);

	React.useEffect(() => {
		const update = () => setState(cursor.state.local);
		const unsubscribe = cursor.events.on("localUpdated", update);
		return () => unsubscribe();
	}, [cursor]);

	return state;
}
