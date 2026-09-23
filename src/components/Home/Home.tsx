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

/** Step-by-step guide: how to turn MCP on for this project. */
const ENABLE_STEPS = [
  {
    title: '在路由文件头部声明 MCP Tool 信息',
    desc: '构建阶段扫描 agents 目录，解析路由入口文件头部 JSDoc 的 @mcp_ 字段并自动注册 Tool。',
    code:
      '// agents/chat/index.ts\n' +
      '/**\n' +
      ' * @mcp_tool_name chat\n' +
      ' * @mcp_description 与示例 Agent 对话，传入消息并返回聚合后的回复\n' +
      ' * @mcp_parameters\n' +
      ' *   message: { "type": "string", "description": "发送给 Agent 的用户消息", "required": true }\n' +
      ' *   // @mcp_hidden true 的路由不会暴露为 MCP Tool\n' +
      ' */',
    optional: false,
  },
  {
    title: '本地调试或部署到线上',
    desc: '无需额外编写 MCP Server，/mcp 端点随 Agent 一起自动运行。',
    code:
      'edgeone makers dev        # 本地调试 → http://localhost:8088/mcp\n' +
      'edgeone makers deploy     # 部署上线 → https://<你的域名>/mcp',
    optional: false,
  },
  {
    title: '在 MCP Client 中接入',
    desc: '粘贴到 CodeBuddy、Cursor、Claude Desktop 等 MCP 客户端；控制台配置区块可一键复制。',
    code: '{ "mcpServers": { "my-agent": { "url": "https://<你的域名>/mcp" } } }',
    optional: false,
  },
  {
    title: '开启鉴权（可选）',
    desc: '在 edgeone.json 写入 agents.auth（RS256 公钥），调用方需带 Authorization 头。',
    code:
      '// edgeone.json\n' +
      '{ "agents": { "auth": { "algorithm": "RS256", "verificationKeys": ["<RS256 公钥>"] } } }\n' +
      '\n' +
      '// MCP Client 请求头\n' +
      'Authorization: Bearer <your-JWT-token>',
    optional: true,
  },
];

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

/** Inline copy / copied glyphs (14px, currentColor). */
function CopyIcon() {
  return (
    <svg viewBox='0 0 24 24' width={14} height={14} fill='none' stroke='currentColor'
      strokeWidth={2} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <rect x='9' y='9' width='11' height='11' rx='2' />
      <path d='M5 15V5a2 2 0 0 1 2-2h10' />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox='0 0 24 24' width={14} height={14} fill='none' stroke='currentColor'
      strokeWidth={2.4} strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
      <path d='M20 6L9 17l-5-5' />
    </svg>
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
            <h1 className={styles.title}>Agents MCP Starter</h1>
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

        <div className={styles.cardGrid}>
        {/* ── How to enable MCP ── */}
        <section className={styles.card} aria-labelledby='mcp-steps'>
          <h2 id='mcp-steps' className={styles.cardTitle}>
            如何开启 MCP
          </h2>
          <p className={styles.cardDesc}>
            在 Makers 上部署 Agent 后，平台会自动为其暴露标准 MCP 端点，无需额外编写或部署
            MCP Server。按下面 4 步操作即可。
          </p>

          <ol className={styles.steps}>
            {ENABLE_STEPS.map((step, index) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.stepIndex} aria-hidden='true'>
                  {index + 1}
                </span>
                <div className={styles.stepBody}>
                  <p className={styles.stepTitle}>
                    {step.title}
                    {step.optional && <span className={styles.optionalTag}>可选</span>}
                  </p>
                  <p className={styles.stepDesc}>{step.desc}</p>
                  <pre className={styles.stepCode}>{step.code}</pre>
                </div>
              </li>
            ))}
          </ol>

          <p className={styles.stepsFoot}>
            完成后，用 <strong>MCP 配置</strong> 中的「检测 MCP 是否开启」即可验证端点状态。
          </p>
        </section>

        {/* ── MCP config ── */}
        <section className={styles.card} aria-labelledby='mcp-config'>
          <h2 id='mcp-config' className={styles.cardTitle}>
            MCP 配置
          </h2>
          <p className={styles.cardDesc}>
            当前部署的 Agent MCP Servers 配置，用于连接外部模型上下文服务。
          </p>

          {/* health check — kept at the top so the primary action is always visible */}
          <div className={`${styles.checkSection} ${styles.checkSectionTop}`}>
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
                    握手成功：端点已按 MCP Streamable-HTTP 协议响应，可将本卡片中的配置粘贴到
                    CodeBuddy、Cursor、Claude Desktop 等客户端直接使用。
                  </p>
                )}
              </div>
            ) : (
              <p className={styles.checkPlaceholder}>
                点击按钮后将向 <code>/mcp</code> 发起一次真实的 MCP
                握手（initialize → tools/list），并在此展示端点状态与已注册的工具。
              </p>
            )}
          </div>

          {/* config JSON — copy icon pinned to its bottom-right corner */}
          <div className={styles.codeWrap}>
            <pre className={styles.codeBlock} aria-label='MCP 客户端配置 JSON'>
              {mcpConfigJson}
            </pre>
            <button
              type='button'
              className={`${styles.iconCopyBtn} ${
                copied === 'json' ? styles.iconCopyBtnDone : ''
              }`}
              onClick={() => void copyText(mcpConfigJson, 'json')}
              aria-label='复制配置'
              title={copied === 'json' ? '已复制' : '复制配置'}
            >
              {copied === 'json' ? <CheckIcon /> : <CopyIcon />}
            </button>
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

        </section>
        </div>
      </div>
    </div>
  );
}
