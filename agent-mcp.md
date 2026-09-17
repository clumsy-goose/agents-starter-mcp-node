在 Makers 上部署 Agent 后，通过配置，平台会为该 Agent 自动暴露一个标准 MCP（Model Context Protocol）端点。无需额外编写或部署任何 MCP Server，CodeBuddy、CodexDesktop、Cursor 等任意支持 MCP 的 AI 工具，都能通过标准协议直接发现并调用你的 Agent 能力。
平台会将 Agent 的每个路由自动注册为一个独立的 MCP Tool，AI 通过 tool name 与 description 的语义直接选择调用。配合可选的鉴权配置，你可以将 Agent 安全地开放给协作者、终端用户或公开使用。

开启 MCP 服务


在 Agent 路由文件头部声明 MCP Tool 信息

构建阶段会扫描 agents/ 目录，解析每个路由文件 头部注释块 中以 mcp_ 为前缀的字段，当存在 mcp_* 时，注册该条 Agent 路由作为 MCP Tool 在/mcp 上运行 MCP 服务。
在 Node Agent 使用 JSDoc 格式进行注释，字段以 @mcp_ 开头：

// agents/deep-research/index.ts
/**
 * @mcp_description 深度调研，给定主题后搜索网络并输出结构化研究报告
 * @mcp_parameters
 *   topic: { "type": "string", "description": "调研主题关键词", "required": true }
 *   depth: { "type": "string", "description": "调研深度", "enum": ["quick", "medium", "deep"], "default": "medium" }
 */
export async function onRequest(context: any) {
}



声明后，deep_research 会以精确的参数 schema 注册为 MCP Tool，AI 能更准确地选择并填充参数。上述示例最终生成的 MCP Tool 如下：


{
  "name": "deep_research",
  "description": "深度调研，给定主题后搜索网络并输出结构化研究报告",
  "inputSchema": {
    "type": "object",
    "properties": {
      "topic": {
        "type": "string",
        "description": "调研主题关键词"
      },
      "depth": {
        "type": "string",
        "description": "调研深度",
        "enum": ["quick", "medium", "deep"],
        "default": "medium"
      }
    },
    "required": ["topic"]
  }
}




﻿


运行 edgeone makers dev进行地本地调试或部署到线上，将在/mcp端点上运行 MCP 服务。例如本地调试模式下的 MCP url 为http://localhost:8088/mcp

MCP Tool 信息注释字段说明

﻿

字段
类型
说明
不填时的默认行为
mcp_tool_name
string
自定义 MCP Tool 名称
取路由名（去掉前导 /，/ 与 - 转 _），如 /code-review → code_review
mcp_description
string
Tool 的描述，AI 据此选择是否调用
取文件注释首行；再无则用 Agent route: /{route}
mcp_parameters
object
参数 schema，键为参数名，值为 { type, description, required, enum, default }
默认仅含 message（string）参数
mcp_required
array
必填参数名列表
默认 [message]
mcp_hidden
boolean
设为 true 时该路由不暴露为 MCP Tool
默认 false（正常暴露）


列宽 176px



列宽 88px



列宽 379px



列宽 326px











﻿


Node Agent：使用 JSDoc 格式进行注释，字段以 @mcp_ 开头：（如 @mcp_description、@mcp_parameters）。
Python Agent：使用 DocStrings 格式进行注释，字段以 @mcp_ 开头：，字段以 mcp_ 开头。
﻿

待运行Language: java
python
go
javascript
typescript
php
c
cpp
bash

json
xml
yaml

plaintext
objectivec
swift
perl
django
tsx
jsx
html
markdown
css
scss
less
csharp
sql
graphql
atom
cmake
docker
hcl
latex
lua
makefile
mathml
matlab
protobuf
r
ruby
rss
svg
ssml
wasm




运行


# agents/research/index.py
"""
mcp_tool_name: deep_research
mcp_description: 深度调研，给定主题后搜索网络并输出结构化研究报告
mcp_parameters:
  topic:
    type: string
    description: 调研主题关键词
    required: true
  depth:
    type: string
    description: 调研深度
    enum: [quick, medium, deep]
    default: medium
"""
async def handler(ctx):
    ...





说明：
mcp_description 的优先级高于文件注释首行；若两者都未提供，平台回退到默认描述。Tool 描述越精准，AI 选择该 Tool 的准确率越高，建议每个对外暴露的路由都显式声明 mcp_description。




认证配置

MCP 端点可以使用 JWT 鉴权（Authorization: Bearer {JWT token}）。通过在 edgeone.json 中写入 agents.auth 配置，开启 Agent 鉴权（参考文档：Agent 鉴权（新））。在调用 MCP 时，需要设置请求头 Authorization: Bearer {JWT token}。

{
  "agents": {
    "auth": {
      "algorithm": "RS256",
      "verificationKeys": [
        "-----BEGIN PUBLIC KEY1-----\nMIIBIjANBgkqh...\n-----END PUBLIC KEY1-----"
        "-----BEGIN PUBLIC KEY2-----\nAMIIBCgKCAQEA...\n-----END PUBLIC KEY2-----"
      ]
    }
  }
}




﻿



控制台获取配置片段

部署后，在构建部署/Agents 的 MCP 配置区块可直接看到用于 MCP Client 的配置片段，并提供一键复制。








说明：
项目绑定了自定义域名时，URL 会显示自定义域名，若域名尚未完成接入（CNAME / 归属权验证）或 HTTPS 证书未就绪（未配置 / 过期 / 部署中 / 部署失败），对应 url 行会显示问号图标并悬浮提示，MCP 连接将因此失败，请先前往域名管理处理。项目未绑定自定义域名，url 会显示部署域名，同时存在 "headers" : { "Cookie": "xxxx" },Cookie 的有效期为 3 小时




在 MCP Client 中接入

将控制台复制的配置片段粘贴到对应 MCP 客户端的配置文件即可。

无鉴权




{
  "mcpServers": {
    "my-agent": {
      "url": "https://xxxxxx/mcp"
    }
  }
}




﻿



鉴权模式




{
  "mcpServers": {
    "my-agent": {
      "url": "https://xxxxxx/mcp",
      "headers": {
        "Authorization": "Bearer <your-JWTtoken>" 
      }
    }
  }
}




﻿



使用约束

不支持流式 Tool 结果：MCP tools/call 为请求-响应模式。对执行时间可能超过 60s 的 Agent（如深度调研），建议通过 notifications/progress 定期上报心跳，避免 Claude Desktop / Cursor 等客户端单方面超时断连。
路由数量建议：单个 Agent 路由建议不超过 15 个，过多会降低 AI 选择 tool 的准确率；可通过 metadata 标记 mcp_hidden: true 隐藏无需暴露的路由。
自定义域名要求：使用自定义域名时，必须完成接入验证且 HTTPS 证书处于就绪状态，否则 MCP 连接失败。
国内站预设域名时效：国内站使用项目预设域名时，鉴权 Cookie 仅有 3 小时时效，为保证稳定使用请为项目绑定自定义域名。

最佳实践

在 Agent 模版中开启 MCP 服务并接入 CodeBuddy
