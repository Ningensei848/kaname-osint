import type { SsotSource } from "../types";

export interface FetchResult {
	content: string;
	lastModifiedHeader: string | null;
}

export type Fetcher = (
	input: string | URL | Request,
	init?: RequestInit,
) => Promise<Response>;

export interface CrawlSourceOptions {
	fetcher?: Fetcher;
	retries?: number;
	delayMs?: number;
}

export async function fetchWithRetry(
	url: string,
	retries = 3,
	delayMs = 1000,
	lastModifiedHeader: string | null = null,
	fetcher: Fetcher = fetch,
): Promise<FetchResult> {
	let attempt = 0;
	while (attempt < retries) {
		try {
			const headers: HeadersInit = {};
			if (lastModifiedHeader) {
				headers["If-Modified-Since"] = lastModifiedHeader;
			}

			// Add a simple timeout helper
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

			const response = await fetcher(url, {
				headers,
				signal: controller.signal,
			});

			clearTimeout(timeoutId);

			if (response.status === 304) {
				// Not modified (idempotency support)
				return {
					content: "",
					lastModifiedHeader:
						response.headers.get("last-modified") || lastModifiedHeader,
				};
			}

			if (!response.ok) {
				throw new Error(
					`HTTP Error: ${response.status} ${response.statusText}`,
				);
			}

			const text = await response.text();
			const newLastModified = response.headers.get("last-modified");

			return {
				content: text,
				lastModifiedHeader: newLastModified || lastModifiedHeader,
			};
		} catch (error) {
			attempt++;
			if (attempt >= retries) {
				throw new Error(
					`Failed to fetch ${url} after ${retries} attempts: ${(error as Error).message}`,
				);
			}
			const backoffDelay = delayMs * 2 ** (attempt - 1);
			console.warn(
				`Fetch attempt ${attempt} failed for ${url}. Retrying in ${backoffDelay}ms... Error: ${(error as Error).message}`,
			);
			await new Promise((resolve) => setTimeout(resolve, backoffDelay));
		}
	}
	throw new Error(`Unreachable state in fetchWithRetry for URL: ${url}`);
}

export function cleanHtml(html: string): string {
	let text = html;

	// 1. Remove the entire <head> block (title, meta, link tags, etc.)
	text = text.replace(/<head[\s\S]*?>[\s\S]*?<\/head>/gi, "");

	// 2. Remove comments
	text = text.replace(/<!--[\s\S]*?-->/g, "");

	// 3. Remove script and style tags and their contents
	text = text.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
	text = text.replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "");

	// 4. Remove non-content structural tags and contents (header, footer, nav, aside, ads)
	text = text.replace(
		/<(header|footer|nav|aside|noscript)[\s\S]*?>[\s\S]*?<\/\1>/gi,
		"",
	);

	// 4. Remove all remaining HTML tags. The pattern tolerates quoted '>' characters in attributes.
	text = text.replace(/<[^>"']*(?:"[^"]*"|'[^']*'|[^>"']*)*>/g, " ");

	// 5. Decode basic HTML entities
	text = text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, " ");

	// 6. Normalize whitespaces (remove multiple spaces and lines)
	text = text.replace(/[\r\n]+/g, "\n");
	text = text.replace(/[ \t]+/g, " ");
	text = text.trim();

	return text;
}

export function parseRssFeed(xml: string): string {
	const items: string[] = [];
	const itemRegex = /<(item|entry)>([\s\S]*?)<\/\1>/gi;
	let match: RegExpExecArray | null = itemRegex.exec(xml);

	while (match !== null) {
		const itemContent = match[2];
		const title = extractTagContent(itemContent, "title");
		const description =
			extractTagContent(itemContent, "description") ||
			extractTagContent(itemContent, "summary") ||
			cleanHtml(extractTagContent(itemContent, "content:encoded"));
		const pubDate =
			extractTagContent(itemContent, "pubDate") ||
			extractTagContent(itemContent, "updated") ||
			extractTagContent(itemContent, "dc:date");
		const link = extractTagContent(itemContent, "link");

		let cleanedItem = "";
		if (title) cleanedItem += `Title: ${title}\n`;
		if (pubDate) cleanedItem += `Date: ${pubDate}\n`;
		if (link) cleanedItem += `Link: ${link}\n`;
		if (description) cleanedItem += `Description: ${description}\n`;

		if (cleanedItem) {
			items.push(cleanedItem.trim());
		}

		match = itemRegex.exec(xml);
	}

	return items.join("\n\n---\n\n");
}

function extractTagContent(xml: string, tag: string): string {
	// Matches tag content, supporting attributes (e.g. <link href="..."/> or <link>...</link>)
	// Handle standard <tag>...</tag> structure first
	const normalRegex = new RegExp(
		`<${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,
		"i",
	);
	const normalMatch = normalRegex.exec(xml);
	if (normalMatch) {
		return cleanCdata(normalMatch[1].trim());
	}

	// Handle self-closing link tags with href attributes (common in Atom feeds)
	if (tag === "link") {
		const hrefRegex = /<link\s+[^>]*href=["']([^"']+)["'][^>]*\/?>/i;
		const hrefMatch = hrefRegex.exec(xml);
		if (hrefMatch) {
			return hrefMatch[1].trim();
		}
	}

	return "";
}

function cleanCdata(text: string): string {
	const cdataRegex = /<!\[CDATA\[([\s\S]*?)\]\]>/i;
	const match = cdataRegex.exec(text);
	if (match) {
		return match[1].trim();
	}
	return text;
}

export async function crawlSource(
	source: SsotSource,
	lastModifiedHeader: string | null = null,
	options: CrawlSourceOptions = {},
): Promise<{
	content: string;
	lastModifiedHeader: string | null;
	isNotModified: boolean;
}> {
	// If feed_url is provided, crawl the feed. Otherwise crawl the main url.
	const crawlUrl = source.feed_url || source.url;
	const isFeed = !!source.feed_url;

	const result = await fetchWithRetry(
		crawlUrl,
		options.retries ?? 3,
		options.delayMs ?? 1000,
		lastModifiedHeader,
		options.fetcher,
	);

	if (result.content === "") {
		// 304 Not Modified
		return {
			content: "",
			lastModifiedHeader: result.lastModifiedHeader,
			isNotModified: true,
		};
	}

	let cleanedContent = "";
	if (isFeed) {
		cleanedContent = parseRssFeed(result.content);
	} else {
		cleanedContent = cleanHtml(result.content);
	}

	return {
		content: cleanedContent,
		lastModifiedHeader: result.lastModifiedHeader,
		isNotModified: false,
	};
}
