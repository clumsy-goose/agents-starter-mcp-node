import { useCallback, useMemo, useState } from 'react';
import {
  checkMcpEndpoint,
  type McpCheckResult,
  type McpParamInfo,
} from '../../lib/mcpClient';
import { DECLARED_MCP_TOOLS } from '../../lib/agentMcpMeta';
import styles from './Home.module.css';

// ── Static page data ────────────────────────────────────────

/**
 * Tool metadata is NOT hardcoded here — it is parsed from the `@mcp_` JSDoc
 * blocks at the top of every route entry file in the agents directory by
 * src/lib/agentMcpMeta.ts. Once the /mcp handshake succeeds we prefer the
 * live `tools/list` schema.
 */
const DECLARED_TOOLS: DisplayTool[] = DECLARED_MCP_TOOLS.map(tool => ({
  name: tool.name,
  route: tool.file,
  desc: tool.description,
  params: tool.params,
  live: false,
}));

/** A tool as rendered on the page — declared data merged with the live result. */
interface DisplayTool {
  name: string;
  route: string;
  desc: string;
  params: McpParamInfo[];
  /** true when the schema came from a successful tools/list call */
  live: boolean;
}

// ── Small presentational helpers ────────────────────────────

function CopyButton({
  copied,
  onClick,
  label = '复制',
}: {
  copied: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button type='button' className={styles.copyBtn} onClick={onClick} aria-label={label}>
      {copied ? '已复制' : label}
    </button>
  );
}

// ── Page ────────────────────────────────────────────────────

export default function Home() {
  const mcpUrl = useMemo(() => `${window.location.origin}/mcp`, []);

  const mcpConfigJson = useMemo(
    () =>
      JSON.stringify(
        { mcpServers: { 'makers-agent': { url: mcpUrl } } },
        null,
        2,
      ),
    [mcpUrl],
  );

  const [copied, setCopied] = useState<'url' | 'json' | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<McpCheckResult | null>(null);

  const copyText = useCallback(async (text: string, which: 'url' | 'json') => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API unavailable (e.g. non-secure context) — fall back.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(which);
    window.setTimeout(() => setCopied(null), 1600);
  }, []);

  const handleCheck = useCallback(async () => {
    if (checking) return;
    setChecking(true);
    try {
      setResult(await checkMcpEndpoint());
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const status = useMemo<'idle' | 'ok' | 'auth' | 'down'>(() => {
    if (!result) return 'idle';
    if (result.ok) return 'ok';
    return result.httpStatus === 401 || result.httpStatus === 403 ? 'auth' : 'down';
  }, [result]);

  const statusMeta = {
    idle: { label: '待检测', cls: styles.statusIdle },
    ok: { label: 'MCP 已开启', cls: styles.statusOk },
    auth: { label: '需要鉴权', cls: styles.statusAuth },
    down: { label: 'MCP 不可用', cls: styles.statusDown },
  }[status];

  /**
   * Merge the declared tools with the live `tools/list` result — the live
   * schema wins, and tools the runtime exposes but that aren't declared here
   * are appended so the page never lies about what is actually registered.
   */
  const displayTools = useMemo<DisplayTool[]>(() => {
    const liveByName = new Map((result?.tools ?? []).map(t => [t.name, t]));

    const merged: DisplayTool[] = DECLARED_TOOLS.map(t => {
      const live = liveByName.get(t.name);
      if (!live) return t;
      return {
        ...t,
        desc: live.description || t.desc,
        params: live.params?.length ? live.params : t.params,
        live: true,
      };
    });

    for (const [name, live] of liveByName) {
      if (merged.some(m => m.name === name)) continue;
      merged.push({
        name,
        route: '—',
        desc: live.description ?? '',
        params: live.params ?? [],
        live: true,
      });
    }

    return merged;
  }, [result]);

  const totalParams = useMemo(
    () => displayTools.reduce((sum, t) => sum + t.params.length, 0),
    [displayTools],
  );

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* ── Title ── */}
        <header className={styles.hero}>
          <div className={styles.heroRow}>
            <span className={styles.logo}>⬡</span>
            <h1 className={styles.title}>OpenAI Agents Starter</h1>
          </div>
          <p className={styles.subtitle}>
            基于 EdgeOne Makers 运行的 OpenAI Agents SDK 示例。构建阶段会扫描 agents/
            目录并自动注册 MCP Tool，任意支持 MCP 的客户端都可以通过标准协议直接调用。
          </p>
          <div className={styles.heroBadges}>
            <span className={`${styles.heroBadge} ${styles.heroBadgePurple}`}>
              {displayTools.length} 个 MCP Tool
            </span>
            <span className={`${styles.heroBadge} ${styles.heroBadgePlain}`}>
              端点 <code>/mcp</code>
            </span>
          </div>
        </header>

        {/* ── MCP config ── */}
        <section className={styles.card} aria-labelledby='mcp-config'>
          <h2 id='mcp-config' className={styles.cardTitle}>
            MCP 配置
          </h2>
          <p className={styles.cardDesc}>
            当前部署的 Agent MCP Servers 配置，用于连接外部模型上下文服务。
          </p>

          {/* config JSON */}
          <pre className={styles.codeBlock} aria-label='MCP 客户端配置 JSON'>
            {mcpConfigJson}
          </pre>
          <div className={styles.codeActions}>
            <CopyButton
              copied={copied === 'json'}
              onClick={() => void copyText(mcpConfigJson, 'json')}
              label='复制配置'
            />
          </div>

          {/* server / tools summary */}
          <div className={styles.serverBox}>
            <div className={styles.serverHead}>
              <code className={styles.serverName}>makers-agent</code>
              <span className={styles.serverMeta}>
                {displayTools.length} tools · {totalParams} 参数 · 0 prompts
              </span>
              <span className={styles.authChip}>auth: none</span>
            </div>
            <ul className={styles.toolList}>
              {displayTools.map(tool => (
                <li key={tool.name} className={styles.toolItem}>
                  <div className={styles.toolHead}>
                    <code className={styles.toolName}>{tool.name}</code>
                    <code className={styles.toolRoute}>{tool.route}</code>
                  </div>

                  {tool.desc && <p className={styles.toolDesc}>{tool.desc}</p>}

                  {tool.params.length > 0 && (
                    <div className={styles.paramBox}>
                      <p className={styles.paramTitle}>参数 · {tool.params.length}</p>
                      <ul className={styles.paramList}>
                        {tool.params.map(param => (
                          <li key={param.name} className={styles.paramRow}>
                            <div className={styles.paramHead}>
                              <code className={styles.paramName}>{param.name}</code>
                              <span className={styles.typeBadge}>{param.type}</span>
                              <span
                                className={
                                  param.required ? styles.reqBadge : styles.optBadge
                                }
                              >
                                {param.required ? '必填' : '选填'}
                              </span>
                            </div>
                            {param.description && (
                              <p className={styles.paramDesc}>{param.description}</p>
                            )}
                            {(param.enum || param.default !== undefined) && (
                              <div className={styles.paramMeta}>
                                {param.enum && (
                                  <span className={styles.enumChip}>
                                    enum: {param.enum.join(' | ')}
                                  </span>
                                )}
                                {param.default !== undefined && (
                                  <span className={styles.defaultChip}>
                                    默认: {param.default}
                                  </span>
                                )}
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>

          {/* health check */}
          <div className={styles.checkSection}>
            <div className={styles.checkHead}>
              <button
                type='button'
                className={styles.checkBtn}
                onClick={() => void handleCheck()}
                disabled={checking}
                aria-busy={checking}
              >
                {checking ? (
                  <>
                    <span className={styles.spinner} aria-hidden='true' /> 检测中…
                  </>
                ) : (
                  '检测 MCP 是否开启'
                )}
              </button>
              <span
                className={`${styles.statusPill} ${statusMeta.cls}`}
                role='status'
                aria-live='polite'
              >
                {statusMeta.label}
              </span>
            </div>

            {result ? (
              <div className={styles.checkResult}>
                <dl className={styles.metaGrid}>
                  <div className={styles.metaItem}>
                    <dt>端点</dt>
                    <dd>
                      <code>{result.endpoint}</code>
                    </dd>
                  </div>
                  <div className={styles.metaItem}>
                    <dt>HTTP 状态</dt>
                    <dd>{result.httpStatus ?? '—'}</dd>
                  </div>
                  {result.ok && (
                    <>
                      <div className={styles.metaItem}>
                        <dt>会话 ID</dt>
                        <dd>
                          <code className={styles.sessionId}>
                            {result.sessionId ?? '—'}
                          </code>
                        </dd>
                      </div>
                      <div className={styles.metaItem}>
                        <dt>工具数量</dt>
                        <dd>{result.tools?.length ?? 0}</dd>
                      </div>
                    </>
                  )}
                </dl>

                {result.ok && result.tools && result.tools.length > 0 && (
                  <div className={styles.toolChips}>
                    {result.tools.map(t => (
                      <span key={t.name} className={styles.toolChip}>
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}

                {!result.ok && result.error && (
                  <p className={styles.checkError}>{result.error}</p>
                )}

                {result.ok && (
                  <p className={styles.checkHint}>
                    握手成功：端点已按 MCP Streamable-HTTP 协议响应，可将上方配置粘贴到
                    CodeBuddy、Cursor、Claude Desktop 等客户端直接使用。
                  </p>
                )}
              </div>
            ) : (
              <p className={styles.checkPlaceholder}>
                点击按钮后将向 <code>/mcp</code> 发起一次真实的 MCP
                握手（initialize → tools/list），并在此展示端点状态、协议版本与已注册的工具。
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
