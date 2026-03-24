#!/usr/bin/env node

import { Command } from "commander";
import { startMCPHost, type HostOptions } from "./server.js";

const program = new Command()
  .name("ngrok-mcp-host")
  .description("Expose any MCP server as a remote MCP via ngrok tunnel")
  .version("0.1.0")
  .option("-p, --port <port>", "local HTTP server port", "8808")
  .option(
    "--ngrok-authtoken <token>",
    "ngrok auth token (env: NGROK_AUTHTOKEN)",
  )
  .option("--ngrok-domain <domain>", "custom ngrok domain")
  .option("--api-key <key>", "API key for request authentication")
  .option("--transport <type>", "transport type: sse, stream, both", "both")
  .option("--debug", "enable debug logging")
  .argument("<command...>", "MCP server command and args (use -- to separate)")
  .addHelpText(
    "after",
    `
Examples:
  $ ngrok-mcp-host -- npx -y @anthropic-ai/mcp-server-filesystem /path
  $ ngrok-mcp-host --ngrok-domain my.ngrok.app -- node server.js
  $ ngrok-mcp-host --api-key secret --port 3000 -- npx -y some-mcp-server
  $ NGROK_AUTHTOKEN=xxx ngrok-mcp-host -- python -m mcp_server`,
  )
  .action(async (commandArgs: string[], options: HostOptions) => {
    try {
      await startMCPHost(commandArgs, options);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\nError: ${message}`);
      process.exit(1);
    }
  });

program.parse();
