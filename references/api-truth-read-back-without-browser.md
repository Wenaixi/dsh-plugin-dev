# 不带浏览器的 API 真值回读：token、cookie 与 RPC 报文形态

> 适用范围：验证插件行为、配置写入、命名空间消失等场景时，**不用打开浏览器**直接向运行中的宿主问真值。
> 核心命题：DSH Web 宿主的 `/api/*` 是 Typert RPC 网关，用对了报文三件套（认证、端点、payload），任何插件都能绕过 UI 直接回读配置与状态——这比截图和 DOM 断言可靠得多。

---

## 一、认证三件套（顺序不能乱）

1. 启动日志/启动输出里有鉴权 URL：`http://127.0.0.1:<port>/?token=<launch-token>`。
2. **带 token 请求根路径一次**：服务端校验 token 后签发 `dsh-auth-*` 签名 cookie（并 303 到干净路径）。
3. 之后所有 `/api/*` 请求**带这个 cookie**。只带 token 或只带 Authorization 头都会 401（`unauthorized`）。

PowerShell 取证骨架：

```powershell
# 1) 拿 cookie（-SessionVariable 存会话）
Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/?token=$TOKEN" -UseBasicParsing -SessionVariable sess

# 2) 之后全部 -WebSession $sess
Invoke-WebRequest -Uri "http://127.0.0.1:$PORT/api/settings/describe" -Method Post -WebSession $sess ^
  -ContentType 'application/json' -Body $msg
```

---

## 二、RPC 报文形态（Typert 网关）

`/api/<方法名>` 的 POST 体是固定四段：

```js
{
  "type": "client-request",
  "rpcId": "<任意的 UUID>",
  "method": "settings/describe",        // 端点的短方法名（不是 typeSymbol 长 id）
  "payload": { "args": { ... } }        // 参数必须包在 args 里
}
```

三个高频报错即三处形状错误：

| 报错 | 原因 | 修法 |
| --- | --- | --- |
| `invalid client-request message` + type 校验失败 | `type` 不是 `client-request`，或漏 rpcId/method/payload | 四段写全 |
| `method "..." does not match endpoint` | method 填了 typeSymbol 长 id（`@scope/pkg#ns/method`） | 用短方法名 |
| `Remote payload must contain exactly one plain-object args field` | payload 不是 `{ args: {...} }` | 参数包进 args |

**端点 URL 与 method 同名**：`settings/describe` → `POST /api/settings/describe`。

---

## 三、命名空间真值长什么样

`settings/describe`（payload `args: {}`）返回 `{ writable, hasDocument, namespaces: [...] }`，每个命名空间含：

```js
{
  ns, autoGenerate,
  schema,        // 串行化 schema（含 volatile 标记）
  value,         // 组合后的生效值（唯一真值）
  base,          // 组合层（未叠 user 层）
  user,          // 用户写入层（PRESENCE 才是 overridden 判据）
  revision,      // 命名空间修订号（写冲突栅栏）
  writable, applies, secrets
}
```

**验证写入的真值**：`value` 与磁盘补丁逐字段一致 = 落盘确认。验证插件禁用：命名空间从列表消失（数量减一）。

**写前必须核对 schema 真身**：`describe` 返回的 `value` 里出现一个 schema 已不认识的旧键（升级后
残留的旧字段，例如已删除的旧手势/开关字段），说明宿主进程还加载着旧 schema——最常见的根因不是
磁盘补丁没改，而是**监听那个端口的还是旧实例进程**。此时先 `Get-NetTCPConnection -LocalPort`
核对 `OwningProcess.StartTime`（见 browser-automation-acceptance 一节），而不是去改代码重试。
反过来，新字段不在 `value` 里但磁盘补丁已写，同样是读到了旧进程/旧产物。

---

## 四、mutate 的 expectedRevision 边界

`settings/mutate` 参数 `{ ns, ops, expectedRevision? }`：

- **省略该字段** = 无条件写入；
- **传 `null` 会 wire 校验失败**（`field "expectedRevision" failed boundary validation`）——undefined 与 null 在线格式上不等价，缺省就整个不出现。

ops 形态：`[{ op: 'set', path: ['fieldName'], value }, { op: 'unset', path: [...] }]`。

---

## 五、什么时候用这套

- 浏览器验证的**真值回读**（配合 UI 点击，只有它算数）；
- 插件禁用/卸载后**命名空间消失**断言；
- 排查「设置写了但没生效」——绕开 UI 直接问宿主当前到底存了什么；
- 写自动化验收：无头环境里不依赖浏览器即可回归配置链路。

## 相关 DSH 源码

```text
packages/client/connection  <-  @deepseek-ai/dsh-client-connection@0.2.0-rc.2
  lib/types/browser-auth.d.ts（launch token -> dsh-auth cookie）
packages/boot/api-settings-controller  <-  @deepseek-ai/dsh-api-settings-controller@0.2.0-rc.2
  lib/index.js（describe/mutate/update 方法与 SettingsNamespaceView）
```
