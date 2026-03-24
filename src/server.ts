import http from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { startHTTPServer, proxyServer } from "mcp-proxy";
import ngrok from "@ngrok/ngrok";

export interface HostOptions {
  port: string;
  ngrokAuthtoken?: string;
  ngrokDomain?: string;
  apiKey?: string;
  transport: string;
  debug?: boolean;
}

function debugLog(enabled: boolean, ...args: unknown[]): void {
  if (enabled) {
    console.error("[ngrok-mcp-host]", ...args);
  }
}

function resolveCommand(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: process.env.COMSPEC || "cmd.exe",
      args: ["/c", command, ...args],
    };
  }
  return { command, args };
}

export async function startMCPHost(
  commandArgs: string[],
  options: HostOptions,
): Promise<void> {
  const [rawCommand, ...rawArgs] = commandArgs;

  if (!rawCommand) {
    throw new Error(
      "No MCP server command specified.\nUsage: ngrok-mcp-host [options] -- <command> [args...]",
    );
  }

  const port = parseInt(options.port, 10);
  if (isNaN(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port: ${options.port}`);
  }

  const debug = !!options.debug;
  const resolved = resolveCommand(rawCommand, rawArgs);

  debugLog(debug, `Command: ${resolved.command} ${resolved.args.join(" ")}`);
  debugLog(debug, `Port: ${port}`);

  // Build startHTTPServer options
  const httpOptions: Record<string, unknown> = {
    createServer: async (_req: http.IncomingMessage) => {
      debugLog(debug, "New session: spawning MCP server subprocess...");

      const transport = new StdioClientTransport({
        command: resolved.command,
        args: resolved.args,
        env: process.env as Record<string, string>,
        stderr: "inherit",
      });

      const client = new Client(
        { name: "ngrok-mcp-host", version: "0.1.0" },
        { capabilities: {} },
      );

      await client.connect(transport);
      debugLog(debug, "Connected to local MCP server");

      const capabilities = client.getServerCapabilities() || {};
      const serverVersion = client.getServerVersion();

      debugLog(
        debug,
        `Server: ${serverVersion?.name}@${serverVersion?.version}`,
      );
      debugLog(debug, `Capabilities: ${JSON.stringify(capabilities)}`);

      const server = new Server(
        {
          name: serverVersion?.name || "mcp-server",
          version: serverVersion?.version || "0.0.0",
        },
        { capabilities },
      );

      await proxyServer({ server, client, serverCapabilities: capabilities });

      server.onclose = () => {
        debugLog(debug, "Session closed, cleaning up subprocess...");
        client.close().catch(() => {});
      };

      server.onerror = (error: Error) => {
        debugLog(debug, "Server error:", error.message);
      };

      return server;
    },
    port,
    host: "127.0.0.1",
  };

  if (options.apiKey) {
    httpOptions.apiKey = options.apiKey;
  }

  // Configure transport endpoints
  if (options.transport === "stream") {
    httpOptions.sseEndpoint = null;
  } else if (options.transport === "sse") {
    httpOptions.streamEndpoint = null;
  }

  // Start HTTP server
  let httpClose: () => Promise<void>;
  try {
    const result = await startHTTPServer(
      httpOptions as Parameters<typeof startHTTPServer>[0],
    );
    httpClose = result.close;
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
      throw new Error(
        `Port ${port} is already in use. Use --port to specify a different port.`,
        { cause: err },
      );
    }
    throw err;
  }

  debugLog(debug, `HTTP server listening on port ${port}`);

  // Start ngrok tunnel
  const ngrokConfig: Record<string, unknown> = {
    addr: port,
  };

  if (options.ngrokAuthtoken) {
    ngrokConfig.authtoken = options.ngrokAuthtoken;
  } else {
    ngrokConfig.authtoken_from_env = true;
  }

  if (options.ngrokDomain) {
    ngrokConfig.domain = options.ngrokDomain;
  }

  let listener: Awaited<ReturnType<typeof ngrok.forward>>;
  try {
    listener = await ngrok.forward(ngrokConfig);
  } catch (err: unknown) {
    await httpClose();
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes("authtoken") ||
      msg.includes("ERR_NGROK_105")
    ) {
      throw new Error(
        "ngrok authtoken is required.\n" +
          "Set NGROK_AUTHTOKEN env var or use --ngrok-authtoken flag.\n" +
          "Get yours at: https://dashboard.ngrok.com/get-started/your-authtoken",
        { cause: err },
      );
    }
    throw new Error(`ngrok tunnel failed: ${msg}`, { cause: err });
  }

  const url = listener.url();
  const sseEndpoint = options.transport === "stream" ? null : "/sse";
  const streamEndpoint = options.transport === "sse" ? null : "/mcp";
  const primaryEndpoint = streamEndpoint
    ? `${url}${streamEndpoint}`
    : `${url}${sseEndpoint}`;

  // Display connection info
  console.log("");
  console.log("  ngrok MCP Host");
  console.log("  ══════════════════════════════════════════");
  console.log(`  Command:  ${rawCommand} ${rawArgs.join(" ")}`);
  console.log(`  URL:      ${url}`);
  if (streamEndpoint) {
    console.log(`  Stream:   ${url}${streamEndpoint}`);
  }
  if (sseEndpoint) {
    console.log(`  SSE:      ${url}${sseEndpoint}`);
  }
  if (options.apiKey) {
    console.log("  Auth:     X-API-Key header required");
  }
  console.log("  ══════════════════════════════════════════");
  console.log("");
  console.log("  MCP client config:");
  console.log("");

  const clientConfig: Record<string, unknown> = {
    url: primaryEndpoint,
  };
  if (options.apiKey) {
    clientConfig.headers = { "X-API-Key": options.apiKey };
  }

  const configJson = JSON.stringify(
    { mcpServers: { remote: clientConfig } },
    null,
    2,
  );
  for (const line of configJson.split("\n")) {
    console.log(`  ${line}`);
  }

  console.log("");
  console.log("  Press Ctrl+C to stop");
  console.log("");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n  Shutting down...");
    try {
      await listener.close();
    } catch {
      /* ignore */
    }
    try {
      await httpClose();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}
