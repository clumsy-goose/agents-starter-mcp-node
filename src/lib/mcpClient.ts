/**
 * Minimal MCP (Model Context Protocol) client — homepage only.
 * ============================================================
 *
 * Powers the "检测 MCP 状态" button on the home page. It performs a real
 * JSON-RPC handshake against the Streamable-HTTP MCP endpoint (`/mcp`)
 * exposed by the EdgeOne Makers runtime:
 *
 *   1. POST `initialize`        → protocol version + serverInfo + session id
 *   2. POST `notifications/initialized` (best-effort)
 *   3. POST `tools/list`        → exposed tool names
 *
 * The runtime may answer with a plain JSON body or an SSE stream
 * (`text/event-stream`), so response parsing handles both.
 */

/** A single parameter of a MCP tool, derived from its JSON-Schema inputSchema. */
export interface McpParamInfo {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  /** Parsed `inputSchema` — shown as the parameter table on the home page. */
  params?: McpParamInfo[];
}

export interface McpCheckResult {
  /** true when the initialize handshake succeeded */
  ok: boolean;
  endpoint: string;
  latencyMs: number;
  httpStatus?: number;
  protocolVersion?: string;
  serverName?: string;
  serverVersion?: string;
  sessionId?: string;
  tools?: McpToolInfo[];
  /** human-readable failure reason (Chinese, shown directly in the UI) */
  error?: string;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: {
    protocolVersion?: string;
    serverInfo?: { name?: string; version?: string };
    tools?: unknown;
  };
  error?: { code?: number; message?: string } | null;
}

/** Protocol revision advertised by this client; the server negotiates down if needed. */
const PROTOCOL_VERSION = '2025-03-26';

/** Parse a response body that may be plain JSON or an SSE stream. */
function extractJsonRpc(payload: string, contentType: string): JsonRpcResponse | null {
  const trimmed = payload.trim();
  if (!trimmed) return null;

  const looksLikeSse =
    contentType.includes('text/event-stream') ||
    trimmed.startsWith('event:') ||
    trimmed.startsWith('data:');

  if (looksLikeSse) {
    // Scan from the end: the last parsable `data:` line wins.
    const lines = trimmed.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.startsWith('data:')) continue;
      try {
        return JSON.parse(line.slice(5).trim()) as JsonRpcResponse;
      } catch {
        /* keep scanning */
      }
    }
    return null;
  }

  try {
    return JSON.parse(trimmed) as JsonRpcResponse;
  } catch {
    return null;
  }
}

interface RpcCallResult {
  status: number;
  json: JsonRpcResponse | null;
  sessionId?: string;
}

async function rpc(
  url: string,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<RpcCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  return {
    status: res.status,
    json: extractJsonRpc(await res.text(), res.headers.get('content-type') ?? ''),
    sessionId: res.headers.get('mcp-session-id') ?? sessionId,
  };
}

/** Run the full MCP handshake against `endpoint` (defaults to `<origin>/mcp`). */
export async function checkMcpEndpoint(endpoint?: string): Promise<McpCheckResult> {
  const url = endpoint ?? `${window.location.origin}/mcp`;
  const started = performance.now();
  const base = { endpoint: url, latencyMs: 0, ok: false };

  try {
    const init = await rpc(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'makers-homepage', version: '1.0.0' },
      },
    });
    const latencyMs = Math.round(performance.now() - started);

    if (init.status === 401 || init.status === 403) {
      return {
        ...base,
        ok: false,
        latencyMs,
        httpStatus: init.status,
        error: `MCP 端点已开启鉴权（HTTP ${init.status}），需要携带有效凭证（如 Bearer Token）才能访问。`,
      };
    }
    if (init.status !== 200 || !init.json || init.json.error) {
      return {
        ...base,
        ok: false,
        latencyMs,
        httpStatus: init.status,
        error:
          init.json?.error?.message ||
          `连接失败（HTTP ${init.status}），/mcp 端点可能未开启或不可达。`,
      };
    }

    const result = init.json.result ?? {};
    const sessionId = init.sessionId;

    // notifications/initialized completes the handshake; failure is non-fatal.
    try {
      await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
    } catch {
      /* ignore */
    }

    let tools: McpToolInfo[] | undefined;
    try {
      const list = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId);
      const raw = list.json?.result?.tools;
      if (Array.isArray(raw)) {
        tools = raw
          .map(item => {
            const t = (item ?? {}) as Record<string, unknown>;
            const schema = (t.inputSchema ?? {}) as {
              properties?: Record<string, Record<string, unknown>>;
              required?: unknown;
            };
            const required = new Set(
              Array.isArray(schema.required) ? schema.required.map(String) : [],
            );
            const params: McpParamInfo[] = Object.entries(schema.properties ?? {}).map(
              ([name, prop]) => ({
                name,
                type: String(prop?.type ?? 'string'),
                required: required.has(name),
                description: typeof prop?.description === 'string' ? prop.description : undefined,
                enum: Array.isArray(prop?.enum) ? prop.enum.map(String) : undefined,
                default: prop?.default === undefined ? undefined : String(prop.default),
              }),
            );
            return {
              name: String(t.name ?? ''),
              description: typeof t.description === 'string' ? t.description : undefined,
              params,
            };
          })
          .filter(t => t.name);
      }
    } catch {
      /* tools/list is optional for the status check */
    }

    const serverInfo = result.serverInfo ?? {};
    return {
      ok: true,
      endpoint: url,
      latencyMs: Math.round(performance.now() - started),
      httpStatus: init.status,
      protocolVersion: result.protocolVersion,
      serverName: serverInfo.name,
      serverVersion: serverInfo.version,
      sessionId,
      tools,
    };
  } catch (e) {
    return {
      ...base,
      latencyMs: Math.round(performance.now() - started),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
