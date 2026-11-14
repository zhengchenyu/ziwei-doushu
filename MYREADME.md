# MYREADME.md — 紫微斗数项目本地使用指南

> 本文件记录本机环境的安装、数据下载与使用流程，是官方 README 的本地补充。
> 数据目录约定为 `mydata/`（已加入 `.gitignore`，不入库）。

---

## 一、项目是什么

`ziwei-doushu` 是基于倪海厦《天纪》体系的紫微斗数开源排盘引擎（Next.js 16 + TypeScript）。包含：

- **排盘引擎** `lib/ziwei/`：安星、四化飞星、大限流年、格局判定（1100+ 行规则）、真太阳时校正、夏令时、闰月四口径
- **Demo 界面** `app/` + `components/`：浏览器端排盘，无需 API Key
- **数据集**（Releases 下载）：v4.0 解读数据集 67.5 万命盘 × 13 维
- **古籍原文** `lib/classics/`：《紫微斗数全书》《全集》《骨髓赋》（公有领域）

完整介绍见官方 `README.md`。

---

## 二、安装

```bash
# 1. 克隆仓库
git clone https://github.com/Renhuai123/ziwei-doushu.git
cd ziwei-doushu

# 2. 安装依赖
npm install

# 3. 配置环境变量（只看排盘可跳过；AI 接口需自行实现 /api/*）
cp .env.example .env.local

# 4. 启动开发服务器
npm run dev          # 浏览器打开 http://localhost:3000

# 5. 验证（可选）
npm run typecheck    # TypeScript 类型检查
npm test             # 24 项排盘回归测试
```

排盘、命盘展示、合盘起盘**全在浏览器端完成，不需要任何 API Key**。
AI 解读（`/api/interpret`）和合盘 AI 分析需要自己实现接口，没实现前会提示「开源版不含该接口」。

---

## 三、下载 v4.0 数据集

数据集在 GitHub Releases，体积大，放在 `mydata/` 目录（已加入 `.gitignore`）。

### 数据集规格

| 项目 | 说明 |
|------|------|
| 版本 | v4.0（2026-10-15 发布，release tag `v4.0-13d`） |
| 命盘数 | 674,976 张（公历 1950–2026 × 真实日期 × 12 时辰 × 男女） |
| 解读段数 | 8,774,688 段（每张盘 13 维） |
| 压缩后 | 154 MB（`ziwei-interp-v4-all.tar`） |
| 解压后 | 约 57 GB（77 个年份文件） |
| 许可 | CC BY 4.0，可商用，需注明来源 |

### 一键下载（推荐）

```bash
./myscripts/download-ziwei-v4.sh
```

脚本做的事：
1. 从 GitHub Release 下载 4 个文件到 `mydata/`（默认走 ghfast.top 镜像加速，国内约 3MB/s；设 `USE_MIRROR=0` 走直连）
2. 用官方 `SHA256SUMS-all.txt` 校验 tar 包完整性
3. 打印附属文件哈希供手动核对

下载结果：

```
mydata/
├── ziwei-interp-v4-all.tar   154 MB  总包（含 77 个 year-*.jsonl.zst + 清单）
├── MANIFEST.json             16 KB   官方清单（每年盘数、大小、SHA-256）
├── SHA256SUMS.txt            6.4 KB  全部年份文件的校验和
└── SHA256SUMS-all.txt        90 B    tar 总包的校验和
```

### 手动下载（不用脚本）

```bash
mkdir -p mydata && cd mydata
BASE="https://ghfast.top/https://github.com/Renhuai123/ziwei-doushu/releases/download/v4.0-13d"
curl -L -o ziwei-interp-v4-all.tar "$BASE/ziwei-interp-v4-all.tar"
curl -L -o MANIFEST.json        "$BASE/MANIFEST.json"
curl -L -o SHA256SUMS.txt       "$BASE/SHA256SUMS.txt"
curl -L -o SHA256SUMS-all.txt   "$BASE/SHA256SUMS-all.txt"
shasum -a 256 -c SHA256SUMS-all.txt     # 校验
```

> 直连 GitHub（不用镜像）把 URL 里的 `https://ghfast.top/` 前缀去掉即可，但国内速度约 17KB/s，不推荐。

---

## 四、解压与使用数据

### 解压

```bash
# 解压全部 77 个年份（约 57GB 磁盘空间）
./myscripts/extract-ziwei-v4.sh

# 或只解压指定年份
./myscripts/extract-ziwei-v4.sh 1990 2000

# 手动解压单个年份
cd mydata
tar -xf ziwei-interp-v4-all.tar year-1990.jsonl.zst
zstd -d --long=27 year-1990.jsonl.zst     # --long=27 必须带
```

> `--long=27` 是必须的，压缩时用了长窗口，不带会报错。Windows 用 [zstd 官方包](https://github.com/facebook/zstd/releases) 的 zstd.exe，参数相同。

### 数据格式

每行一张盘（JSON Lines），字段：

| 字段 | 含义 |
|------|------|
| `k` | 键：`YYYY-MM-DD-时辰序号-性别`，如 `1990-01-01-0-male` |
| `y` / `m` / `d` | 公历出生日期 |
| `h` | 时辰序号 0–11（子=0 …… 亥=11），**不是钟点** |
| `g` | `male` / `female` |
| `ms` | 命宫第一颗主星；命宫无主星时为 `null` |
| `t` | 各维字数 |
| `c` | 13 维解读全文（Markdown），键为 `overview` / `personality` / `love` / `career` / `wealth` / `health` / `family` / `children` / `move` / `friends` / `home` / `spirit` / `parents` |

时辰序号对照：

| 序号 | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 时辰 | 子 | 丑 | 寅 | 卯 | 辰 | 巳 | 午 | 未 | 申 | 酉 | 戌 | 亥 |
| 钟点 | 23–1 | 1–3 | 3–5 | 5–7 | 7–9 | 9–11 | 11–13 | 13–15 | 15–17 | 17–19 | 19–21 | 21–23 |

### 快速查看某张盘的解读

```bash
# 查 1990 年 1 月 1 日 子时 男命
grep '"k":"1990-01-01-0-male"' mydata/year-1990.jsonl | head -1 | jq -r '.c.overview'
```

（`jq` 没装可 `brew install jq`）

---

## 五、排盘引擎用法（代码层面）

排盘内核在 `lib/ziwei/`，`algorithm.ts` 是入口，可独立于界面调用。

关键注意点：
- `hour` 是**时辰序号 0–11**（子=0……亥=11），不是 0–23 点钟
- 23:00–23:59 出生（晚子时）按次日排盘、时辰取 0
- 引擎从 2026-10-03 起会拒绝不存在的公历日期（如 2 月 30 日）

详细 API 见 `lib/ziwei/algorithm.ts` 与 `types.ts`。格局规则在 `patterns.ts`，四化在 `sihua.ts`，合盘方法论在 `heming-knowledge.ts`。

---

## 六、接入 AI 解读（排盘后解读 / 合盘分析）

排盘本身不需要 API Key，但排完盘点「命格」「感情」等按钮时，前端会调用 `/api/interpret`；合盘页会调用 `/api/heming`。这两个接口已经实现（`app/api/interpret/route.ts`、`app/api/heming/route.ts`），走 **OpenAI 兼容协议 + SSE 流式**，配好 Key 即可用。

### 1. 配置 API Key

```bash
cp .env.example .env.local
```

编辑 `.env.local`，填任一组即可：

**方案一：DeepSeek（国内快、便宜，推荐）**
```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-your-real-key
```
- 获取 Key：[platform.deepseek.com](https://platform.deepseek.com) → API Keys
- 默认模型 `deepseek-chat`

**方案二：Kimi / Moonshot AI（OpenAI 兼容，长上下文，中文理解好）**
```env
AI_PROVIDER=kimi
KIMI_API_KEY=sk-your-real-key
```
- 获取 Key：[platform.kimi.com](https://platform.kimi.com)（或 platform.moonshot.cn）→ API Keys
- 默认模型 `kimi-k3.1-pro`（K3.1 Pro 旗舰模型，支持 1M 上下文）
- 可选 `kimi-k3.1-pro-highspeed`（高速版，输出更快）：在 `.env.local` 加 `KIMI_MODEL=kimi-k3.1-pro-highspeed`
- 兼容 OpenAI 协议，`base_url` 代码里已内置 `https://api.moonshot.cn/v1`，无需手动填
- 环境变量 `MOONSHOT_API_KEY` / `MOONSHOT_*` 也兼容（`AI_PROVIDER=moonshot` 同样生效）

**方案三：任何 OpenAI 兼容服务（OpenAI / 小米 mimo / 自建中转）**
```env
AI_PROVIDER=mimo
MIMO_API_KEY=your-key
MIMO_BASE_URL=https://your-provider/v1
MIMO_MODEL=gpt-4o-mini
```

### 2. 重启开发服务器

```bash
npm run dev      # 改了 .env.local 必须重启才生效
```

打开 http://localhost:3000 ，排一张盘，点「命格」按钮，AI 解读会流式输出。

### 3. 接口说明（想自己改的话）

| 接口 | 方法 | 请求体 | 响应 |
|------|------|--------|------|
| `/api/interpret` | POST | `{ chart: ZiweiChart, messages: {role,content}[] }` | SSE，每行 `data: {"delta":{"text":"..."}}`，结尾 `data: [DONE]` |
| `/api/heming` | POST | `{ chartA, chartB, question? }` | 同上 |

- 两个接口共用 `app/api/interpret/_shared.ts`（命盘上下文生成 + 提供商配置）
- system prompt 会把命盘的 12 宫位、星曜、四化、当前大限拼成上下文喂给 AI
- 上游用 OpenAI 的 `/chat/completions`（`stream:true`），接口做格式转换
- 想换 prompt 改 `route.ts` 里的 `buildSystemPrompt` / `buildHemingPrompt`
- 想接非 OpenAI 协议的模型（如 Claude 原生 API），改 `route.ts` 里的上游调用部分

### 4. 已支持的 AI 提供商一览

| `AI_PROVIDER` | 服务商 | base_url（已内置） | 默认模型 | Key 环境变量 |
|---|---|---|---|---|
| `deepseek` | DeepSeek | `api.deepseek.com/v1` | `deepseek-chat` | `DEEPSEEK_API_KEY` |
| `kimi` / `moonshot` | Kimi (Moonshot AI) | `api.moonshot.cn/v1` | `kimi-k3.1-pro` | `KIMI_API_KEY` 或 `MOONSHOT_API_KEY` |
| `mimo`（或其他） | OpenAI 兼容 | 由 `MIMO_BASE_URL` 指定 | 由 `MIMO_MODEL` 指定 | `MIMO_API_KEY` |

> 三家都是 OpenAI 兼容协议，接口代码不用改，只改 `.env.local` 里的 `AI_PROVIDER` 和对应 Key 即可切换。

---

## 七、命盘保存与历史记录

排盘结果会**自动保存到浏览器 localStorage**，下次打开页面自动恢复最近一张盘，无需重新输入。

### 功能说明

- **自动保存**：每次起盘后，表单输入（姓名、年月日时、出生地、性别）自动存到 localStorage
- **自动恢复**：重新打开 `/chart` 页面时，自动加载最近一张命盘
- **历史列表**：起盘后点「📂 历史命盘」可查看所有存过的盘，点击切换、✕ 删除
- **最多存 20 张**：超出自动删最老的
- **同人不重复**：同年月日时辰性别的盘只留最新一条

### 数据存在哪

- 存的是**表单输入**（BirthFormState），不是整个命盘对象
- 原因：排盘引擎是确定性的（同输入同输出），存表单足够还原命盘，且省空间
- 存储位置：浏览器 localStorage，键名 `ziwei-saved-charts`
- 清浏览器缓存 / 换浏览器 / 换设备都会丢失（这是 localStorage 的特性）

### 清空历史

- 历史列表里点「清空」按钮，或浏览器控制台执行 `localStorage.removeItem('ziwei-saved-charts')`

### 相关文件

| 文件 | 作用 |
|------|------|
| `lib/ziwei/saved-charts.ts` | 存储工具：增删查改、去重、标签生成 |
| `app/chart/page.tsx` | 排盘页：自动恢复 + 历史列表 UI |

---

## 八、脚本清单（`myscripts/`）

| 脚本 | 作用 |
|------|------|
| `download-ziwei-v4.sh` | 下载 v4.0 数据集到 `mydata/`，含镜像加速与 SHA-256 校验 |
| `extract-ziwei-v4.sh` | 解压数据集，支持全部或指定年份 |

---

## 九、目录约定

| 目录 | 说明 | 是否入库 |
|------|------|----------|
| `lib/ziwei/` | 排盘引擎源码 | ✅ |
| `app/` `components/` | Demo 界面 + AI 接口路由 | ✅ |
| `app/api/interpret/` `app/api/heming/` | AI 解读 / 合盘接口（已实现） | ✅ |
| `mydata/` | **数据集大文件**（tar、jsonl） | ❌ 已在 `.gitignore` |
| `myscripts/` | 本地辅助脚本（下载、解压） | ✅ |
| `scripts/` | 官方回归测试 | ✅ |

---

## 十、许可

- 代码：MIT（随便用）
- 数据集 v4.0：CC BY 4.0（可商用，注明来源即可）
- 古籍原文：公有领域
- 倪师原话（`docs/tianji-ziwei/`）：CC BY-NC-SA 4.0，**禁止商用**

引用数据集时写：
> 本项目使用了紫微斗数开源解读数据集 v4.0（674,976 张命盘 × 13 维）
> 来源：https://github.com/Renhuai123/ziwei-doushu
> 作者：王多鱼AI

---

## 十一、常用命令速查

```bash
npm run dev                    # 启动开发服务器
npm run build                  # 生产构建
npm test                       # 排盘回归测试
npm run typecheck              # 类型检查
./myscripts/download-ziwei-v4.sh        # 下载数据集
./myscripts/extract-ziwei-v4.sh         # 解压全部
./myscripts/extract-ziwei-v4.sh 1990    # 解压单年
```
