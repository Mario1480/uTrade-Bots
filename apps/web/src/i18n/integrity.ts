import fs from "node:fs";
import path from "node:path";

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flattenKeys(obj: JsonValue, prefix = ""): string[] {
  if (!isObject(obj)) return [];
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    keys.push(next);
    keys.push(...flattenKeys(value, next));
  }
  return keys;
}

function readJson(filePath: string): JsonValue {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as JsonValue;
}

function run() {
  const baseDir = path.resolve(process.cwd(), "messages");
  const enDir = path.join(baseDir, "en");
  const deDir = path.join(baseDir, "de");

  const enFiles = fs.readdirSync(enDir).filter((name) => name.endsWith(".json")).sort();
  const deFiles = fs.readdirSync(deDir).filter((name) => name.endsWith(".json")).sort();

  const missingFilesInDe = enFiles.filter((name) => !deFiles.includes(name));
  const missingFilesInEn = deFiles.filter((name) => !enFiles.includes(name));

  const problems: string[] = [];

  if (missingFilesInDe.length > 0) {
    problems.push(`Missing files in de: ${missingFilesInDe.join(", ")}`);
  }
  if (missingFilesInEn.length > 0) {
    problems.push(`Missing files in en: ${missingFilesInEn.join(", ")}`);
  }

  for (const file of enFiles) {
    if (!deFiles.includes(file)) continue;
    const enJson = readJson(path.join(enDir, file));
    const deJson = readJson(path.join(deDir, file));
    const enKeys = new Set(flattenKeys(enJson));
    const deKeys = new Set(flattenKeys(deJson));

    const missingInDe = [...enKeys].filter((key) => !deKeys.has(key));
    const missingInEn = [...deKeys].filter((key) => !enKeys.has(key));

    if (missingInDe.length > 0) {
      problems.push(`${file}: missing keys in de -> ${missingInDe.join(", ")}`);
    }
    if (missingInEn.length > 0) {
      problems.push(`${file}: missing keys in en -> ${missingInEn.join(", ")}`);
    }
  }

  if (problems.length > 0) {
    for (const line of problems) {
      console.error(line);
    }
    process.exit(1);
  }

  console.log("i18n integrity check passed");
}

run();
