import { collectInternalLinks } from "./internalLinkGuard";
import type { GuardResult, VaultDocument } from "./types";

export type ReportNoveltyContext = string | string[] | VaultDocument[];

interface ReportNoveltyOptions {
	duplicateThreshold: number;
	createsNewRootTopic?: boolean;
	sentenceSimilarityThreshold?: number;
	nGramSize?: number;
}

const DEFAULT_SENTENCE_SIMILARITY_THRESHOLD = 0.82;
const DEFAULT_N_GRAM_SIZE = 3;

export function reportNoveltyGuard(
	reportMarkdown: string,
	existingContexts: ReportNoveltyContext,
	options: ReportNoveltyOptions,
): GuardResult {
	const errors: string[] = [];
	const duplicateRatio = calculateDuplicateRatio(
		reportMarkdown,
		existingContexts,
		{
			nGramSize: options.nGramSize ?? DEFAULT_N_GRAM_SIZE,
			sentenceSimilarityThreshold:
				options.sentenceSimilarityThreshold ??
				DEFAULT_SENTENCE_SIMILARITY_THRESHOLD,
		},
	);
	const reportItems = extractReportItems(reportMarkdown);
	const hasEvidence =
		reportItems.length > 0 && reportItems.every(hasItemLevelEvidence);
	const hasInternalLink = collectInternalLinks(reportMarkdown).length > 0;

	if (duplicateRatio > options.duplicateThreshold) {
		errors.push(
			`duplicate report threshold exceeded: ${duplicateRatio.toFixed(2)} > ${options.duplicateThreshold}`,
		);
	}
	if (!hasEvidence) errors.push("report item lacks source evidence");
	if (!options.createsNewRootTopic && !hasInternalLink) {
		errors.push("report item lacks required internal link");
	}

	return { ok: errors.length === 0, errors };
}

function calculateDuplicateRatio(
	candidate: string,
	references: ReportNoveltyContext,
	options: { sentenceSimilarityThreshold: number; nGramSize: number },
): number {
	const candidateSentences = normalizeJapaneseSentences(candidate);
	const referenceSentences = normalizeReferenceSentences(references);
	if (candidateSentences.length === 0) return 0;

	const duplicateCount = candidateSentences.filter((candidateSentence) =>
		referenceSentences.some(
			(referenceSentence) =>
				jaccardSimilarity(
					toCharacterNGrams(candidateSentence, options.nGramSize),
					toCharacterNGrams(referenceSentence, options.nGramSize),
				) >= options.sentenceSimilarityThreshold,
		),
	).length;
	return duplicateCount / candidateSentences.length;
}

function normalizeReferenceSentences(
	references: ReportNoveltyContext,
): string[] {
	return normalizeContextMarkdowns(references).flatMap((reference) =>
		normalizeJapaneseSentences(reference),
	);
}

function normalizeContextMarkdowns(contexts: ReportNoveltyContext): string[] {
	if (typeof contexts === "string") return [contexts];
	return contexts.map((context) =>
		typeof context === "string" ? context : context.markdown,
	);
}

function normalizeJapaneseSentences(markdown: string): string[] {
	return stripFrontmatter(markdown)
		.replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
		.split(/[。\n]/)
		.map((sentence) => sentence.replace(/^[-*#\s]+/, "").trim())
		.filter(
			(sentence) =>
				sentence.length >= 12 && !/^title:|^tags:|^source_ids:/.test(sentence),
		)
		.map(normalizeForSimilarity);
}

function extractReportItems(markdown: string): string[] {
	const body = stripFrontmatter(markdown);
	const bulletItems = body
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => /^[-*]\s+/.test(line))
		.map((line) => line.replace(/^[-*]\s+/, "").trim());
	if (bulletItems.length > 0) return bulletItems;

	return body
		.split(/\r?\n\s*\r?\n|\r?\n(?=##\s+)/)
		.map((section) => section.replace(/^#+\s+.*$/m, "").trim())
		.filter((section) => section.length > 0);
}

function hasItemLevelEvidence(item: string): boolean {
	return /https?:\/\//.test(item) || /根拠\s*[:：]/.test(item);
}

function stripFrontmatter(markdown: string): string {
	return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/m, "");
}

function normalizeForSimilarity(value: string): string {
	return value
		.replace(/https?:\/\/\S+/g, "")
		.replace(/根拠\s*[:：]/g, "")
		.replace(/[\s、，,.・:：/／-]+/g, "")
		.replace(/です|ます|でした|ました|である|だ/g, "")
		.trim();
}

function toCharacterNGrams(value: string, nGramSize: number): Set<string> {
	if (value.length <= nGramSize) return new Set([value]);
	const nGrams = new Set<string>();
	for (let index = 0; index <= value.length - nGramSize; index += 1) {
		nGrams.add(value.slice(index, index + nGramSize));
	}
	return nGrams;
}

function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
	if (left.size === 0 && right.size === 0) return 1;
	let intersection = 0;
	for (const value of left) {
		if (right.has(value)) intersection += 1;
	}
	return intersection / (left.size + right.size - intersection);
}
