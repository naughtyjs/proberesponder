import fs from "node:fs";
import path from "node:path";

const summaryPath = path.resolve("coverage", "coverage-summary.json");
const minLines = 95;
const minBranches = 88;

if (!fs.existsSync(summaryPath)) {
  console.error(`coverage summary not found at ${summaryPath}`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const total = summary?.total;

if (!total) {
  console.error("coverage summary does not contain total metrics");
  process.exit(1);
}

const linesPct = Number(total.lines?.pct ?? 0);
const branchesPct = Number(total.branches?.pct ?? 0);

if (linesPct < minLines || branchesPct < minBranches) {
  console.error(
    `coverage thresholds not met: lines=${linesPct}% (min ${minLines}%), branches=${branchesPct}% (min ${minBranches}%)`
  );
  process.exit(1);
}

console.log(
  `coverage thresholds met: lines=${linesPct}% branches=${branchesPct}%`
);
