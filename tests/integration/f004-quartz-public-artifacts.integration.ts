import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { assertQuartzGraphDisabledArtifact } from "../helpers/quartz-artifact-contract";

const repoRoot = process.cwd();
const publicDir = path.join(repoRoot, "public");

function listHtmlFiles(rootDir: string): string[] {
	const entries = fs.readdirSync(rootDir, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const absolutePath = path.join(rootDir, entry.name);
		if (entry.isDirectory()) return listHtmlFiles(absolutePath);
		return entry.isFile() && entry.name.endsWith(".html") ? [absolutePath] : [];
	});
}

test("F004 production Quartz public artifacts contain no graph view UI or scripts", () => {
	assert.ok(
		fs.existsSync(publicDir),
		"public/ must be prepared by the CI job before this integration test runs",
	);

	const htmlArtifacts = listHtmlFiles(publicDir);
	assert.ok(
		htmlArtifacts.length > 0,
		"public/ must contain at least one HTML artifact",
	);

	assert.deepStrictEqual(
		assertQuartzGraphDisabledArtifact(
			htmlArtifacts.map((absolutePath) => ({
				path: path.relative(repoRoot, absolutePath),
				html: fs.readFileSync(absolutePath, "utf8"),
			})),
		),
		[],
	);
});
