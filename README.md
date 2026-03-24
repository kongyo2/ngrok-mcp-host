# @kongyo2/ngrok-mcp-host

Expose any local MCP (Model Context Protocol) server as a remote MCP server via ngrok tunnel.

Takes any stdio-based MCP server command and makes it accessible over the internet through ngrok, supporting both Streamable HTTP and SSE transports.

## Quick Start

```bash
export NGROK_AUTHTOKEN=your_token_here

npx @kongyo2/ngrok-mcp-host -- npx -y @anthropic-ai/mcp-server-filesystem /path/to/dir
```

## Install

```bash
npm install -g @kongyo2/ngrok-mcp-host
```

## Prerequisites

- Node.js 18+
- ngrok authtoken — [get one here](https://dashboard.ngrok.com/get-started/your-authtoken)

## Usage

```
ngrok-mcp-host [options] -- <command> [args...]
```

### Options

| Option                      | Description               | Default               |
| --------------------------- | ------------------------- | --------------------- |
| `-p, --port <port>`         | Local HTTP server port    | `8808`                |
| `--ngrok-authtoken <token>` | ngrok auth token          | `NGROK_AUTHTOKEN` env |
| `--ngrok-domain <domain>`   | Custom ngrok domain       | auto                  |
| `--api-key <key>`           | API key for request auth  | —                     |
| `--transport <type>`        | `sse` / `stream` / `both` | `both`                |
| `--debug`                   | Enable debug logging      | off                   |

### Examples

```bash
# Basic
ngrok-mcp-host -- npx -y @anthropic-ai/mcp-server-filesystem ~/docs

# Custom domain + API key
ngrok-mcp-host --ngrok-domain my-mcp.ngrok.app --api-key s3cret -- node server.js

# SSE only
ngrok-mcp-host --transport sse -- npx -y some-mcp-server

# Debug mode with custom port
ngrok-mcp-host --port 3000 --debug -- python -m mcp_server
```

## Output

```
  ngrok MCP Host
  ══════════════════════════════════════════
  Command:  npx -y @anthropic-ai/mcp-server-filesystem /path
  URL:      https://abc123.ngrok.app
  Stream:   https://abc123.ngrok.app/mcp
  SSE:      https://abc123.ngrok.app/sse
  ══════════════════════════════════════════

  MCP client config:

  {
    "mcpServers": {
      "remote": {
        "url": "https://abc123.ngrok.app/mcp"
      }
    }
  }

  Press Ctrl+C to stop
```

Copy the config JSON into your MCP client (Claude Desktop, etc.) to connect.

## How It Works

1. Spawns the MCP server as a subprocess (stdio transport)
2. Creates a local HTTP server with Streamable HTTP and/or SSE endpoints
3. Proxies MCP messages between HTTP clients and the subprocess
4. Tunnels the local HTTP server through ngrok

## License

MIT
