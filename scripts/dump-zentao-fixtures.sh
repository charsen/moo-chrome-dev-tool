#!/usr/bin/env bash
# 拉同事公司禅道实例的 v2 endpoint 真实响应，dump 入 fixture 目录。
# Tier 2 测试方案：单实例 dogfood 测不出多实例 schema 方差，靠真实响应 fixture 永久入测试。
#
# 用法（同事在自己电脑跑）：
#   chmod +x scripts/dump-zentao-fixtures.sh
#   BASE=https://你公司禅道.example.com \
#   ACCOUNT=你的账号 \
#   PASSWORD=你的密码 \
#   PROJECT_ID=26 \
#   ./scripts/dump-zentao-fixtures.sh
#
# 产出：tests/fixtures/zentao-real/raw/*.json（未脱敏，**绝不入仓**）
# 同事跑完后把整个 raw/ 目录打 zip 发给 Charsen。
# Charsen 跑 scripts/anonymize-fixtures.mjs 脱敏，脱敏后产物入 tests/fixtures/zentao-real/anon/ 入仓。

set -euo pipefail

: "${BASE:?需要 BASE，例：BASE=https://公司禅道.example.com}"
: "${ACCOUNT:?需要 ACCOUNT}"
: "${PASSWORD:?需要 PASSWORD}"
: "${PROJECT_ID:?需要 PROJECT_ID（同事提交 bug 用的项目 ID）}"

# 移除 trailing slash
BASE="${BASE%/}"

OUT_DIR="tests/fixtures/zentao-real/raw"
mkdir -p "$OUT_DIR"

echo "==> 1/7 登录拿 token"
LOGIN_RES=$(curl -sS -X POST "$BASE/api.php/v2/users/login" \
  -H "Content-Type: application/json" \
  -d "{\"account\":\"$ACCOUNT\",\"password\":\"$PASSWORD\"}")
echo "$LOGIN_RES" > "$OUT_DIR/01-login.json"

TOKEN=$(node -e "const r = JSON.parse(process.argv[1]); console.log(r.token || '')" "$LOGIN_RES")
USER_ID=$(node -e "const r = JSON.parse(process.argv[1]); console.log(r.user?.id || '')" "$LOGIN_RES")

if [ -z "$TOKEN" ]; then
  echo "❌ 登录失败 —— 检查账号密码 + BASE 是否正确"
  cat "$OUT_DIR/01-login.json"
  exit 1
fi

echo "==> token 拿到（前 8 位）: ${TOKEN:0:8}..."
echo "==> user.id: $USER_ID"

echo "==> 2/7 GET /v2/users/{userid}（ping 端点）"
curl -sS "$BASE/api.php/v2/users/$USER_ID" \
  -H "Token: $TOKEN" \
  -H "X-Requested-With: XMLHttpRequest" > "$OUT_DIR/02-user-detail.json"

echo "==> 3/7 GET /v2/projects/{projectid}（discoverProduct 端点）"
curl -sS "$BASE/api.php/v2/projects/$PROJECT_ID" \
  -H "Token: $TOKEN" \
  -H "X-Requested-With: XMLHttpRequest" > "$OUT_DIR/03-project-detail.json"

echo "==> 4/7 GET /v2/projects?browseType=all&recPerPage=50&pageID=1（listProjects 端点）"
curl -sS "$BASE/api.php/v2/projects?browseType=all&recPerPage=50&pageID=1" \
  -H "Token: $TOKEN" \
  -H "X-Requested-With: XMLHttpRequest" > "$OUT_DIR/04-projects-list.json"

echo "==> 5/7 GET /v2/users?recPerPage=200&pageID=1（listUsers 端点）"
curl -sS "$BASE/api.php/v2/users?recPerPage=200&pageID=1" \
  -H "Token: $TOKEN" \
  -H "X-Requested-With: XMLHttpRequest" > "$OUT_DIR/05-users-list.json"

echo "==> 6/7 GET /v1/products?project={projectid}（v1 fallback 端点）"
curl -sS "$BASE/api.php/v1/products?project=$PROJECT_ID" \
  -H "Token: $TOKEN" \
  -H "X-Requested-With: XMLHttpRequest" > "$OUT_DIR/06-v1-products.json"

echo "==> 7/7 GET /v1/modules?id=...&type=bug（listModules，需要 productId）"
PRODUCT_ID=$(node -e "
  try {
    const r = JSON.parse(require('fs').readFileSync('$OUT_DIR/06-v1-products.json', 'utf8'));
    console.log(r.products?.[0]?.id || '');
  } catch { console.log(''); }
")
if [ -n "$PRODUCT_ID" ]; then
  curl -sS "$BASE/api.php/v1/modules?id=$PRODUCT_ID&type=bug" \
    -H "Token: $TOKEN" \
    -H "X-Requested-With: XMLHttpRequest" > "$OUT_DIR/07-modules.json"
else
  echo "⚠ 跳过 listModules（v1/products 没拿到 productId）"
fi

echo ""
echo "✅ 完成。产物在 $OUT_DIR/"
ls -lh "$OUT_DIR/"

echo ""
echo "下一步："
echo "  1. 检查上述 .json 文件，确认没敏感数据漏（如果有担心，直接删对应文件）"
echo "  2. 整个 raw/ 目录打 zip 发给 Charsen"
echo "     cd tests/fixtures/zentao-real && zip -r raw-from-同事.zip raw/"
echo "  3. Charsen 跑 scripts/anonymize-fixtures.mjs 脱敏后入仓"
echo ""
echo "⚠ raw/ 目录已 gitignored，不会被误 commit"
