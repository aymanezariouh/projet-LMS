import { readFileSync, mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Validate PREFS from the existing contract, without duplicating it or
// changing the project's Postman workspace configuration.
const source = JSON.parse(readFileSync(
  new URL("../postman/specs/lms_project/lms_project.json", import.meta.url), "utf8",
));
const endpoint = "/api/trainer/preferences";
if (!source.paths?.[endpoint]?.get || !source.paths[endpoint].put) {
  throw new Error("The OpenAPI contract must document both PREFS operations.");
}

const components = {};
for (const [type, definitions] of Object.entries(source.components)) {
  components[type] = Object.fromEntries(
    Object.entries(definitions).filter(([name]) => name.startsWith("Prefs")),
  );
}
const spec = {
  openapi: source.openapi,
  info: { title: "LMS API - PREFS", version: source.info.version },
  servers: [{ url: "http://localhost:3000" }],
  paths: { [endpoint]: source.paths[endpoint] },
  components,
  tags: (source.tags || []).filter((tag) => tag.name === "PREFS"),
};

const directory = mkdtempSync(join(tmpdir(), "lms-prefs-openapi-"));
const file = join(directory, "prefs.json");
try {
  writeFileSync(file, JSON.stringify(spec, null, 2));
  const result = spawnSync("postman", [
    "spec", "lint", file, "--issueType=syntax", "--no-report-events",
  ], { cwd: directory, stdio: "inherit" });
  if (result.error) {
    console.error("Unable to run the Postman CLI:", result.error.message);
  }
  process.exitCode = result.status ?? 1;
} finally {
  unlinkSync(file);
  rmdirSync(directory);
}
