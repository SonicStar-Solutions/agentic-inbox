// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { defineConfig } from "vitest/config";

// Unit tests run in plain Node. They cover pure logic and Hono routes driven
// through `app.request()` with fake bindings, so the Cloudflare Vite plugin is
// intentionally not loaded here.
export default defineConfig({
	test: {
		environment: "node",
		include: ["workers/**/*.test.ts", "shared/**/*.test.ts", "app/**/*.test.ts"],
	},
});
