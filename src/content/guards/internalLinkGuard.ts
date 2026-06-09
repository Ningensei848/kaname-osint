import type { GuardResult, TopicAliasMap } from "./types";

export type LinkAliasSource =
	| Iterable<string>
	| TopicAliasMap
	| ReadonlyMap<string, unknown>;

export function internalLinkGuard(
	markdown: string,
	knownTitles: Set<string>,
	aliases?: LinkAliasSource,
): GuardResult {
	const errors: string[] = [];
	if (hasMalformedInternalLinkBrackets(markdown)) {
		errors.push("internal link is double-wrapped");
	}

	const resolvableTargets = new Set(knownTitles);
	for (const alias of collectAliases(aliases)) {
		resolvableTargets.add(alias);
	}

	for (const link of collectInternalLinks(markdown)) {
		if (!resolvableTargets.has(link)) {
			errors.push(`broken internal link: ${link}`);
		}
	}

	return { ok: errors.length === 0, errors };
}

export function collectInternalLinks(markdown: string): string[] {
	return [...markdown.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)].map(
		(match) => match[1].trim(),
	);
}

function hasMalformedInternalLinkBrackets(markdown: string): boolean {
	return /\[{3,}|\]{3,}|\[\[\s*\[\[|\]\]\s*\]\]/.test(markdown);
}

function collectAliases(aliases?: LinkAliasSource): string[] {
	if (!aliases) return [];
	if (aliases instanceof Map)
		return [...aliases.keys()].map((alias) => alias.trim());
	if (isTopicAliasMap(aliases))
		return Object.keys(aliases).map((alias) => alias.trim());
	return [...(aliases as Iterable<string>)].map((alias) => alias.trim());
}

function isTopicAliasMap(value: LinkAliasSource): value is TopicAliasMap {
	return !(Symbol.iterator in value) && !(value instanceof Map);
}
