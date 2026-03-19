import fs from "node:fs/promises";
import path from "node:path";

type CsvRow = Record<string, string>;

type RecoverEntry = {
  file: string;
  rows: number;
  uniqueAdded: number;
};

type BucketSummary = {
  bucket: string;
  files: RecoverEntry[];
  rows: number;
  uniqueRows: number;
};

function parseArgs(argv: string[]) {
  const sources: string[] = [];
  let outDir = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--source") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --source");
      sources.push(value);
      i += 1;
      continue;
    }
    if (arg === "--out") {
      const value = argv[i + 1];
      if (!value) throw new Error("Missing value for --out");
      outDir = value;
      i += 1;
      continue;
    }
  }
  if (!sources.length) throw new Error("At least one --source is required");
  if (!outDir) throw new Error("--out is required");
  return { sources, outDir };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function escapeCsvValue(value: string) {
  if (/[",\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function stringifyCsv(rows: CsvRow[]) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvValue(String(row[header] ?? ""))).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function getRowKey(row: CsvRow) {
  const itemId = String(row.item_id || "").trim();
  if (itemId) return itemId;
  const url = String(row.url || "").trim();
  if (url) return url;
  return [
    String(row.platform || "").trim(),
    String(row.source || "").trim(),
    String(row.title || "").trim(),
    String(row.author || "").trim(),
    String(row.published_at || "").trim(),
  ].join("::");
}

async function listCsvFiles(sourceDir: string) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".csv"))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort();
}

function getBucketName(filePath: string) {
  const base = path.basename(filePath);
  const marker = "-growth-trends-";
  const index = base.indexOf(marker);
  if (index === -1) return base.replace(/\.csv$/i, "");
  return base.slice(0, index);
}

async function main() {
  const { sources, outDir } = parseArgs(process.argv.slice(2));
  await fs.mkdir(outDir, { recursive: true });

  const bucketRows = new Map<string, CsvRow[]>();
  const bucketKeys = new Map<string, Set<string>>();
  const bucketSummaries = new Map<string, BucketSummary>();

  for (const sourceDir of sources) {
    const files = await listCsvFiles(sourceDir);
    for (const file of files) {
      const bucket = getBucketName(file);
      const content = await fs.readFile(file, "utf8");
      const rows = parseCsv(content);
      const mergedRows = bucketRows.get(bucket) || [];
      const seenKeys = bucketKeys.get(bucket) || new Set<string>();
      let uniqueAdded = 0;

      for (const row of rows) {
        const key = getRowKey(row);
        if (!key || seenKeys.has(key)) continue;
        seenKeys.add(key);
        mergedRows.push(row);
        uniqueAdded += 1;
      }

      bucketRows.set(bucket, mergedRows);
      bucketKeys.set(bucket, seenKeys);

      const summary = bucketSummaries.get(bucket) || {
        bucket,
        files: [],
        rows: 0,
        uniqueRows: 0,
      };
      summary.files.push({
        file,
        rows: rows.length,
        uniqueAdded,
      });
      summary.rows += rows.length;
      summary.uniqueRows = mergedRows.length;
      bucketSummaries.set(bucket, summary);
    }
  }

  for (const [bucket, rows] of bucketRows.entries()) {
    const target = path.join(outDir, `${bucket}-merged.csv`);
    await fs.writeFile(target, stringifyCsv(rows), "utf8");
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sources,
    outDir,
    buckets: Array.from(bucketSummaries.values()).sort((left, right) => left.bucket.localeCompare(right.bucket)),
  };
  await fs.writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
