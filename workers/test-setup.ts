// Copyright (c) 2026 SonicStar Solutions Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { vi } from "vitest";

// The real `agents` package needs the Workers runtime (`cloudflare:workers`).
// Replace getAgentByName with a version that just resolves the namespace stub.
vi.mock("agents", () => ({
	getAgentByName: vi.fn(async (ns: any, name: string) => ns.get(ns.idFromName(name))),
	routeAgentRequest: async () => null,
}));
