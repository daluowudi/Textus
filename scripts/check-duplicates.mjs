#!/usr/bin/env node
// Fails on code copied instead of shared: a run of 80 tokens or more found
// twice in src/ or src-tauri/src/ (jscpd), tests, tables and generated
// files aside. The copies there today are listed; they may go, not grow.
// `--list` prints every copy found and exits 0.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// COPIES_NOW and the report's lines are written with forward slashes, as the
// repository names its files everywhere else; jscpd answers with backslashes
// on Windows, where a plain "ai/rules/ru.rs" key would never match.
const posix = (path) => path.split(sep).join("/");

const IGNORE = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/tests.rs",
  "**/tests/**",
  "**/*_tests.rs",
  "**/live_eval/**",
  "src/i18n/locales/**",
  "src/platform/bindings/**",
  "src/dev/**",
  "**/node_modules/**",
];

/** Copies there today, as "a | b" (sorted, from src/ or src-tauri/src/):
 *  how many each pair of files has. */
const COPIES_NOW = {
  "ai/rules/en/spelling.rs | ai/rules/shared.rs": 1,
  "ai/rules/ja/notation.rs | ai/rules/zh/spacing.rs": 1,
  "ai/rules/ru.rs | ai/rules/tw.rs": 1,
  "ai/rules/tw.rs | ai/rules/zh/wording.rs": 1,
  "editor/marks/enclosure-moves.ts | editor/marks/enclosure-moves.ts": 1,
};

/** jscpd's report, written into `out` and read back. It exits 0 whatever it
 *  finds: what it found is the report, not the status. Its own output is
 *  kept for a failure message: a folder it cannot write into says so there. */
function runJscpd(out) {
  const run = spawnSync(
    // jscpd's own entry, run through this Node. The node_modules/.bin/jscpd
    // beside it is a POSIX shell script, which Windows cannot execute.
    process.execPath,
    [
      join(root, "node_modules/jscpd/run-jscpd.js"),
      "src",
      "src-tauri/src",
      "--format",
      "typescript,tsx,rust",
      "--min-tokens",
      "80",
      "--ignore",
      IGNORE.join(","),
      "--reporters",
      "json",
      "--output",
      out,
      "--silent",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (run.status !== 0)
    throw new Error(
      (run.stderr || run.stdout || "").trim() || `jscpd exited ${run.status}`,
    );
  return JSON.parse(readFileSync(join(out, "jscpd-report.json"), "utf8"));
}

/** The report, from the first folder jscpd will write into: the temporary
 *  folder, or the repository's ignored .cache/ where a machine refuses it
 *  there (the native build answers Windows' os error 5 for %TEMP%). */
function readReport() {
  const cache = join(root, ".cache");
  mkdirSync(cache, { recursive: true });
  let failure;
  for (const parent of [tmpdir(), cache]) {
    const out = mkdtempSync(join(parent, "textus-jscpd-"));
    try {
      return runJscpd(out);
    } catch (error) {
      failure = error;
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  throw failure;
}

const report = readReport();

const found = {};
for (const d of report.duplicates) {
  const at = (f) => `${posix(f.name)}:${f.start}`;
  const key = [posix(d.firstFile.name), posix(d.secondFile.name)]
    .sort()
    .join(" | ");
  (found[key] ??= []).push(`${at(d.firstFile)} and ${at(d.secondFile)}`);
}

if (process.argv.includes("--list")) {
  for (const [key, places] of Object.entries(found).sort())
    console.log(`"${key}": ${places.length},  // ${places.join("; ")}`);
  process.exit(0);
}

const problems = [];
for (const [key, places] of Object.entries(found)) {
  const allowed = COPIES_NOW[key] ?? 0;
  if (places.length > allowed)
    problems.push(
      `copied code: ${places.join("; ")} - share it (a function, a table, a component) instead`,
    );
}
for (const [key, allowed] of Object.entries(COPIES_NOW))
  if ((found[key]?.length ?? 0) < allowed)
    problems.push(
      `${key}: fewer copies than listed - lower or remove its entry in scripts/check-duplicates.mjs`,
    );

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`duplicates: ${report.duplicates.length} known copies, none new`);
