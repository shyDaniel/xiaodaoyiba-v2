#!/usr/bin/env bash
# scripts/mcp-chrome-wrapper.sh
#
# Wrapper around the locally-cached Playwright chromium so the MCP servers
# (playwright + chrome-devtools-mcp) can launch a Chrome that actually runs
# in this WSL environment.
#
# Why this exists (S-312):
#   The autopilot spawns @playwright/mcp and chrome-devtools-mcp via npx.
#   By default both look for a system Chrome at /opt/google/chrome which is
#   NOT installed in this sandbox. Even when you point them at the bundled
#   Playwright chromium (~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome)
#   it bails with `libnspr4.so: cannot open shared object file` because the
#   host is missing libnspr4 / libnss3 / libsmime3 / libasound / X11 deps.
#
#   We DO have those libs cached in two places:
#     - /tmp/libs/extracted/usr/lib/x86_64-linux-gnu  (86 libs, full set)
#     - $HOME/.local/chrome-libs/usr/lib/x86_64-linux-gnu  (42 libs, fallback)
#
#   This wrapper:
#     1. picks the most recent cached Playwright chromium under
#        ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome,
#     2. composes LD_LIBRARY_PATH from whichever of the two lib dirs exist
#        (preferring /tmp/libs/extracted because it has the broader set),
#     3. execs chrome with whatever args the MCP server passed in.
#
#   The .mcp.json at the repo root references this script via
#   --executable-path / --executablePath so the autopilot just works
#   without anyone having to apt-install chrome system-wide.
#
# Overrides (export before launching the MCP server):
#   MCP_CHROME_BIN   -- absolute path to a chrome binary
#   MCP_CHROME_LIBS  -- colon-separated lib dirs to prepend to LD_LIBRARY_PATH

set -euo pipefail

# 1) Resolve chrome binary.
CHROME_BIN="${MCP_CHROME_BIN:-}"
if [[ -z "$CHROME_BIN" ]]; then
  # Pick the highest-numbered chromium-N cache dir that actually has a chrome
  # binary inside. Sort by version (-V) so chromium-1217 sorts after chromium-999.
  for candidate in $(ls -d "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux64/chrome 2>/dev/null \
                       | awk -F/ '{print $0"\t"$(NF-2)}' \
                       | sort -V -k2 -r \
                       | cut -f1); do
    if [[ -x "$candidate" ]]; then
      CHROME_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$CHROME_BIN" || ! -x "$CHROME_BIN" ]]; then
  echo "mcp-chrome-wrapper: no executable Playwright chromium found." >&2
  echo "  Looked under $HOME/.cache/ms-playwright/chromium-*/chrome-linux64/chrome" >&2
  echo "  Set MCP_CHROME_BIN=/abs/path/to/chrome to override." >&2
  exit 127
fi

# 2) Compose LD_LIBRARY_PATH from whichever lib dirs exist.
#    Prefer the broader /tmp/libs/extracted set; fall back to ~/.local/chrome-libs.
LIBS_PARTS=()
if [[ -n "${MCP_CHROME_LIBS:-}" ]]; then
  LIBS_PARTS+=("$MCP_CHROME_LIBS")
fi
for d in \
    /tmp/libs/extracted/usr/lib/x86_64-linux-gnu \
    "$HOME/.local/chrome-libs/usr/lib/x86_64-linux-gnu"; do
  if [[ -d "$d" ]]; then
    LIBS_PARTS+=("$d")
  fi
done

if [[ ${#LIBS_PARTS[@]} -eq 0 ]]; then
  echo "mcp-chrome-wrapper: no chrome-libs dir found." >&2
  echo "  Expected one of: /tmp/libs/extracted/usr/lib/x86_64-linux-gnu," >&2
  echo "                   $HOME/.local/chrome-libs/usr/lib/x86_64-linux-gnu" >&2
  echo "  Set MCP_CHROME_LIBS=/abs/path/to/libs to override (must contain libnspr4.so / libnss3.so)." >&2
  exit 127
fi

LIBS_JOINED="$(IFS=:; echo "${LIBS_PARTS[*]}")"
export LD_LIBRARY_PATH="${LIBS_JOINED}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

# 3) Hand off to chrome. Use exec so SIGTERM from the MCP supervisor reaches
#    chrome directly without an intermediate shell.
exec "$CHROME_BIN" "$@"
