/*!
 * Copyright (c) Microsoft Corporation and contributors. All rights reserved.
 * Licensed under the MIT License.
 */

// Import polyfills for iOS compatibility
import "./polyfills/crypto.js";
import "./polyfills/ios.js";
import "./index.css";

// Enable mobile debugging in development
if (import.meta.env.DEV) {
	import("eruda").then((eruda) => eruda.default.init());
}

import { startStarter } from "./start/starterStart.js";

startStarter();
