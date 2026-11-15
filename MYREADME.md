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

## 六·新、断语库接入：数据集 → 提示词（2026-11-14）

上游开源版把「断语库」整层拿掉了（`lib/ziwei/db-analysis.ts` 里 `STAR_DB` 是空对象），
所以 AI 解读只能让模型自由发挥。本次把 Release 里的 v4.0 数据集接进来，走
**「先检索语料、再拼提示词」**，模型的任务从「凭空生成」变成「在官方断语原文上串联改写」。

### 6.1 链路

```
排盘 → chart.birthInfo{年,月,日,时辰序号,性别}
     → 定位到那一个年份的 year-YYYY.jsonl（按需解压，不整体进内存）
     → 字节偏移二分查找定位到这一行（≈23–47ms）
     → 抽出 13 维语料，按问题挑 1–3 维
     → 拼进 system prompt：【命盘宫位】→【断语库原文】→【输出要求】
     → 送模型
```

### 6.2 为什么不逐行扫、也不建向量库

单年文件解压后 708–742 MB / 8760 行（365 天 × 12 时辰 × 2 性别），平均每行 84.7 KB：

- **整体读内存**：742 MB/年，77 年根本放不下 → 否
- **逐行全表扫描**：每次请求要过几百 MB → 否
- **向量检索（RAG）**：需求是「我这张盘说什么」，键精确匹配；语义检索会把相邻日期
  的盘检出来，属于引入错误 → 否
- **字节偏移二分查找**：文件内按 (日期,时辰) 单调递增，每次读 512 KB 窗口比对，
  约 11 次收敛 → **采用**

> 踩过的坑：性别在文件里是 male 在前、female 在后，而字典序里 `female < male`，
> 用整串比较会破坏单调性。所以二分只比较 (日期,时辰)，命中后再在相邻两行里按性别取。
> 另：第一版按「mid 之后的下一行」收敛，会跳过首行；已改成「按行首收敛」。

### 6.3 代码位置

| 文件 | 作用 |
|------|------|
| `lib/ziwei/dataset.ts` | **新增**。年份解压/缓存、二分查找、语料抽取、按问题挑维度 |
| `app/api/interpret/_shared.ts` | 新增 `buildCorpusSection()`、`buildInterpretSystemPrompt()`、`latestUserText()` |
| `app/api/interpret/route.ts` | 先 `loadCorpus(chart.birthInfo)` 再拼 prompt；响应头加 `X-Ziwei-Corpus` |
| `app/api/heming/route.ts` | 双盘各取一份语料，都拼进合盘 prompt |
| `myscripts/test-corpus.ts` | **新增**。自测：二分 vs 线性扫描、降级、维度挑选、真实链路 |

### 6.4 目录与缓存

```
mydata/
├── ziwei-interp-v4-all.tar          154 MB   总包（原始下载，不删）
├── year-1990.jsonl.zst              1.9 MB   单年（可选）
└── .cache/                          自动生成，可随时删
    ├── year-1990.jsonl              708 MB    按需解压，默认只留最近 2 个年份
    ├── year-1990.jsonl.zst          1.9 MB    从 tar 里抽出来的一份
    └── corpus/1990-06-15-7-female.json  ~30 KB  单盘语料缓存（第二次起 12ms 命中）
```

`mydata/` 整目录已在 `.gitignore`，缓存不会入库。

### 6.5 环境变量（都有默认值，不配也能跑）

| 变量 | 默认 | 作用 |
|------|------|------|
| `ZIWEI_DATA_DIR` | `./mydata` | 数据集目录 |
| `ZIWEI_DATASET` | 开 | 设 `0` 关闭接入，接口回到「无断语库」模式 |
| `ZIWEI_CORPUS_MAX_CHARS` | `16000` | 注入 prompt 的语料字数上限（超出按维度截断） |
| `ZIWEI_KEEP_YEARS` | `2` | 本地保留几个已解压年份，超出按 LRU 删 |
| `ZIWEI_PRUNE_GRACE_MS` | `600000` | 清理保护窗：这个时间内被读过的年份一律不删（防多进程互删） |
| `ZIWEI_DATASET_TIMEOUT_MS` | `180000` | 单次解压超时 |

### 6.6 怎么用 / 怎么验

```bash
# 1. 确认数据集在（mydata/ 有 tar 或某年的 zst）
npx tsx myscripts/test-corpus.ts

# 2. 只想验某几年（会各解压一次，之后按 LRU 清理）
npx tsx myscripts/test-corpus.ts --years 1991 1992

# 3. 真实请求时看响应头，确认这次有没有吃到语料
#    x-ziwei-corpus: 1990-06-15-7-female;disk;12ms   ← 命中
#    x-ziwei-corpus: miss                            ← 未命中，已降级
```

自测实测数据（本机，M 系列 Mac）：

| 项目 | 结果 |
|------|------|
| 二分查找（年文件 708 MB） | 23–47 ms/次，4 个用例与线性扫描逐字段一致 |
| 首次从 tar 解包某年（含 zstd） | 907 ms |
| 单盘语料缓存命中 | 12 ms |
| 进程 RSS 增量 | ~20 MB（年文件未被整体载入） |
| 注入后 prompt 长度 | 感情问题 6007 字（命盘结构 ~800 + 总览 2940 + 感情 2246） |
| 端到端 | 假上游确认收到含【断语库原文】的 system prompt，SSE 正常回传 |

### 6.7 口径与限制（重要）

- **以 `chart.birthInfo` 为键**：那是引擎归一化后的「排盘日」（含晚子时换日），与页面展示一致。
- **数据集本身没做真太阳时校正**（按时辰序号直接排盘）。填了出生地的情况，页面按真太阳时校正、
  数据集按未校正口径，两者在临界时辰会有差 —— 目前接受这个差异，因为断语是按「时辰」给的，
  不涉及具体分钟。
- 数据集**只有本命盘 13 维**：没有大限/流年，没有按读者年龄改写的句子，也没有 AI 段。
  所以它只能当「底座」，大限流年的部分仍由模型基于命盘结构补充。
- 语料字数可调；`overview` 一直带，其余按问题关键词选，最多 3 维，避免 prompt 爆上下文。
- **多进程安全**：dev server、自测脚本、`next start` 可能同时跑，都会解压/清理年份文件。
  读取时会 touch 该年份文件，清理只删「超过保护窗（默认 10 分钟）没被读过」的年份，
  避免一边在读、另一边把文件删掉。实测并发跑（一个解压 1988、一个查 1990）均通过，
  代价是短期会多留几个年份（保护窗内不删），磁盘吃紧就手动删 `mydata/.cache/`。

---

## 六·新二、倪师语料接入：1,848 条原话 → 检索 → 提示词（2026-11-14）

### 6N.1 先纠正一个误解：「仓库里有很多书籍」

实际盘点下来没有「很多书」，真正的量在别处：

| 资料 | 位置 | 真实体量 | 性质 |
|------|------|----------|------|
| 古籍「3 本」 | `lib/classics/data/` | 21 章 / **75 段 / 4,243 字** | **现代归纳的节选**，页面自称「75 段精华」「未来补全全本」 |
| 倪师《天纪》原话 | `docs/tianji-ziwei/entries.jsonl` | **1,848 条 / 134,435 字** | 每条带讲次、时间码、bvid、册目，9 大类 |
| 逐帧精读摘要 | `research/nishi-video-reading/summaries/` | 356 条 / 10,179 字 | 17 集公开摘要 |
| 断语库数据集 | `mydata/` | 67.5 万盘 × 13 维 | 见第六章 |

所以能提升准确率的主力是 **1,848 条倪师原话**，不是那 4,243 字古籍。

⚠️ 古籍那 75 段读起来是现代人的归纳（比如「落陷之人有'不甘'二字推动，反能逆袭」），
不是明代刊本原文。因此代码里一律标成「节选·整理」，prompt 里也明确禁止说成
「《紫微斗数全书》原文」—— 宁可用得保守，也不能把改写当引证。

### 6N.2 这些语料之前是怎么用的：基本没用

1. **运行时 0 引用**：`entries.jsonl` / `docs/tianji-ziwei/*.md` / `research/` 全仓 grep
   只命中 README 与目录说明，没有任何 `import` 或读文件。
2. **但 prompt 里写着**「引用倪海厦观点时标注出处（如"倪师在《天纪》中指出"）」——
   手里一句语料都没有，模型只能编，而且编得很像。
3. `heming-knowledge.ts` 有 14 处 `ni_quote` 标「倪海厦原话」，但没有讲次、没有时间码。
4. `patterns.ts` 的 34 条格局带《全书》《骨髓赋》出处，但只进了 UI（`PatternsCard`、
   `ChartSummary`），**没进 prompt**。

### 6N.3 检索方案：结构键过滤 + BM25，不上向量库

```
命盘 + 用户提问
  → 结构键：选中宫位（点宫位就是检索键）/ 该宫星曜 / 化禄权科忌
  → 候选集：册目分类 + h2/h3 标签
  → BM25 打分（bigram 倒排，2,279 条常驻内存）
  → top 8 原话（带〔P讲次·时间码〕）+ top 2 古籍节选（单独池）
  → 拼进 prompt
```

为什么不上向量库：这批语料是 2,279 条短引文，判断高度依赖**术语精确匹配**——
「化忌冲命」和「化忌入夫妻」在向量空间里几乎重合，语义检索反而更容易串味。
倒排 + BM25 + 星/宫/四化加权，在 15 万字规模上更准、更快（单次 0.5–0.6 ms），
也更好解释「为什么召回了这条」。

几个细节：

- **宫位是硬约束**：点了「夫妻宫」，就不该把「子女宫按星论儿子」排到第一。
  只有「明确标了别的宫位」的条目会被排除，没有宫位标签的仍保留（标签覆盖率约一半）。
- **只查这个宫的星**：把全盘 14 主星都塞进查询，会让「廉贞」这类泛论盖过具体宫位断语。
- **三级兜底**：命中 <4 → 放宽到全盘主星；<3 → 只按问句文本；仍不足就老实返回少量。
  天梁只有 15 条原话，没有兜底会空手。
- **古籍单池**：古籍不进主排序，固定取 2 条当术语卡，避免挤掉原话的位置。

### 6N.4 prompt 变成四段（顺序固定）

```
【命盘结构】宫位 · 星曜(庙旺/落陷) · 生年四化 · 当前大限 · 年龄
【命中格局】34 条格局里按上格/吉格/中格/破格取前 6 条，带古籍出处
【断语库原文】本盘 13 维官方断语 → 结论层（最高优先）
【倪师原话】8 条，每条带〔P9·00:36:09〕 → 依据层
【古籍节选·整理】2 条 → 术语层（禁止称"原文"）
【输出要求】只能引用上面给的出处；不得自造讲次/时间码
```

冲突时的优先级：**断语库管结论，原话管「为什么这么说」，古籍管「名词怎么定义」**。
原话不推翻结论，只做口径补充。

顺带修了两个老问题：`chartToContext` 之前读的是 `chart.dashian`（实际字段是
`daXians` + `currentDaXianIndex`），所以「当前大限」从来没进过 prompt；星曜也没带庙旺，
而庙旺/落陷对吉凶判断影响很大。现在都补上了。

### 6N.5 出处校验：不让模型编时间码

流式输出里做了一个小状态机：遇到「〔」开始缓冲，等到「〕」再判定——

| 情况 | 处理 |
|------|------|
| 讲次 + 时间码都在本次召回集合里（±90 秒容差） | 原样放行 |
| 只写讲次、不写时间码 | 放行（弱引用） |
| 讲次不存在 / 时间码对不上 | 替换为 `〔出处待核〕` 并计数 |
| 标记被 chunk 切断（`〔P9·00:3` + `6:09〕`） | 正确拼接后判定 |

流结束追加一个 `data: {"citations":{"kept":1,"stripped":2}}` 事件（前端会忽略，
浏览器 Network 里能看见）。响应头 `X-Ziwei-Nishi` 标明召回条数与耗时。

### 6N.6 真太阳时口径（原计划的 P0.5）

站内排盘按真太阳时，断语库按钟表时辰生成。之前只是「知道有这个差」，现在能**测出来**：

- `formToBirthInfo()` 现在保留 `birthInfo.origInput`（原始钟表读数）
- 服务端比较「钟表读数对应的时辰」与「校正后的时辰」，若差一个时辰或换了日，
  prompt 里会插入一条必须说明的口径提示

实测：1990-06-15 13:50 生于乌鲁木齐（东经 87.6°）→ 真太阳时校正为午时，
prompt 自动插入「本盘处于时辰交界，断语库原文仅供参考」，不让模型强行调和。

### 6N.7 代码位置

| 文件 | 作用 |
|------|------|
| `myscripts/build-corpus.ts` | 生成语料包：jsonl / md / 古籍 → `lib/corpus/data/*.json`（含标签、时间码转秒） |
| `lib/corpus/index.ts` | 倒排索引 + BM25 + 结构加权 + 册目去重；`searchCorpus()` / `corpusStats()` |
| `lib/corpus/from-chart.ts` | 命盘 + 问句 → 检索请求；宫位关键词映射（感情→夫妻、事业→官禄…）；三级兜底；合盘双盘合并 |
| `lib/corpus/citation.ts` | 流式出处校验 `createCitationFilter()` / 非流式 `verifyCitations()` |
| `lib/corpus/data/` | 生成的语料包（`nishi.json` 874 KB、`summaries.json` 116 KB、`classics.json` 29 KB） |
| `app/api/interpret/_shared.ts` | 四段式 prompt 装配（`chartToContext` / `buildPatternsSection` / `buildCorpusSection` / `buildNishiSection` / `solarTimeCaveat`） |
| `app/api/interpret/route.ts` | 检索 → 拼 prompt → 流式 + 出处校验 + 响应头 |
| `app/api/heming/route.ts` | 同上，两张盘各检索一次后合并去重 |
| `myscripts/test-rag.ts` | 自测：语料规模、性能、结构键是否对路、引用校验、prompt 装配 |

命令：

```bash
npx tsx myscripts/build-corpus.ts   # 语料有更新时重新生成（改 docs/ 或 research/ 后必跑）
npx tsx myscripts/test-rag.ts       # 检索与引用校验自测（25 项）
npx tsx myscripts/test-corpus.ts    # 断语库自测（原有）
```

### 6N.8 没做的

- **P4 评测**：固定题库跑 A/B/C 三组（现状 / +断语库 / +倪师语料），量化「引用可核率、编造率」。
  费 token，暂时跳过，改成人工抽查。
- **向量重排**：只有 BM25 召回不够时才需要，目前 30 条金标 query 命中率够用。
- **182 个知识页**：`STAR_DB` 仍为空，`/knowledge/[star]/[topic]` 还是 0 条路由。
- **合盘 `ni_quote`**：`heming-knowledge.ts` 里那 14 条仍是无出处的改写，应换成检索到的真原话。

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
| `test-corpus.ts` | 断语库接入自测：二分 vs 线性扫描、降级、维度挑选、真实链路；`--years` 可加测多年份 |
| `build-corpus.ts` | 生成倪师语料包：`entries.jsonl` + 逐帧摘要 + 古籍 → `lib/corpus/data/*.json`（打星/宫/四化标签、时间码转秒） |
| `test-rag.ts` | 语料检索与引用校验自测：规模、性能、结构键命中、出处过滤、四段式 prompt 装配（25 项） |

---

## 九、目录约定

| 目录 | 说明 | 是否入库 |
|------|------|----------|
| `lib/ziwei/` | 排盘引擎源码 | ✅ |
| `lib/ziwei/dataset.ts` | 断语库读取层（按年解压 + 二分定位 + 语料抽取） | ✅ |
| `app/` `components/` | Demo 界面 + AI 接口路由 | ✅ |
| `lib/corpus/` | 倪师语料检索层（倒排 + BM25 + 结构加权 + 出处校验） | ✅ |
| `lib/corpus/data/` | 生成的语料包（~1 MB，随代码进库，不需联网） | ✅ |
| `app/api/interpret/` `app/api/heming/` | AI 解读 / 合盘接口（已实现，已接入断语库 + 倪师原话） | ✅ |
| `mydata/` | **数据集大文件**（tar、jsonl） | ❌ 已在 `.gitignore` |
| `mydata/.cache/` | 按需解压的年份文件 + 单盘语料缓存（可随时删） | ❌ 随 `mydata/` 忽略 |
| `myscripts/` | 本地辅助脚本（下载、解压、断语库自测） | ✅ |
| `scripts/` | 官方回归测试 | ✅ |

---

## 十、许可

- 代码：MIT（随便用）
- 数据集 v4.0：CC BY 4.0（可商用，注明来源即可）
- 古籍原文：公有领域
- 倪师原话（`docs/tianji-ziwei/`）：CC BY-NC-SA 4.0，**禁止商用**
- 检索包 `lib/corpus/data/`：**按文件分开**，见该目录下 `LICENSE.md`
  - `nishi.json` 是倪师原话的结构化聚合 → 继承 CC BY-NC-SA 4.0，**禁商用**
  - `summaries.json` / `classics.json` → MIT
  - 商用前必须从 `build-corpus.ts` 剔掉 quotes，只留摘要 + 古籍

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
npx tsx myscripts/test-corpus.ts        # 断语库接入自测
```

---

## 十二、工作记录

### 2026-11-14（下午）倪师语料接入：检索 → 提示词

**背景**：prompt 里写着「引用倪海厦观点时标注出处」，但一句语料都没给模型 ——
等于在教它编。仓库里 1,848 条原话、356 条逐帧摘要、75 段古籍一直都只是「给人看的资料」。

**做了什么**：

1. 语料归一：新增 `myscripts/build-corpus.ts`，把 `entries.jsonl`（1,848 条）、
   逐帧摘要（356 条）、古籍（75 段）生成到 `lib/corpus/data/*.json`，统一字段并预打
   星/宫/四化/小星/格局标签，时间码转秒；古籍标 `kind: 'classic'` 且书名带「（节选·整理）」
2. 检索层：新增 `lib/corpus/index.ts`（倒排 + BM25 + 结构加权 + 册目去重）与
   `lib/corpus/from-chart.ts`（宫位关键词映射、三级兜底、合盘合并）
   - 宫位作硬约束、只查选中宫的星、古籍单池取 2 条
3. prompt 改四段式：`命盘结构 → 命中格局 → 断语库原文 → 倪师原话 → 古籍节选 → 输出要求`
   - 补了两个漏：`chartToContext` 原来读 `chart.dashian`（实际是 `daXians`），
     「当前大限」从未进过 prompt；星曜也没带庙旺/落陷
   - 34 条格局（带古籍出处）此前只进 UI，现在进 prompt 第一段
4. 出处校验：新增 `lib/corpus/citation.ts`，流式状态机过滤 `〔P9·00:36:09〕`，
   不在召回集合内 → 替换为 `〔出处待核〕`；结束追加 `{"citations":{kept,stripped}}` 事件
5. 真太阳时口径：`formToBirthInfo()` 保留 `birthInfo.origInput`，服务端据此判断
   「真太阳时是否改了时辰/换日」，命中则向 prompt 插入必须说明的口径提示
6. 测试：新增 `myscripts/test-rag.ts`（25 项）；`test-corpus.ts` 适配新签名

**验证结果**（本机实测）：

| 项 | 结果 |
|---|---|
| 语料包 | 2,279 条 / 148,857 字（原话 1,848 + 摘要 356 + 古籍 75） |
| 索引冷启动 | 25–28 ms（含建索引，进程内常驻） |
| 单次检索 | 0.5–0.6 ms（热）；接口响应头 `X-Ziwei-Nishi: 10;1ms` |
| 「夫妻宫」问题 | 召回 10 条，10 条都带夫妻宫标签；首条为夫妻宫原话 |
| 「事业」问题 | 识别为官禄宫，召回官禄宫/官禄相关原话 |
| 无关问题 | 返回 0 条，不硬凑 |
| prompt | 7.6–9.0k 字，四段齐全，含 8 条带时间码原话 |
| 出处校验 | 真出处放行 1 条，假讲次 + 假时间各替换 1 条（`kept:1, stripped:2`） |
| 跨 chunk 标记 | `〔P9·00:3` + `6:09〕` 正确拼接并判定 |
| 真太阳时提示 | 乌鲁木齐 13:50（未时）→ 午时，prompt 自动加口径提示 |
| `typecheck` / `build` | 均通过 |

**踩的坑**：

- `lib/ziwei/patterns.ts` 带 `import 'server-only'`，tsx 直接跑会 `MODULE_NOT_FOUND`。
  所以格局检测留在 route 层（Next 里能解析），`_shared.ts` 只接收检测结果 ——
  顺带解释了之前 `patterns-sihua-bonus.test.ts` 为什么单独跑也失败
- 第一版把全盘 14 主星都塞进查询，结果「子女宫按星论儿子」排到第一；
  改成「点了宫位就只查这个宫的星 + 宫位硬约束」才对
- 古籍只有 4.2k 字，BM25 长度归一化后特别容易排第一，挤掉真正的原话 → 改成单独池

**没做**：P4 固定题库评测（费 token，改人工抽查）、向量重排、182 个知识页、
合盘 `ni_quote` 换成真原话。

---

### 2026-11-14 断语库接入（数据集 → 提示词）

**背景**：上游开源版把断语库拿掉了（`STAR_DB = {}`），所以 `/api/interpret` 只把 12 宫位丢给模型，
等于让大模型自由发挥。Release 里的 v4.0 数据集正是那套断语库的输出，等于现成的语料源。

**做了什么**：

1. 新增 `lib/ziwei/dataset.ts`
   - 按用户出生年份**只解压那一年**（从 `year-YYYY.jsonl.zst` 或 tar 里取），不整包解压、不整体进内存
   - 年文件内按 (日期,时辰) 单调递增 → **字节偏移二分查找**，每次读 512 KB 窗口，约 11 次收敛
   - 命中后抽 13 维语料，落单盘小缓存（`mydata/.cache/corpus/*.json`），二次查找 12ms
   - 已解压年份按 LRU 保留（默认 2 个），自动删旧，避免 57 GB 堆盘；
     读取时 touch、清理带 10 分钟保护窗，防止多进程互相删掉正在读的文件
2. 提示词链路改为「检索 → 拼装 → 生成」
   - `_shared.ts` 新增 `buildCorpusSection()` / `buildInterpretSystemPrompt()` / `latestUserText()`
   - 顺序固定：`【命盘宫位】→【断语库原文】→【输出要求】`，并把「以原文为准、不得反转吉凶、
     不得添加原文没有的断言」写进要求
   - 按问题关键词挑维度：`overview` 必带，其余（感情/事业/财运/健康…）按关键词选，最多 3 维，
     总字数受 `ZIWEI_CORPUS_MAX_CHARS`（默认 16000）约束
3. 合盘接口 `/api/heming` 双盘各取一份语料，一起进 prompt
4. 取不到语料（年份越界 / 未下载 / 解压失败）**显式降级**：提示模型说明「未接入断语库原文」，
   并严禁编造出处；响应头 `X-Ziwei-Corpus` 标明本次是否命中
5. 新增 `myscripts/test-corpus.ts`：二分 vs 线性扫描逐字段比对、边界（首行/末行/2月末）、
   降级、维度挑选、真实链路（`generateChart` → 语料 → prompt）

**验证结果**（本机）：

- 二分查找 23–47 ms/次（年文件 708 MB），4 个用例与线性扫描逐字段一致
- 首次从 tar 解包某年 907 ms；单盘缓存命中 12 ms；RSS 增量 ~20 MB
- 端到端：起假上游，确认收到 6007 字 system prompt 且含【断语库原文】+ 命盘键；SSE 正常
- 降级：2049 年命盘 → 响应头 `miss`，prompt 降到 711 字并带降级提示
- 并发：一个进程解压 1988、另一个查 1990，两边都通过（原本会互删年份文件）
- `npm run typecheck` 通过；`npm run build` 通过（`/api/*` 正确标为 dynamic）

**已知问题（都不是本次改动引入）**：

- `scripts/regression/patterns-sihua-bonus.test.ts` 单独跑也失败：
  Node 22.22 下它的 `load` 钩子返回 `undefined`，报 `ERR_INVALID_RETURN_PROPERTY_VALUE`
- `scripts/regression/chart-demo-layout.test.tsx` 失败：该测试只 stub 了 `useState`，
  而 `app/chart/page.tsx`（上一个提交）已新增 `useRef` / `useEffect` → 直接调用组件时 hook 报错。
  要修的话，在测试的 `stubRequire` 里补上这两个 hook 的桩即可

**未做 / 可继续**：

- 数据集只有本命盘 13 维，大限流年仍靠模型补；如需更贴，可再叠 `yunxian-context.ts` 的运限上下文
- 目前每次请求都重新查（有磁盘缓存兜底）；如需更快可加进程内 LRU 之外的预热
- `stdout` 里没有语料命中日志；排障看响应头 `X-Ziwei-Corpus` 即可
