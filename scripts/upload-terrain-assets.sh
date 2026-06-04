#!/usr/bin/env bash
# Upload the local terrain tile pack (static/Sprites/) to the R2 bucket that
# serves it in prod. Run once, and again whenever the pack changes.
#
#   ./scripts/upload-terrain-assets.sh
#
# Prereqs: wrangler authenticated with R2 read/write (already configured), and
# the bucket exists (betwitxt-assets, already created).
#
# Uploads ONLY image files (PNG/JPG/WEBP). Skips .meta / .DS_Store (Unity
# import cruft the app never reads). The R2 key is the path relative to
# static/Sprites/, matching the /api/sprites/[...path] route + the manifest.
set -euo pipefail

BUCKET="betwitxt-assets"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/static/Sprites"

[ -d "$SRC" ] || { echo "No $SRC — nothing to upload." >&2; exit 1; }

content_type() {
  case "${1##*.}" in
    png|PNG) echo "image/png" ;;
    webp|WEBP) echo "image/webp" ;;
    jpg|JPG|jpeg|JPEG) echo "image/jpeg" ;;
    *) echo "application/octet-stream" ;;
  esac
}

total=$(find "$SRC" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) | wc -l | tr -d ' ')
echo "Uploading $total image(s) from static/Sprites/ → r2://$BUCKET"
i=0
find "$SRC" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -print0 \
  | while IFS= read -r -d '' file; do
  key="${file#"$SRC"/}"          # path relative to static/Sprites == R2 key
  ct="$(content_type "$file")"
  i=$((i + 1))
  printf '[%d/%d] %s\n' "$i" "$total" "$key"
  npx wrangler r2 object put "$BUCKET/$key" --file "$file" --content-type "$ct" --remote
done
echo "Done. ($total uploaded)"
