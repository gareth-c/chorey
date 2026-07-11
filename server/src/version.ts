import fs from "node:fs";
import path from "node:path";

interface VersionFile {
  year: number;
  month: number;
  build: number;
}

export interface VersionInfo extends VersionFile {
  label: string;
}

// version.json is baked in at build time (see Dockerfile / CI bump step), so
// the label reflects exactly what's running rather than what today's date
// would compute. It lives at the repo root, which is:
//   - dev (tsx from server/src):   ../../version.json
//   - prod (node dist/ at /app):   ../version.json  (COPYed to /app/version.json)
function readVersionFile(): VersionInfo {
  const candidates = [
    path.join(__dirname, "..", "version.json"),
    path.join(__dirname, "..", "..", "version.json"),
  ];
  for (const file of candidates) {
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf-8")) as VersionFile;
      return {
        ...v,
        label: `${v.year}.${String(v.month).padStart(2, "0")} Build ${v.build}`,
      };
    } catch {
      // try the next candidate path
    }
  }
  return { year: 0, month: 0, build: 0, label: "unknown" };
}

// Resolved once at startup — it can't change while the process runs.
export const version: VersionInfo = readVersionFile();
