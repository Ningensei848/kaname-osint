import * as fs from "node:fs";
import * as path from "node:path";

const WINDOWS_RESERVED_NAMES = new Set([
	"con",
	"prn",
	"aux",
	"nul",
	"com1",
	"com2",
	"com3",
	"com4",
	"com5",
	"com6",
	"com7",
	"com8",
	"com9",
	"lpt1",
	"lpt2",
	"lpt3",
	"lpt4",
	"lpt5",
	"lpt6",
	"lpt7",
	"lpt8",
	"lpt9",
]);

export function resolveTopicPath(
	baseDir: string,
	category: string,
	fileName: string,
	maxDirs = 100,
	fallbackLimit = 95,
): string {
	void maxDirs;
	const topicsDir = path.join(baseDir, "topics");
	if (!fs.existsSync(topicsDir)) {
		fs.mkdirSync(topicsDir, { recursive: true });
	}

	const cleanCategory = sanitizeName(category || "misc");
	const cleanFileName = sanitizeName(fileName);
	const targetDir = path.join(topicsDir, cleanCategory);

	if (fs.existsSync(targetDir)) {
		return path.join(targetDir, `${cleanFileName}.md`);
	}

	const currentSubdirs = getSubdirectories(topicsDir);

	if (currentSubdirs.length >= fallbackLimit) {
		console.warn(
			`Directory limit reached (${currentSubdirs.length} >= ${fallbackLimit}). Falling back to 'topics/misc/' folder to protect against folder sprawl.`,
		);
		const fallbackDir = path.join(topicsDir, "misc");
		if (!fs.existsSync(fallbackDir)) {
			fs.mkdirSync(fallbackDir, { recursive: true });
		}
		return path.join(fallbackDir, `${cleanFileName}.md`);
	}

	fs.mkdirSync(targetDir, { recursive: true });
	return path.join(targetDir, `${cleanFileName}.md`);
}

function getSubdirectories(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((dirent) => dirent.isDirectory())
		.map((dirent) => dirent.name);
}

export function sanitizeName(name: string): string {
	let sanitized = Array.from(name)
		.filter((character) => {
			const codePoint = character.codePointAt(0) ?? 0;
			return codePoint > 0x1f && codePoint !== 0x7f;
		})
		.join("")
		.replace(/[\\/:*?"<>|]/g, "_")
		.replace(/\s+/g, "_")
		.replace(/\.+/g, ".")
		.replace(/^\.+|\.+$/g, "")
		.trim();

	if (sanitized === "") {
		return "unnamed";
	}

	const extension = path.extname(sanitized);
	const stem = extension ? sanitized.slice(0, -extension.length) : sanitized;
	if (WINDOWS_RESERVED_NAMES.has(stem.toLowerCase())) {
		sanitized = `${stem}_safe${extension}`;
	}

	return sanitized || "unnamed";
}
