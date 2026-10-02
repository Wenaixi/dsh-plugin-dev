# Typert Remote RPC 跨端通信开发指南 (DSH 0.2.0-rc.2)

本文件是辅助开发 DeepSeek Harness (DSH 0.2.0-rc.2) 双面插件（Dual-Face Plugin）中 **Browser 前端 ↔ Host 服务端跨端 RPC 通信** 的权威实战指南。

---

## 一、跨端通信架构与核心角色分工

在 DSH 架构中，浏览器端（Browser）与服务端（Host Node.js）物理隔离：
- **浏览器端 (Browser)**：无法直接使用 `fs`、`child_process` 等 Node.js 原生模块；
- **服务端 (Host)**：掌管系统级能力、文件系统与核心大动脉服务总线；
- **通信桥梁**：统一由 **Typert Remote API 网关**（所属包 `@deepseek-ai/dsh-api-gateway`）调度，严禁插件私自开启额外的 HTTP 端口或 WebSocket。

```
┌────────────────────────────────────────────────────────┐
│               Browser 客户端 (React 组件)               │
│       调用: ctx.remote.<namespace>.<method>(args)       │
└───────────────────────────▲────────────────────────────┘
                            │
        HTTP POST /api/<namespace>/<method> (一元调用)
        WebSocket /api/remote.mux (流式通道)
                            │
┌───────────────────────────▼────────────────────────────┐
│              Host 服务端 (Node.js 宿主)                │
│       提供: @Remote 声明的 Service 类方法              │
└────────────────────────────────────────────────────────┘
```

---

## 二、Host 端服务暴露规范与方法签名四大硬约束

在 Host 宿主端，只有通过特定装饰器或描述符导出的方法，才会被 API 网关扫描并挂载到前端可访问的白名单路由中。

### 1. 方法签名四大硬性 AST 约束 (反模式拦截)
DSH 的 Typert 协议对远程暴露的方法签名有严格的静态语法检查，**违背以下规则会导致网关直接拒绝注册**：

1. **【禁止参数解构】**：必须使用单一名命对象参数。
   - ❌ 错误：`async readFile({ path, encoding })`
   - ✅ 正确：`async readFile(payload: { path: string, encoding: string })`
2. **【禁止参数默认值】**：不得在函数签名中指定默认值。
   - ❌ 错误：`async listFiles(limit = 20)`
   - ✅ 正确：在函数体内部处理缺省值 `const effectiveLimit = limit ?? 20;`
3. **【禁止剩余参数 (Rest Parameters)】**：不得使用不定长参数。
   - ❌ 错误：`async executeCommand(...args)`
4. **【协作式取消信号尾参规则】**：若方法支持客户端中断，最后一个参数必须是 `signal?: AbortSignal`。
   - ✅ 正确：`async longTask(payload: TaskPayload, signal?: AbortSignal)`

---

## 三、端到端完整实现范例

下面以一个“前端点击按钮查询宿主系统状态”的完整双面插件为例：

### 1. Host 服务端实现 (`index.js`)
```js
import { Service } from '@deepseek-ai/cordis';
import os from 'node:os';

export const name = 'dsh-system-info';

// 继承 Service 基类并注册为命名空间 systemInfo
export class SystemInfoService extends Service {
  constructor(ctx) {
    // 挂载在 Context 上的服务名为 systemInfo
    super(ctx, 'systemInfo', true);
  }

  // 必须使用标准扁平签名，最后一参为可选的 signal
  async getHostMetrics(payload, signal) {
    if (signal?.aborted) {
      throw new Error('请求已取消');
    }

    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      freeMemMB: Math.round(os.freemem() / 1024 / 1024),
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024)
    };
  }
}

export function apply(ctx) {
  // 注册服务
  ctx.plugin(SystemInfoService);
}
```

并在 `package.json` 中声明 exports 与 typert 映射：
```json
{
  "name": "dsh-system-info",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "exports": {
    ".": "./index.js",
    "./client": "./lib/client.js"
  },
  "dsh": {
    "bundle": { "id": "system-info" },
    "client": { "platform": "web", "module": "./lib/client.js" }
  }
}
```

---

### 2. Browser 客户端调用 (`lib/client.js`)
客户端组件直接通过 `ctx.remote.systemInfo.getHostMetrics()` 与宿主无缝通信：

```jsx
import React, { useState } from 'react';

export const name = 'dsh-system-info/client';

function SystemInfoSettingsPanel({ fetchMetrics }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleQuery = async () => {
    setLoading(true);
    try {
      const data = await fetchMetrics();
      setMetrics(data);
    } catch (err) {
      alert('查询失败: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '680px' }}>
      <h2>系统宿主状态</h2>
      <button onClick={handleQuery} disabled={loading} style={{ padding: '8px 16px', cursor: 'pointer' }}>
        {loading ? '查询中...' : '拉取最新宿主性能数据'}
      </button>

      {metrics && (
        <div style={{ marginTop: '16px', background: 'var(--dsw-alias-surface-secondary)', padding: '16px', borderRadius: '8px' }}>
          <div><strong>操作系统：</strong>{metrics.platform} ({metrics.arch})</div>
          <div><strong>Node 版本：</strong>{metrics.nodeVersion}</div>
          <div><strong>可用内存：</strong>{metrics.freeMemMB} MB / {metrics.totalMemMB} MB</div>
        </div>
      )}
    </div>
  );
}

export function apply(ctx) {
  // 向设置栏注册面板，并通过 props 将 remote 调用传递给纯 React 组件
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'system-info',
        order: 95,
        label: () => '系统状态'
      },
      () => (
        <SystemInfoSettingsPanel
          fetchMetrics={async () => {
            // 调用 Typert Remote RPC
            const res = await ctx.remote.systemInfo.getHostMetrics({});
            return res;
          }}
        />
      )
    )
  );
}
```

---

## 四、高级特性：响应式流式通道 (`mode: 'stream'`)

当需要从 Host 向 Client 持续实时推送数据（如日志流、终端滚动输出、下载进度）时，一元 RPC 无法满足需求。

### 1. 通信机制
- 在服务方法上声明 `@Remote({ mode: 'stream' })`；
- 通道严格经由 WebSocket 路径 **`/api/remote.mux`**（长连接多路复用信道）；
- Host 端通过 `ctx.invocation.uplink()` 建立管道，Client 得到 `RemoteStreamHandle`，通过异步迭代器（`for await (const chunk of handle)`）消费流。

### 2. 错误与中断处理
- 客户端传递 `signal: controller.signal`，调用 `controller.abort()` 会同步断开该路流式链接，并在 Host 端触发管道终止，绝不泄漏句柄。
