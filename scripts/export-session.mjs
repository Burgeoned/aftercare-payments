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
 *   node scripts/export-session.mjs                        # this repo's sessions
 *   node scripts/export-session.mjs --list                 # list without writing
 *   node scripts/export-session.mjs --out ai-sessions
 *   node scripts/export-session.mjs --project <slug|path>  # another project's dir
 *   node scripts/export-session.mjs --session <id-prefix>  # one session only
 *   node scripts/export-session.mjs --from <n>             # start at operator prompt n
 *   node scripts/export-session.mjs --redact <file>        # extra strings to remove
 *
 * `--project` exists because a transcript is filed under the working directory
 * the session ran in, not the repo it produced. Work done on this repo from a
 * different cwd lands where this script would otherwise never look.
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

/**
 * Extra literal strings to remove, loaded from a file that is not committed.
 *
 * A session can pick up something personal that no pattern would catch: a
 * former employer, a salary figure, the name of an unrelated project. Those
 * came from the operator's own screen rather than from anything this repo
 * produced, and no regular expression is going to recognise them.
 *
 * The list lives outside the repository on purpose. Committing "redact this
 * employer's name" into a public repository publishes the employer's name,
 * which is the thing the redaction was for.
 */
let extraRedactions = [];

function loadExtraRedactions(path) {
  if (path === undefined) return;

  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));

  extraRedactions = lines.map((literal) => new RegExp(escapeRegExp(literal), "gi"));
  console.log(`  redacting ${lines.length} additional string(s) from ${path}`);
}

function escapeRegExp(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redact(text) {
  let out = String(text ?? "");
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  for (const pattern of extraRedactions) out = out.replace(pattern, "[REDACTED]");
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

function convert(jsonlPath, fromPrompt = 1) {
  const lines = readFileSync(jsonlPath, "utf8").split(/\r?\n/).filter(Boolean);

  const out = [];
  let started = null;
  let branch = null;
  let turns = 0;
  let subagentTurns = 0;
  let inSubagent = false;
  let included = 0;
  // Everything before the first included prompt is dropped, responses and tool
  // output with it, so a withheld prompt does not leave its answer behind.
  let skipping = fromPrompt > 1;

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

    /**
     * A tool result comes back as a user-role message carrying only
     * tool_result blocks. It is the harness replying to the model, not the
     * operator talking. Counting these as prompts inflated the count by about
     * ten times and turned every build log into a numbered heading, which
     * overstates how much of the work was directed by hand. That is the one
     * number a reader of this export is most likely to draw a conclusion from,
     * so it has to be the real one.
     */
    const isToolResult =
      Array.isArray(message.content) &&
      message.content.length > 0 &&
      message.content.every((block) => block.type === "tool_result");

    /**
     * Subagent turns land in this same file flagged `isSidechain`. They are not
     * the operator talking, and rendering them inline as prompts makes the
     * transcript unreadable and overstates how much was directed by hand. They
     * are kept, because delegation is part of the process worth showing, but
     * they are fenced off and counted separately.
     */
    const isSide = record.isSidechain === true;

    if (isSide && !inSubagent) {
      out.push(`\n<blockquote>\n<strong>Subagent thread</strong>\n`);
      inSubagent = true;
    } else if (!isSide && inSubagent) {
      out.push(`\n</blockquote>\n`);
      inSubagent = false;
    }

    if (message.role === "user") {
      if (isToolResult) {
        // Belongs to the assistant turn above it, not to a new prompt.
        if (!skipping) out.push(`\n${body}`);
      } else if (isSide) {
        if (!skipping) {
          subagentTurns += 1;
          out.push(`\n**Subagent prompt**\n\n${body}`);
        }
      } else {
        turns += 1;
        skipping = turns < fromPrompt;
        if (!skipping) {
          included += 1;
          // Numbering follows the original session, not this export, so a
          // reader can see that prompts were withheld rather than renumbered.
          out.push(`\n---\n\n### ${turns}. Prompt\n\n${body}`);
        }
      }
    } else if (message.role === "assistant") {
      if (!skipping) out.push(`\n**${isSide ? "Subagent response" : "Response"}**\n\n${body}`);
    }
  }

  if (inSubagent) out.push(`\n</blockquote>\n`);

  const withheld =
    fromPrompt > 1
      ? [
          `- Prompts 1 to ${fromPrompt - 1} withheld from this export`,
          "",
          "This session ran from a different working directory and its opening",
          "prompts carry context unrelated to this repo. They are cut with the",
          "exporter's `--from` flag rather than edited out of the file by hand,",
          "so the export stays reproducible and the cut stays visible.",
        ]
      : [];

  const header = [
    `# Session ${jsonlPath.split(/[\\/]/).pop().replace(".jsonl", "")}`,
    "",
    `- Started: ${started ?? "unknown"}`,
    `- Branch: ${branch ?? "unknown"}`,
    `- Operator prompts: ${included}${fromPrompt > 1 ? ` of ${turns}` : ""}`,
    `- Subagent turns: ${subagentTurns}`,
    ...withheld,
    "",
    "Exported by `scripts/export-session.mjs`. Tool output is truncated and",
    "credential-shaped strings are redacted. Subagent threads are quoted blocks",
    "and counted separately, because they are delegated work rather than",
    "direction given by hand. Tool results are not counted as prompts: they are",
    "the harness replying to the model, not the operator.",
  ].join("\n");

  return { markdown: `${header}\n${out.join("\n")}\n`, turns: included, subagentTurns, started };
}

const args = process.argv.slice(2);
const listOnly = args.includes("--list");

function flag(name) {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const outDir = flag("--out") ?? "ai-sessions";
const projectArg = flag("--project");
const sessionArg = flag("--session");
loadExtraRedactions(flag("--redact"));
// Cuts the export at an operator prompt boundary. Used when a session's
// opening prompts carry context that does not belong in a shared repo.
const fromPrompt = Number(flag("--from") ?? 1);

if (!Number.isInteger(fromPrompt) || fromPrompt < 1) {
  console.error(`--from takes a positive integer prompt number, got "${flag("--from")}"`);
  process.exit(1);
}

const PROJECTS_ROOT = join(homedir(), ".claude", "projects");

/**
 * Accepts a slug as Claude Code files it, a repo path to slugify, or a literal
 * directory of .jsonl files. Tried in that order, so passing a repo path
 * resolves to that repo's transcripts rather than to the repo itself.
 */
function resolveProjectDir(arg) {
  if (arg === undefined) return join(PROJECTS_ROOT, projectSlug(process.cwd()));

  const asSlug = join(PROJECTS_ROOT, arg);
  if (existsSync(asSlug)) return asSlug;

  const slugified = join(PROJECTS_ROOT, projectSlug(arg));
  if (existsSync(slugified)) return slugified;

  return arg;
}

const defaultDir = join(PROJECTS_ROOT, projectSlug(process.cwd()));
const projectDir = resolveProjectDir(projectArg);

if (!existsSync(projectDir)) {
  console.error(
    `No transcripts found at ${projectDir}\n` +
      `Sessions are keyed by working directory. Run this from the repo root, ` +
      `and only after at least one Claude session has run here.`,
  );
  process.exit(1);
}

// The cwd default is a safety property: it makes it impossible to export a
// session that ran on some other project. Overriding it gives that up, so it
// says so rather than doing it quietly.
if (resolve(projectDir) !== resolve(defaultDir)) {
  console.warn(
    `\n  WARNING: exporting from another project's transcript directory.\n` +
      `  ${projectDir}\n` +
      `  Sessions filed there may contain work unrelated to this repo. Export\n` +
      `  outside the repo with --out, read every file, and only then commit.\n`,
  );
}

let files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
if (sessionArg !== undefined) {
  files = files.filter((f) => f.startsWith(sessionArg));
}

if (files.length === 0) {
  console.error(
    sessionArg !== undefined
      ? `No transcript in ${projectDir} starting with "${sessionArg}"`
      : `No .jsonl transcripts in ${projectDir}`,
  );
  process.exit(1);
}

if (!listOnly) mkdirSync(outDir, { recursive: true });

console.log(`\nTranscripts in ${projectDir}\n`);

for (const file of files.sort()) {
  const { markdown, turns, subagentTurns, started } = convert(join(projectDir, file), fromPrompt);
  const name = `session-${file.replace(".jsonl", "").slice(0, 8)}.md`;

  if (listOnly) {
    console.log(`  ${name.padEnd(24)} ${turns} prompts, ${subagentTurns} subagent   ${started ?? ""}`);
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
