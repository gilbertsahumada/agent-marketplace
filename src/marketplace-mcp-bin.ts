#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMarketplaceMcpServer } from "./marketplace-mcp.ts";

const server = createMarketplaceMcpServer();
await server.connect(new StdioServerTransport());
