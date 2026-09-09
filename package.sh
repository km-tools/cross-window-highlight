#!/usr/bin/env bash
# ストア提出用 ZIP を作る。
#   ./package.sh            → dist/cross-window-highlight-<version>.zip
#   ./package.sh --verify   → 生成した ZIP を展開して e2e（Phase 1〜3 の完了条件）を通す
#
# ZIP に入るのは src/ の中身だけ（manifest.json が ZIP のルートに来る）。
# docs/ store/ tools/ README.md .git などは src/ の外にあるので自動的に除外される。
# src/ の中でも .DS_Store / Thumbs.db / *.map / icons/icon.svg は除外する。
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(python -c "import json;print(json.load(open('src/manifest.json',encoding='utf-8'))['version'])")
OUT="dist/cross-window-highlight-${VERSION}.zip"
mkdir -p dist
rm -f "$OUT"

# Windows（Git Bash）に zip が無いことが多いので、Python の zipfile で作る（パス区切りは / に統一）
python - "$OUT" <<'PY'
import os, sys, zipfile
out = sys.argv[1]
src = "src"
skip_names = {".DS_Store", "Thumbs.db"}
skip_paths = {"icons/icon.svg"}  # 元絵。ストアには PNG だけあればよい
n = 0
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(src):
        dirnames.sort()
        for f in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, f), src).replace(os.sep, "/")
            if f in skip_names or rel in skip_paths or f.endswith(".map"):
                continue
            z.write(os.path.join(dirpath, f), rel)
            n += 1
print(f"{out}: {n} files")
with zipfile.ZipFile(out) as z:
    names = z.namelist()
    assert "manifest.json" in names, "manifest.json が ZIP のルートにない"
    for must in ("background.js", "content.js", "settings.js", "license.js", "popup/popup.html", "_locales/ja/messages.json", "_locales/en/messages.json", "icons/icon128.png"):
        assert must in names, f"{must} が入っていない"
PY

if [[ "${1:-}" == "--verify" ]]; then
  TMP=$(mktemp -d)
  python -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$OUT" "$TMP"
  echo "verify: $TMP"
  export CWH_EXT_DIR="$TMP"
  node tools/e2e.js --lang=ja | tail -1
  node tools/e2e.js --lang=en | tail -1
  node tools/e2e-pro.js | tail -1
  rm -rf "$TMP"
fi
