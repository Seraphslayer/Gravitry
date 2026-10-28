// Syntax-checks every file in /api and counts the serverless functions
// (Vercel's Hobby plan allows 12; files starting with "_" are shared code).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const dir = path.resolve(import.meta.dirname, "..", "api");
const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
let bad = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", path.join(dir, f)], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    bad++;
    console.error(`FAIL ${f}\n${r.stderr}`);
  }
}
const functions = files.filter((f) => !f.startsWith("_"));
console.log(
  `${files.length} api files checked, ${functions.length} serverless functions (limit 12)`,
);
if (functions.length > 12) {
  console.error("Too many serverless functions for the Hobby plan");
  bad++;
}
process.exit(bad ? 1 : 0);
