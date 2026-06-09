import type { GuardResult } from "./types";

export function noOverwriteGuard(before: string, after: string): GuardResult {
	const beforeLines = parseMarkdownBody(before)
		.split(/\r?\n/)
		.map(normalizePreservedLine)
		.filter((line) => line.length > 0);
	const afterLineCounts = countLines(
		parseMarkdownBody(after)
			.split(/\r?\n/)
			.map(normalizePreservedLine)
			.filter((line) => line.length > 0),
	);
	const errors: string[] = [];

	for (const line of beforeLines) {
		const remainingCount = afterLineCounts.get(line) ?? 0;
		if (remainingCount === 0) {
			errors.push(`existing line was removed or modified: ${line}`);
			continue;
		}
		afterLineCounts.set(line, remainingCount - 1);
	}

	return { ok: errors.length === 0, errors };
}

function parseMarkdownBody(markdown: string): string {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(markdown);
	return match ? match[2] : markdown;
}

function normalizePreservedLine(line: string): string {
	return line.trim();
}

function countLines(lines: string[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const line of lines) {
		counts.set(line, (counts.get(line) ?? 0) + 1);
	}
	return counts;
}
