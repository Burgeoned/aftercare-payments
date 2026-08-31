#!/usr/bin/env node
/**
 * Exports Claude Code session transcripts to readable Markdown.
 *
 * Claude Code stores one JSONL file per session under
 *   ~/.claude/projects/<slugified-cwd>/<session-id>.jsonl
 * keyed by the working directory, so only sessions started inside this repo are
 * picked up. Sessions from other projects cannot leak in by accident.
 *
 * Two things this does beyond a format conversion:
 *
 *   1. Redacts anything shaped like a credential before it reaches a file that
 *      gets shared. Nothing should reach the transcript in the first place, but
 *      a submission is the wrong place to rely on that having gone perfectly.
 *   2. Truncates tool output. A raw transcript is mostly file dumps and build
 *      logs. What a reader wants is the conversation and which tools ran.
 *
 * Usage:
 *   node scripts/export-session.mjs              # all sessions for this repo
 *   node scripts/export-session.mjs --list       # list without writing
 *   node scripts/export-session.mjs --out ai-sessions
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const MAX_TOOL_OUTPUT_CHARS = 600;

/** Patterns for values that must never appear in a shared transcript. */
const REDACTIONS = [
  [/\bsnd_[A-Za-z0-9]{8,}/g, "snd_[REDACTED]"],
  [/\bpk_snd_[A-Za-z0-9]{8,}/g, "pk_snd_[REDACTED]"],
  [/\bsk_(test|live)_[A-Za-z0-9]{8,}/g, "sk_[REDACTED]"],
  [/\bpk_(test|live)_[A-Za-z0-9]{8,}/g, "pk_[REDACTED]"],
  [/\bwhsec_[A-Za-z0-9]{8,}/g, "whsec_[REDACTED]"],
  [/\bpro_[A-Za-z0-9]{12,}/g, "pro_[REDACTED]"],
  [/\bghp_[A-Za-z0-9]{20,}/g, "ghp_[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._-]{20,}/g, "Bearer [REDACTED]"],
];

function redact(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

function truncate(text, limit = MAX_TOOL_OUTPUT_CHARS) {
  const s = String(text ?? "");
  if (s.length <= limit) return s;
  return `${s.slice(0, limit)}\n... [${s.length - limit} more characters]`;
}

/** Claude Code slugifies the project path: C:\Users\x\dev\y -> C--Users-x-dev-y */
function projectSlug(dir) {
  return resolve(dir).replace(/:/g, "-").replace(/[\\/]/g, "-");
}

function renderContent(content) {
  if (typeof content === "string") return redact(content).trim();
  if (!Array.isArray(content)) return "";

  const parts = [];
  for (const block of content) {
    if (block.type === "text" && block.text?.trim()) {
      parts.push(redact(block.text).trim());
    } else if (block.type === "tool_use") {
      const input = JSON.stringify(block.input ?? {});
      parts.push(
        `> **Tool: \`${block.name}\`**\n>\n> \`\`\`json\n> ${truncate(redact(input), 400).replace(/\n/g, "\n> ")}\n> \`\`\``,
      );
    } else if (block.type === "tool_result") {
      const raw =
        typeof block.content === "string"
          ? block.content
          : Array.isArray(block.content)
            ? block.content.map((c) => c.text ?? "").join("\n")
            : "";
      if (raw.trim()) {
        parts.push(`<details>\n<summary>Tool output</summary>\n\n\`\`\`\n${truncate(redact(raw))}\n\`\`\`\n\n</details>`);
      }
    }
  }
  return parts.join("\n\n");
}

function convert(jsonlPath) {
  const lines = readFileSync(jsonlPath, "utf8").split(/\r?\n/).filter(Boolean);

  const out = [];
  let started = null;
  let branch = null;
  let turns = 0;

  for (const line of lines) {
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }

    if (started === null && record.timestamp) started = record.timestamp;
    if (record.gitBranch) branch = record.gitBranch;

    const message = record.message;
    if (!message?.role) continue;

    const body = renderContent(message.content);
    if (!body) continue;

    if (message.role === "user") {
      turns += 1;
      out.push(`\n---\n\n### ${turns}. Prompt\n\n${body}`);
    } else if (message.role === "assistant") {
      out.push(`\n**Response**\n\n${body}`);
    }
  }

  const header = [
    `# Session ${jsonlPath.split(/[\\/]/).pop().replace(".jsonl", "")}`,
    "",
    `- Started: ${started ?? "unknown"}`,
    `- Branch: ${branch ?? "unknown"}`,
    `- Prompts: ${turns}`,
    "",
    "Exported by `scripts/export-session.mjs`. Tool output is truncated and",
    "credential-shaped strings are redacted.",
  ].join("\n");

  return { markdown: `${header}\n${out.join("\n")}\n`, turns, started };
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list");
const outIdx = args.indexOf("--out");
const outDir = outIdx !== -1 ? args[outIdx + 1] : "ai-sessions";

const projectDir = join(homedir(), ".claude", "projects", projectSlug(process.cwd()));

if (!existsSync(projectDir)) {
  console.error(
    `No transcripts found at ${projectDir}\n` +
      `Sessions are keyed by working directory. Run this from the repo root, ` +
      `and only after at least one Claude session has run here.`,
  );
  process.exit(1);
}

const files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
if (files.length === 0) {
  console.error(`No .jsonl transcripts in ${projectDir}`);
  process.exit(1);
}

if (!listOnly) mkdirSync(outDir, { recursive: true });

console.log(`\nTranscripts in ${projectDir}\n`);

for (const file of files.sort()) {
  const { markdown, turns, started } = convert(join(projectDir, file));
  const name = `session-${file.replace(".jsonl", "").slice(0, 8)}.md`;

  if (listOnly) {
    console.log(`  ${name.padEnd(24)} ${turns} prompts   ${started ?? ""}`);
    continue;
  }

  writeFileSync(join(outDir, name), markdown, "utf8");
  console.log(`  wrote ${join(outDir, name).padEnd(34)} ${turns} prompts`);
}

if (!listOnly) {
  console.log(
    `\nDone. Review every file before committing, then write ${outDir}/README.md ` +
      `pointing at the moments worth reading.\n`,
  );
}
