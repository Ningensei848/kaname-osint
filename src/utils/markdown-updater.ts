function normalizeBullet(content: string): string {
	const trimmed = content.trim();
	if (trimmed === "") return "-";
	return /^[-*]\s+/.test(trimmed) ? trimmed : `- ${trimmed}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findHeadingLine(
	lines: string[],
	heading: string,
): { index: number; level: number } | null {
	const wanted = heading.trim();
	for (let index = 0; index < lines.length; index++) {
		const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index]);
		if (match && match[2].trim() === wanted) {
			return { index, level: match[1].length };
		}
	}
	return null;
}

function findSectionEnd(
	lines: string[],
	startIndex: number,
	level: number,
): number {
	for (let index = startIndex + 1; index < lines.length; index++) {
		const match = /^(#{1,6})\s+/.exec(lines[index]);
		if (match && match[1].length <= level) {
			return index;
		}
	}
	return lines.length;
}

export function appendSectionToMarkdown(
	markdown: string,
	heading: string,
	content: string,
): string {
	const bullet = normalizeBullet(content);
	const trimmedMarkdown = markdown.trimEnd();

	if (trimmedMarkdown.trim() === "") {
		return [`# ${heading.trim()}`, "", bullet].join("\n");
	}

	const lines = trimmedMarkdown.split(/\r?\n/);
	const existingHeading = findHeadingLine(lines, heading);

	if (!existingHeading) {
		const separator =
			lines.length > 0 && lines[lines.length - 1] !== "" ? ["", ""] : [""];
		return [...lines, ...separator, `### ${heading.trim()}`, bullet].join("\n");
	}

	const sectionEnd = findSectionEnd(
		lines,
		existingHeading.index,
		existingHeading.level,
	);
	const insertLines = [bullet];
	const beforeInsert = lines[sectionEnd - 1];
	if (sectionEnd > existingHeading.index + 1 && beforeInsert !== "") {
		insertLines.unshift("");
	}

	const updated = [
		...lines.slice(0, sectionEnd),
		...insertLines,
		...lines.slice(sectionEnd),
	];
	return updated.join("\n").trimEnd();
}

function alreadyLinksTarget(markdown: string, targetTitle: string): boolean {
	const target = escapeRegExp(targetTitle);
	return new RegExp(`\\[\\[${target}(?:\\|[^\\]]+)?\\]\\]`).test(markdown);
}

function isInsideWikiLink(markdown: string, index: number): boolean {
	const before = markdown.slice(0, index);
	const lastOpen = before.lastIndexOf("[[");
	const lastClose = before.lastIndexOf("]]");
	return lastOpen > lastClose;
}

function appendRelatedItem(markdown: string, targetTitle: string): string {
	return appendSectionToMarkdown(markdown, "関連項目", `[[${targetTitle}]]`);
}

export function injectInternalLinkToMarkdown(
	markdown: string,
	targetTitle: string,
	aliases: string[] = [],
): string {
	if (alreadyLinksTarget(markdown, targetTitle)) {
		return markdown;
	}

	const aliasCandidates = aliases
		.map((candidate) => candidate.trim())
		.filter((candidate) => candidate.length > 0)
		.sort((a, b) => b.length - a.length);
	const candidates = [...aliasCandidates, targetTitle.trim()].filter(
		(candidate) => candidate.length > 0,
	);

	let best: { candidate: string; index: number } | null = null;
	for (const candidate of candidates) {
		const pattern = new RegExp(escapeRegExp(candidate), "g");
		let match: RegExpExecArray | null = pattern.exec(markdown);
		while (match !== null) {
			if (!isInsideWikiLink(markdown, match.index)) {
				best = { candidate, index: match.index };
				break;
			}
			match = pattern.exec(markdown);
		}
		if (best) break;
	}

	if (!best) {
		return appendRelatedItem(markdown, targetTitle);
	}

	const link =
		best.candidate === targetTitle
			? `[[${targetTitle}]]`
			: `[[${targetTitle}|${best.candidate}]]`;
	return `${markdown.slice(0, best.index)}${link}${markdown.slice(best.index + best.candidate.length)}`;
}
