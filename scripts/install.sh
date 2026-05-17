#!/bin/sh
set -eu

VERSION="${GUILDHALL_VERSION:-latest}"
HOME_DIR="${HOME}"
GUILDHALL_HOME="${HOME_DIR}/.guildhall"
APP_DIR="${GUILDHALL_HOME}/app"
BIN_DIR="${GUILDHALL_HOME}/bin"
LOCAL_BIN_DIR="${HOME_DIR}/.local/bin"
CURRENT_DIR="${APP_DIR}/current"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

artifact_url() {
  if [ -n "${GUILDHALL_ARTIFACT_URL:-}" ]; then
    printf '%s' "$GUILDHALL_ARTIFACT_URL"
  elif [ "$VERSION" = "latest" ]; then
    printf '%s' "https://github.com/matthew-dean/guildhall/releases/latest/download/guildhall-macos.tar.gz"
  else
    printf '%s' "https://github.com/matthew-dean/guildhall/releases/download/v${VERSION}/guildhall-macos.tar.gz"
  fi
}

checksum_url() {
  if [ -n "${GUILDHALL_CHECKSUM_URL:-}" ]; then
    printf '%s' "$GUILDHALL_CHECKSUM_URL"
  else
    printf '%s.sha256' "$(artifact_url)"
  fi
}

verify_checksum() {
  CHECKSUM_FILE="$TMP_DIR/guildhall-macos.tar.gz.sha256"
  curl -fsSL "$(checksum_url)" -o "$CHECKSUM_FILE"
  EXPECTED_SHA="$(awk '{print $1}' "$CHECKSUM_FILE")"
  ACTUAL_SHA="$(shasum -a 256 "$TMP_DIR/guildhall-macos.tar.gz" | awk '{print $1}')"
  if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
    printf 'Checksum mismatch for guildhall-macos.tar.gz\n' >&2
    printf 'Expected: %s\n' "$EXPECTED_SHA" >&2
    printf 'Actual:   %s\n' "$ACTUAL_SHA" >&2
    exit 1
  fi
}

mkdir -p "$APP_DIR" "$BIN_DIR" "$LOCAL_BIN_DIR" "$GUILDHALL_HOME/logs"

if [ -n "${GUILDHALL_ARTIFACT_DIR:-}" ]; then
  cp -R "$GUILDHALL_ARTIFACT_DIR" "$TMP_DIR/guildhall-macos"
else
  curl -fsSL "$(artifact_url)" -o "$TMP_DIR/guildhall-macos.tar.gz"
  verify_checksum
  tar -xzf "$TMP_DIR/guildhall-macos.tar.gz" -C "$TMP_DIR"
fi

RELEASE_VERSION="$(/usr/bin/python3 - <<'PY' "$TMP_DIR/guildhall-macos/manifest.json"
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as fh:
    print(json.load(fh)['version'])
PY
)"

RELEASE_DIR="${APP_DIR}/${RELEASE_VERSION}"
rm -rf "$RELEASE_DIR"
mkdir -p "$APP_DIR"
mv "$TMP_DIR/guildhall-macos" "$RELEASE_DIR"

rm -rf "$CURRENT_DIR"
ln -s "$RELEASE_DIR" "$CURRENT_DIR"
ln -sf "$CURRENT_DIR/bin/guildhall" "$BIN_DIR/guildhall"
ln -sf "$BIN_DIR/guildhall" "$LOCAL_BIN_DIR/guildhall"

"$CURRENT_DIR/runtime/node" "$CURRENT_DIR/install/install-launch-agent.mjs" \
  --home "$HOME_DIR" \
  --install-dir "$CURRENT_DIR" \
  --bin-path "$BIN_DIR/guildhall" \
  --template "$CURRENT_DIR/install/io.guildhall.agent.plist.tmpl"

printf '\nGuildhall is installed.\n\n'
printf 'Next commands:\n'
printf '  %s\n' "guildhall serve"
printf '  %s\n' "guildhall open"
printf '  %s\n' "guildhall stop"

case ":${PATH}:" in
  *":${LOCAL_BIN_DIR}:"*) ;;
  *)
    printf '\nNote: %s is not on your PATH yet.\n' "$LOCAL_BIN_DIR"
    printf 'Add this to your shell profile and restart your shell:\n'
    printf '  export PATH="%s:$PATH"\n' "$LOCAL_BIN_DIR"
    ;;
esac
