/**
 * Agent route MCP metadata — parsed from source, never hardcoded.
 * ==============================================================
 *
 * The EdgeOne build pipeline scans `agents/<route>/index.ts`, reads the head
 * JSDoc block and registers a MCP tool for every `@mcp_*` field it finds
 * (see agent-mcp.md). This module applies the exact same contract on the
 * client side: the route sources are bundled as raw strings via
 * `import.meta.glob`, parsed here, and rendered by the homepage — so the page
 * can never drift from the declarations in the route files.
 *
 * Supported fields (exactly the four the platform recognises):
 *   @mcp_tool_name     custom tool name (default: route dir, `/` and `-` → `_`)
 *   @mcp_description   tool description (default: first comment line)
 *   @mcp_parameters    one `name: { ...json schema... }` per line;
 *                      `required: true` is read from each parameter's JSON
 *   @mcp_hidden        `true` → the route is NOT exposed as a MCP tool
 *
 * Registration rule (agent-mcp.md): a route is exposed as a MCP tool ONLY when
 * its head comment declares at least one `@mcp_` field. A route without any
 * declaration (e.g. agents/stop/index.ts) is NOT registered — no tool, no
 * default schema. The defaults above only fill in individual fields that a
 * declared route happens to omit.
 */

export interface AgentMcpParam {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: string;
}

export interface AgentMcpToolMeta {
  name: string;
  /** HTTP route, e.g. `/chat` */
  route: string;
  /** Source file the declaration came from, e.g. `agents/chat/index.ts` */
  file: string;
  description: string;
  params: AgentMcpParam[];
}

/** Raw sources of every route entry file, keyed by project-relative path. */
const routeSources = import.meta.glob('/agents/*/index.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Head `/** ... *\/` block — the only place `@mcp_*` fields are read from. */
function readHeadComment(source: string): string | null {
  const start = source.indexOf('/**');
  if (start === -1) return null;

  // Only whitespace and `//` line comments may precede the head block.
  const before = source.slice(0, start);
  const illegal = before
    .split('\n')
    .some(line => line.trim() && !line.trim().startsWith('//') && !line.trim().startsWith('/*'));
  if (illegal) return null;

  const end = source.indexOf('*/', start + 3);
  if (end === -1) return null;
  return source.slice(start + 3, end);
}

interface ParsedBlock {
  tags: Record<string, string[]>;
  firstProse: string;
}

function parseBlock(block: string): ParsedBlock {
  const tags: Record<string, string[]> = {};
  let firstProse = '';
  let current: string | null = null;

  for (const rawLine of block.split('\n')) {
    // Strip the leading ` * ` / ` *` JSDoc prefix.
    const line = rawLine.replace(/^\s*\*[ ]?/, '').trim();
    if (!line || line === '*') continue;

    const tag = /^@(mcp_\w+)\s*(.*)$/.exec(line);
    if (tag) {
      current = tag[1];
      tags[current] ??= [];
      if (tag[2]) tags[current].push(tag[2]);
      continue;
    }

    // Continuation lines belong to the tag above (e.g. @mcp_parameters entries).
    if (current) {
      tags[current].push(line);
      continue;
    }
    if (!firstProse) firstProse = line;
  }

  return { tags, firstProse };
}

/**
 * `@mcp_parameters` entries — each line is `name: { "type": ..., ... }`.
 * `required` comes from the parameter's own JSON (`"required": true`).
 */
function parseParams(lines: string[] | undefined): AgentMcpParam[] {
  const params: AgentMcpParam[] = [];

  for (const line of lines ?? []) {
    const match = /^([A-Za-z_$][\w$]*)\s*:\s*(\{.*\})\s*$/.exec(line.trim());
    if (!match) continue;

    let spec: Record<string, unknown> | null = null;
    try {
      spec = JSON.parse(match[2]) as Record<string, unknown>;
    } catch {
      spec = null;
    }

    const name = match[1];
    params.push({
      name,
      type: typeof spec?.type === 'string' ? spec.type : 'string',
      required: spec?.required === true,
      description: typeof spec?.description === 'string' ? spec.description : undefined,
      enum: Array.isArray(spec?.enum) ? spec.enum.map(String) : undefined,
      default: spec?.default === undefined ? undefined : String(spec.default),
    });
  }

  // Default schema when nothing is declared: a single required `message`.
  if (params.length === 0) {
    return [{ name: 'message', type: 'string', required: true }];
  }
  return params;
}

function parseRouteFile(key: string, source: string): AgentMcpToolMeta | null {
  const file = key.replace(/^\//, '');
  const block = readHeadComment(source);
  if (!block) return null;

  const { tags, firstProse } = parseBlock(block);

  // No `@mcp_` field at all → the platform does not register this route.
  const declaresMcp = Object.keys(tags).some(tag => tag.startsWith('mcp_'));
  if (!declaresMcp) return null;

  const hidden = (tags.mcp_hidden?.[0] ?? '').trim().toLowerCase() === 'true';
  if (hidden) return null;

  // agents/<dir>/index.ts → route `/<dir>`; nested dirs keep their path.
  const parts = file.split('/');
  const dir = parts.length >= 3 ? parts[1] : parts[0];
  const route = `/${dir}`;

  const name = (tags.mcp_tool_name?.[0] ?? '').trim() || dir.replace(/[/-]/g, '_');
  const description =
    (tags.mcp_description?.[0] ?? '').trim() || firstProse || `Agent route: ${route}`;

  return {
    name,
    route,
    file,
    description,
    params: parseParams(tags.mcp_parameters),
  };
}

/** Tools declared in the route files, in source order. */
export const DECLARED_MCP_TOOLS: AgentMcpToolMeta[] = Object.entries(routeSources)
  .map(([key, source]) => parseRouteFile(key, source))
  .filter((tool): tool is AgentMcpToolMeta => tool !== null)
  .sort((a, b) => a.file.localeCompare(b.file));
