#!/usr/bin/env bash
# extract-ziwei-v4.sh
# 解压紫微斗数 v4.0 数据集。
# 用法：
#   ./myscripts/extract-ziwei-v4.sh              # 解压全部 77 个年份（约 57GB）
#   ./myscripts/extract-ziwei-v4.sh 1990 2000    # 只解压指定年份
#
# 前置：已用 download-ziwei-v4.sh 下好 ziwei-interp-v4-all.tar
# 依赖：tar（系统自带）、zstd（解压 year-*.jsonl.zst）

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$REPO_ROOT/mydata"
TAR="$DATA_DIR/ziwei-interp-v4-all.tar"

if ! command -v zstd >/dev/null 2>&1; then
  echo "错误：未找到 zstd，请先安装：brew install zstd  (macOS)  或  apt install zstd"
  exit 1
fi

if [ ! -f "$TAR" ]; then
  echo "错误：找不到 $TAR，请先运行 ./myscripts/download-ziwei-v4.sh"
  exit 1
fi

cd "$DATA_DIR"

# 1. 从 tar 包展开 year-*.jsonl.zst 文件（每个约 2MB）
if [ $# -gt 0 ]; then
  echo ">> 选择性解压年份：$*"
  for y in "$@"; do
    tar -xf "$TAR" "year-$y.jsonl.zst"
  done
else
  echo ">> 展开全部 77 个年份文件（压缩共约 154MB）"
  tar -xf "$TAR"
fi

# 2. 用 zstd 解压 .jsonl.zst → .jsonl（--long=27 必须带，压缩时用了长窗口）
echo ">> 用 zstd 解压 .jsonl.zst（--long=27）"
shopt -s nullglob
for f in year-*.jsonl.zst; do
  zstd -d --long=27 -f "$f"
done

echo ""
echo ">> 完成。解压后的 .jsonl 文件："
ls -lh year-*.jsonl 2>/dev/null | head -5
echo "每行一张盘（JSON Lines），字段说明见 MYREADME.md"
