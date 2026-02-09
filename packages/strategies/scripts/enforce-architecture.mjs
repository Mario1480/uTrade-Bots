import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const rootDir = process.cwd();
const srcDir = path.join(rootDir, "src");
const packageJsonPath = path.join(rootDir, "package.json");

const forbiddenDependencyNames = new Set([
  "@mm/futures-exchange",
  "@mm/exchange",
  "@mm/futures-engine",
  "axios",
  "node-fetch"
]);

const forbiddenPatterns = [
  {
    id: "forbidden-import-futures-exchange",
    regex: /from\s+["']@mm\/futures-exchange["']/g,
    message: "Strategies must not import @mm/futures-exchange."
  },
  {
    id: "forbidden-import-exchange",
    regex: /from\s+["']@mm\/exchange["']/g,
    message: "Strategies must not import @mm/exchange."
  },
  {
    id: "forbidden-import-futures-engine",
    regex: /from\s+["']@mm\/futures-engine["']/g,
    message: "Strategies must not import @mm/futures-engine."
  },
  {
    id: "forbidden-import-relative-exchange",
    regex: /from\s+["'][^"']*exchange[^"']*["']/g,
    message: "Strategies must not import exchange paths."
  },
  {
    id: "forbidden-symbol-futures-exchange",
    regex: /\bFuturesExchange\b/g,
    message: "Strategies must not reference FuturesExchange."
  },
  {
    id: "forbidden-call-place-order",
    regex: /\bplaceOrder\s*\(/g,
    message: "Strategies must not call placeOrder()."
  },
  {
    id: "forbidden-call-cancel-order",
    regex: /\bcancelOrder\s*\(/g,
    message: "Strategies must not call cancelOrder()."
  },
  {
    id: "forbidden-import-axios",
    regex: /from\s+["']axios["']/g,
    message: "Strategies must remain pure and must not import axios."
  },
  {
    id: "forbidden-import-node-fetch",
    regex: /from\s+["']node-fetch["']/g,
    message: "Strategies must remain pure and must not import node-fetch."
  }
];

function collectLineNumber(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(abs)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(abs);
    }
  }

  return out;
}

async function checkDependencies(errors) {
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  const deps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.optionalDependencies ?? {})
  };

  for (const depName of Object.keys(deps)) {
    if (forbiddenDependencyNames.has(depName)) {
      errors.push({
        file: "package.json",
        line: 1,
        message: `Forbidden strategy dependency detected: ${depName}`
      });
    }
  }
}

async function main() {
  const errors = [];
  await checkDependencies(errors);

  const files = await collectFiles(srcDir);
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");

    for (const pattern of forbiddenPatterns) {
      pattern.regex.lastIndex = 0;
      let match = pattern.regex.exec(content);
      while (match) {
        errors.push({
          file: path.relative(rootDir, file),
          line: collectLineNumber(content, match.index),
          message: `${pattern.message} [${pattern.id}]`
        });
        match = pattern.regex.exec(content);
      }
    }
  }

  if (errors.length > 0) {
    const output = errors
      .map((err) => `- ${err.file}:${err.line} ${err.message}`)
      .join("\n");
    console.error("Architecture boundary violation(s) found in @mm/strategies:\n" + output);
    process.exit(1);
  }

  console.log("Architecture boundary check passed for @mm/strategies.");
}

main().catch((error) => {
  console.error("Architecture boundary check failed unexpectedly:", error);
  process.exit(1);
});
