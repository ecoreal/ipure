# ⏱ ipure

**你的 IP 纯净度到底怎么样？贴进来，几秒钟本地出结论。**

[![CI](https://github.com/ecoreal/ipure/actions/workflows/ci.yml/badge.svg)](https://github.com/ecoreal/ipure/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-3fb96f.svg)](LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A518.17-339933)](package.json)
[![零依赖](https://img.shields.io/badge/dependencies-0-339933)](package.json)

[English](README.md)

IP 质量网页工具很好用 —— 直到全论坛的人共用一个 API 配额，中午就全限流了。
**ipure 把批量检测搬到你本机，用你自己的配额。** 贴一个订阅链接（或本地文件、
或 stdin 喂一串 IP），你得到：

- **每个出口 IP 的纯净度分 0–100**：机房/代理/风险分扣分、移动加分，每一分都能说清来龙去脉
- **重复出口指数**：多少 IP 在偷偷共用同一个出口 —— 这就是 IP 总被标记的真相
- **TCP 延迟**：每台服务器取 3 次连接的中位数
- **可分享的报告卡片**：单文件 HTML，可选调用本机 Chromium 截成 PNG

无需注册、无需配置、零 npm 依赖、一个 Node 文件。

![报告卡片](docs/screenshot.png)

## 安装

```bash
npm install -g ipure
# 或者不装，直接跑一次：
npx ipure check 8.8.8.8 1.1.1.1
```

需要 Node ≥ 18.17，别的什么都不用。

## 用法

```bash
# 整份订阅体检（URL、本地文件、或 stdin 的 "-"）
ipure sub "https://provider.example/subscribe?token=xxx"
ipure sub ./nodes.txt --html report.html --png report.png
ipure sub - < nodes.txt --json -

# 直接检测一批 IP（也支持域名）
ipure check 8.8.8.8 1.1.1.1
ipure check 73.0.0.1 223.5.5.5 --json out.json
cat ips.txt | ipure check
```

| 选项 | 说明 |
|---|---|
| `--provider <name>` | `ip-api`（默认，免 key）· `ipinfo`（设 `IPINFO_TOKEN`） |
| `--html <file>` | 输出单文件 HTML 分享卡片 |
| `--png <file>` | 用本机 Chromium 截成 PNG（`IPURE_CHROME` 可指定浏览器路径） |
| `--json <file\|->` | JSON 输出 |
| `--sort score` | 按纯净度排序（默认按订阅原序） |
| `--no-latency` | 跳过 TCP 延迟测量 |
| `--timeout <ms>` / `--conc <n>` | 单项超时（默认 3000）/ 并发（默认 8） |
| `--no-color` | 纯文本输出 |

## 评分算法，全部摊开

没有黑箱，每一分都有出处：

| 信号 | 分值 | 理由 |
|---|---|---|
| 基础分 | **100** | 无罪推定 |
| 机房 IP（hosting） | **−35** | VPS/云段又便宜又共用 |
| 被标记为代理/VPN/Tor | **−20** | 已进风险库 |
| 风险分 ≥75 / ≥50 / ≥25 | **−25 / −15 / −8** | 按严重度分档 |
| N 个 IP 共用同一出口 | **−3 × (N−1)，封顶 −15** | 重复出口扣分 |
| 移动网络出口 | **+5** | 几乎是最干净的出口 |

评级：**S** ≥90 原生级纯净 · **A** ≥75 相当干净 · **B** ≥60 可用 · **C** ≥40 已被标记 · **D** <40 建议更换。

## 支持的订阅格式

**Clash/Mihomo YAML**（`proxies:` 段，行内 flow 和块式两种写法都支持），
或明文 URI 列表 / 整段 base64，每行一个节点：
`ss://`（SIP002 + 传统格式）· `vmess://` · `vless://` · `trojan://` ·
`hysteria2://`/`hy2://` · `tuic://` · `ssr://`

只提取**服务器地址**用于测量，凭据解析后立即丢弃。

## 隐私，说实话

- ipure **本地优先**：你的订阅 token 只会发给你贴给它的那家订阅商（外加 DNS 查询）。
- 默认的 `ip-api` 免费档是**纯 HTTP** —— 你检测的 IP 列表在线路上是可见的。列表敏感的话，设置 `IPINFO_TOKEN` 并用 `--provider ipinfo`（HTTPS，免费 5 万次/月）。
- 无遥测、无"匿名统计"、零依赖需要信任。

## 开发

```bash
git clone https://github.com/ecoreal/ipure && cd ipure
npm test          # 54 个测试，node:test，不需要网络
```

## 路线图

- [ ] `ipure watch` —— 定时复检，对比分数变化
- [ ] 黑名单库信号（Spamhaus 等）
- [ ] 基于 RIR 数据的原生/广播 IP 判定

## 许可

MIT © 2026 [ecoreal](https://github.com/ecoreal)
