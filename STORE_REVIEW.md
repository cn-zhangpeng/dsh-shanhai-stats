# DSH STORE 上架复核 / Review Evidence

本文件对应 DSH STORE 自动检查（issue #768）提出的三项待修复项，记录插件的兼容性声明、权限与边界，以及一次性（disposable）DSH Profile 的安装 / 启动 / 卸载实测证据。

This document answers the three findings from the DSH STORE automation (issue #768): explicit compatibility declarations, documented permissions/boundaries, and disposable-Profile install/start/uninstall evidence.

- 插件版本 / Plugin version: **1.1.5**（复核实测证据采集于 1.1.2；1.1.3–1.1.5 仅改客户端渲染与按天窗口口径，Host 权限 / 路由无新增，见 §3 说明）
- 复核日期 / Date: **2026-11-18**
- 仓库 / Repository: <https://github.com/cn-zhangpeng/dsh-shanhai-stats>

## 1. 兼容性声明 / Compatibility declarations

`package.json` now declares both ranges explicitly, so the installer and profile boot can verify them without relying on peer-dependency inference:

```json
"engines": {
  "node": ">=24.9.0",
  "dsh": ">=0.2.0 <0.3.0"
}
```

| 项目 / Item | 声明 / Declared | 验证基线 / Verified against |
|---|---|---|
| DSH | `>=0.2.0 <0.3.0` (`engines.dsh`) | 0.2.2-rc.3 |
| Node.js | `>=24.9.0` (`engines.node`) | v24.18.1 |
| 第三方运行依赖 / Runtime deps | 无 / none | Only DSH-injected services |

The Node range matches the `engines.node` of the running DSH runtime (`@deepseek-ai/dsh` 0.2.2-rc.3 requires Node `>=24.9.0`).

## 2. 依赖、权限与边界 / Dependencies, permissions and boundaries

### Dependencies

- **No third-party runtime dependencies.** `dependencies` and `peerDependencies` are empty.
- Host half uses only DSH-injected services: `sessionQuery`, `workspaceRegistry`, `timer`, and the optional `webServer`.
- Client half imports only the DSH client runtime modules declared in `dsh.client.inject` (`@deepseek-ai/dsh-client-runtime`, `@deepseek-ai/dsh-client-ui-slots`).
- **No install-time code execution:** there is no `preinstall` / `install` / `postinstall` / `prepare` script. `scripts.test` is a local test runner only.

### Permissions and failure bounds

| 能力 / Capability | 行为 / Behavior |
|---|---|
| 文件系统 / Filesystem | Host half does **not** import or call `fs`. Session data is read through the injected `sessionQuery`; the plugin writes no files. |
| 网络 / Network | Registers one **same-origin** route, `GET /api/shanhai-stats`, on DSH's own `webServer`. The client half calls it with a relative `fetch('/api/shanhai-stats')`. **No external domain, no third-party API, no telemetry.** |
| 命令 / Commands | None. No `child_process`, no shell. |
| 凭据 / Credentials | None. Does not read `process.env`, credential files, or model API keys. |
| 外部服务 / External services | None. No database, cloud service, or remote endpoint. |
| 失败边界 / Failure bounds | Read-only degradation: a session-log read failure only increments a `failed` counter; the page shows empty/partial stats and never blocks DSH boot or other plugins. |

The only "network" code path is the same-origin call from the browser bundle to the Host route; it never leaves the local DSH server. This is the signal the store scanner flags, and it is intentional and bounded.

## 3. 一次性 Profile 验证 / Disposable-Profile verification

All commands below ran on Windows 11 x64 with a **fresh temporary `DSH_HOME`**, so no user Profile or user plugin was touched. The temporary directory was deleted afterwards.

### Environment

```
DSH      0.2.2-rc.3
Node.js  v24.18.1
pnpm     11.28.5 (invoked by `dsh plugin`)
DSH_HOME C:\Users\<user>\AppData\Local\Temp\dsh-store-verify-<random>
```

### 3.1 Create the disposable profile from the shipped `web` template

```bash
dsh --profile storecheck2 --from-default-profile web
```

Resulting profile bundles:

```text
@deepseek-ai/dsh-base
@deepseek-ai/dsh-web-app
```

> A base-only profile is not sufficient for this plugin: it exposes no web app and no `workspaceRegistry` service. Starting from the shipped `web` template is the realistic one-click scenario.

### 3.2 Install

```bash
dsh plugin --profile storecheck2 add E:\Workspace\ProjectWorkspace\harness-plugin\dsh-shanhai-stats
```

Observed output:

```text
dependencies:
+ dsh-shanhai-stats 1.1.2 <- E:\Workspace\ProjectWorkspace\harness-plugin\dsh-shanhai-stats
Done in 449ms using pnpm v11.28.5
```

The plugin activated without warnings; no install hooks ran.

### 3.3 Start

```bash
dsh --profile storecheck2 --port 31999
```

Observed:

```text
dsh web: http://127.0.0.1:31999/?token=<redacted>
dsh web: opening the default browser; pass --no-open to disable
```

Health checks against that disposable server:

| Request | Result |
|---|---|
| `GET /` (with the printed token) | **HTTP 200**, HTML 41,387 bytes |
| `GET /api/shanhai-stats` (same session) | **HTTP 200**, JSON 264 bytes |

The stats route returned a valid, empty aggregate — expected for an empty `DSH_HOME` (no sessions to scan), and it demonstrates the read-only degradation path rather than an error:

```json
{"scan":{"started":true,"done":true,"scanned":0,"total":0,"failed":0},
 "generatedAt":1794990734709,"workspaces":[],"totals":{"turns":0,"msgs":0,"sessions":0},
 "perWorkspace":[],"perModel":[],"byDay":[]}
```

No plugin error, no unhandled rejection, and no request to any non-local host was observed.

### 3.4 Uninstall

```bash
dsh plugin --profile storecheck2 remove dsh-shanhai-stats
```

Observed output:

```text
dependencies:
- dsh-shanhai-stats link:E:/Workspace/ProjectWorkspace/harness-plugin/dsh-shanhai-stats
Done in 352ms using pnpm v11.28.5
```

Exit code `0`. The profile's `dependencies` no longer contains the plugin, the `bundles` list is unchanged, and the temporary `DSH_HOME` was deleted after the run.

## 4. 复现步骤 / Reproduction

```bash
# 1. Isolated home
export DSH_HOME="$(mktemp -d)"

# 2. Web-template profile
dsh --profile storecheck --from-default-profile web

# 3. Install the plugin (local checkout or GitHub ref)
dsh plugin --profile storecheck add github:cn-zhangpeng/dsh-shanhai-stats#v1.1.5

# 4. Start and open the printed URL
dsh --profile storecheck --port 31999

# 5. Verify the same-origin route
curl -sS "http://127.0.0.1:31999/api/shanhai-stats?token=<printed-token>"

# 6. Uninstall and clean up
dsh plugin --profile storecheck remove dsh-shanhai-stats
rm -rf "$DSH_HOME"
```

## 5. 备注 / Notes

- This document is evidence for the store's check items; it is **not** a security audit, and it does not claim a `user-reviewed` status on its own.
- The `catalog-blocked` label only affects DSH STORE one-click installation. Manual installation via `dsh plugin ... add github:...` was already functional.
- If the store still keeps the entry blocked after the automatic recheck, the remaining step is a maintainer review using this evidence.
