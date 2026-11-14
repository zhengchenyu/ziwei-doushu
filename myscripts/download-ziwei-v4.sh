#!/usr/bin/env bash
# download-ziwei-v4.sh
# 下载紫微斗数 v4.0 解读数据集总包到 mydata/，并校验 SHA-256。
# 用法：
#   ./myscripts/download-ziwei-v4.sh              # 默认镜像加速（国内快）
#   USE_MIRROR=0 ./myscripts/download-ziwei-v4.sh # 直连 GitHub（慢，~17KB/s）
#
# 下载内容（共约 154MB）：
#   ziwei-interp-v4-all.tar   —— 1950–2026 共 77 个年份的 year-*.jsonl.zst
#   MANIFEST.json / SHA256SUMS.txt / SHA256SUMS-all.txt

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA_DIR="$REPO_ROOT/mydata"
RELEASE="v4.0-13d"
GH_BASE="https://github.com/Renhuai123/ziwei-doushu/releases/download/$RELEASE"

# 国内访问 GitHub 慢时用镜像加速；设 USE_MIRROR=0 走直连
if [ "${USE_MIRROR:-1}" = "1" ]; then
  BASE="https://ghfast.top/$GH_BASE"
  echo ">> 使用镜像加速（ghfast.top），如需直连设 USE_MIRROR=0"
else
  BASE="$GH_BASE"
  echo ">> 直连 GitHub（可能较慢）"
fi

mkdir -p "$DATA_DIR"
cd "$DATA_DIR"

FILES=(ziwei-interp-v4-all.tar MANIFEST.json SHA256SUMS.txt SHA256SUMS-all.txt)

echo ">> 开始下载到 $DATA_DIR/"
for f in "${FILES[@]}"; do
  curl -L --fail --retry 3 --retry-delay 5 -o "$f" "$BASE/$f"
done

echo ""
echo ">> SHA-256 校验"
shasum -a 256 -c SHA256SUMS-all.txt

echo ""
echo ">> 附属文件哈希对照（手动核对，应与下方一致）"
shasum -a 256 MANIFEST.json SHA256SUMS.txt SHA256SUMS-all.txt
cat <<'EOF'
预期：
  770c64da335edfe01f9ca6a7536cc083e416a1b481782c662b6b1dcebf4fa866  MANIFEST.json
  897b532dd13df7c2dc118701277400c33c8b521effbe7f3e2e30eb7030bd3d19  SHA256SUMS.txt
  cdc245d9665d46278619e1e06c094def2e96267527c80a4d626982b00b03caf8  SHA256SUMS-all.txt
EOF

echo ""
echo ">> 完成。文件列表："
ls -lh "$DATA_DIR"/
