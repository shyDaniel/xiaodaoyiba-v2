#!/usr/bin/env node
/**
 * S-266: pre-approve `.mcp.json` servers in the user-level Claude Code
 * state file (`~/.claude.json`) so that a headless agent-autopilot session
 * (or any non-interactive Claude Code invocation) can actually launch the
 * project's MCP servers instead of silently dropping them at the trust
 * gate.
 *
 * Background: Claude Code consults `~/.claude.json` projects[<repoPath>]
 * for trust at session start. The fields it checks are:
 *   - hasTrustDialogAccepted: boolean
 *   - enabledMcpjsonServers: string[]   (per-server allowlist)
 *   - enableAllProjectMcpServers: boolean (catch-all override)
 * The repo-local `.claude/settings.json` `enableAllProjectMcpServers: true`
 * does NOT override the user-level state file; it's a *separate* settings
 * source that gets merged below the user-level decision. Without an
 * interactive trust dialog (which never runs in autopilot), every server
 * in `.mcp.json` falls through to the built-in npx defaults — which on
 * this host means `npx -y @playwright/mcp@latest` (no `--executable-path`,
 * no `LD_LIBRARY_PATH`) and the very first `browser_navigate` call errors
 * with `Chromium distribution 'chrome' is not found at
 * /opt/google/chrome/chrome`.
 *
 * Run this once per fresh clone or fresh judge runtime BEFORE the first
 * Claude Code session. It is idempotent — re-running is a no-op when the
 * trust state already covers the current `.mcp.json` server set.
 *
 * Usage:
 *   node scripts/trust-mcp.mjs           # trust this repo's .mcp.json
 *   node scripts/trust-mcp.mjs /path     # trust a different repo
 *
 * No external deps; runs on a stock Node 20.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const repoPath = resolve(process.argv[2] ?? process.cwd());
const mcpJsonPath = join(repoPath, '.mcp.json');
const userConfigPath = join(homedir(), '.claude.json');

if (!existsSync(mcpJsonPath)) {
  console.error(`[trust-mcp] no .mcp.json at ${mcpJsonPath}; nothing to do`);
  process.exit(0);
}

let mcpJson;
try {
  mcpJson = JSON.parse(readFileSync(mcpJsonPath, 'utf8'));
} catch (err) {
  console.error(`[trust-mcp] failed to parse ${mcpJsonPath}: ${err.message}`);
  process.exit(1);
}
const serverNames = Object.keys(mcpJson.mcpServers ?? {}).sort();
if (serverNames.length === 0) {
  console.log(`[trust-mcp] .mcp.json has no servers; nothing to trust`);
  process.exit(0);
}

let userConfig = {};
if (existsSync(userConfigPath)) {
  try {
    userConfig = JSON.parse(readFileSync(userConfigPath, 'utf8'));
  } catch {
    // Treat malformed config as empty — we'll write a fresh, valid one.
    userConfig = {};
  }
}
userConfig.projects ??= {};
const proj = userConfig.projects[repoPath] ?? {};

const beforeEnabled = Array.isArray(proj.enabledMcpjsonServers)
  ? proj.enabledMcpjsonServers.filter((s) => typeof s === 'string')
  : [];
const merged = new Set(beforeEnabled);
for (const name of serverNames) merged.add(name);
const nextEnabled = [...merged].sort();

const changed =
  proj.hasTrustDialogAccepted !== true ||
  proj.enableAllProjectMcpServers !== true ||
  nextEnabled.length !== beforeEnabled.length ||
  nextEnabled.some((n, i) => beforeEnabled[i] !== n);

if (!changed) {
  console.log(
    `[trust-mcp] already trusted: ${serverNames.join(', ')} in ${userConfigPath}`,
  );
  process.exit(0);
}

proj.hasTrustDialogAccepted = true;
proj.enableAllProjectMcpServers = true;
proj.enabledMcpjsonServers = nextEnabled;
userConfig.projects[repoPath] = proj;

// Atomic write so an interrupted run cannot corrupt ~/.claude.json.
const tmp = `${userConfigPath}.trust-mcp-tmp.${process.pid}`;
writeFileSync(tmp, JSON.stringify(userConfig, null, 2), 'utf8');
renameSync(tmp, userConfigPath);
console.log(
  `[trust-mcp] pre-approved: ${serverNames.join(', ')} in ${userConfigPath}`,
);
