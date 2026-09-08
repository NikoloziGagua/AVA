import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

const [rootArg, metadataArg] = process.argv.slice(2);

if (!rootArg || !metadataArg) {
  console.error("Usage: node scripts/create-portable-inventory.mjs <root> <metadata-dir>");
  process.exit(1);
}

const root = path.resolve(rootArg);
const metadataDir = path.resolve(metadataArg);
await fsp.mkdir(metadataDir, { recursive: true });

const inventoryPath = path.join(metadataDir, "CURRENT-INVENTORY.tsv");
const inventory = fs.createWriteStream(inventoryPath, { encoding: "utf8" });
inventory.write("kind\tbytes\tmtime_ms\tpath\n");

let fileCount = 0;
let directoryCount = 0;
let symlinkCount = 0;
let fileBytes = 0;
const errors = [];

function safeField(value) {
  return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ");
}

async function walk(absoluteDirectory, relativeDirectory) {
  let directory;
  try {
    directory = await fsp.opendir(absoluteDirectory);
  } catch (error) {
    errors.push({
      path: relativeDirectory || ".",
      error: String(error?.message || error),
    });
    return;
  }

  for await (const entry of directory) {
    const relativePath = relativeDirectory
      ? `${relativeDirectory}/${entry.name}`
      : entry.name;

    // A Git commit cannot contain the object database that contains that same
    // commit. Nested .git directories belonging to captured integrations are
    // ordinary AVA runtime data and remain included.
    if (!relativeDirectory && entry.name.toLowerCase() === ".git") continue;

    const absolutePath = path.join(absoluteDirectory, entry.name);
    let stat;
    try {
      stat = await fsp.lstat(absolutePath);
    } catch (error) {
      errors.push({ path: relativePath, error: String(error?.message || error) });
      continue;
    }

    const inventoryPathField = safeField(relativePath);
    if (stat.isSymbolicLink()) {
      symlinkCount += 1;
      inventory.write(`L\t${stat.size}\t${Math.trunc(stat.mtimeMs)}\t${inventoryPathField}\n`);
      continue;
    }

    if (stat.isDirectory()) {
      directoryCount += 1;
      inventory.write(`D\t0\t${Math.trunc(stat.mtimeMs)}\t${inventoryPathField}\n`);
      await walk(absolutePath, relativePath);
      continue;
    }

    fileCount += 1;
    fileBytes += stat.size;
    inventory.write(`F\t${stat.size}\t${Math.trunc(stat.mtimeMs)}\t${inventoryPathField}\n`);
  }
}

await walk(root, "");
await new Promise((resolve, reject) => {
  inventory.on("error", reject);
  inventory.end(resolve);
});

const summary = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  root,
  fileCount,
  directoryCount,
  symlinkCount,
  fileBytes,
  skippedErrors: errors.length,
  excludedRootGit: true,
  rootGitRepresentation:
    "private GitHub remote plus AVA-git-nonbackup-refs-20260902.bundle",
};

await fsp.writeFile(
  path.join(metadataDir, "INVENTORY-SUMMARY.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
await fsp.writeFile(
  path.join(metadataDir, "INVENTORY-ERRORS.json"),
  `${JSON.stringify(errors, null, 2)}\n`,
);

console.log(JSON.stringify(summary));
if (errors.length > 0) process.exitCode = 2;
