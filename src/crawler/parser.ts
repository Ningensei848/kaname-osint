import * as fs from "node:fs";
import * as YAML from "yaml";
import type { SsotSource } from "../types";

interface ParsedSsotYaml {
	ssot_sources?: unknown;
}

interface SourceCandidate {
	id?: unknown;
	name?: unknown;
	url?: unknown;
	feed_url?: unknown;
	description?: unknown;
	meta_url?: unknown;
	custom_extraction_instruction?: unknown;
}

const ROOT_KEYS = new Set(["ssot_sources"]);
const SOURCE_KEYS = new Set([
	"id",
	"name",
	"url",
	"feed_url",
	"description",
	"meta_url",
	"custom_extraction_instruction",
]);

export function parseSsotYaml(filePath: string): SsotSource[] {
	if (!fs.existsSync(filePath)) {
		throw new Error(`SSoT configuration file not found at: ${filePath}`);
	}

	const fileContent = fs.readFileSync(filePath, "utf8");
	let parsed: ParsedSsotYaml;
	try {
		parsed = YAML.parse(fileContent) as ParsedSsotYaml;
	} catch (error) {
		throw new Error(
			`Failed to parse SSoT YAML file: ${(error as Error).message}`,
		);
	}

	validateRoot(parsed);

	const validatedSources: SsotSource[] = [];
	for (const [index, source] of parsed.ssot_sources.entries()) {
		try {
			validateSource(source);
		} catch (error) {
			console.warn(
				`[Degraded Mode] Skipping invalid SSoT source at index ${index}: ${(error as Error).message}`,
			);
			continue;
		}
		validatedSources.push(source);
	}

	if (validatedSources.length === 0) {
		throw new Error(
			"Invalid SSoT YAML structure: No valid sources found to process.",
		);
	}

	return validatedSources;
}

function validateRoot(
	root: unknown,
): asserts root is { ssot_sources: unknown[] } {
	if (!isPlainObject(root)) {
		throw new Error("Invalid SSoT YAML structure: root must be an object");
	}

	const unknownKeys = Object.keys(root).filter((key) => !ROOT_KEYS.has(key));
	if (unknownKeys.length > 0) {
		throw new Error(
			`Invalid SSoT YAML structure: unknown root key(s): ${unknownKeys.join(", ")}`,
		);
	}

	if (!Object.hasOwn(root, "ssot_sources")) {
		throw new Error("Invalid SSoT YAML structure: missing ssot_sources list");
	}
	if (!Array.isArray(root.ssot_sources)) {
		throw new Error("Invalid SSoT YAML structure: ssot_sources must be a list");
	}
	if (root.ssot_sources.length < 1) {
		throw new Error(
			"Invalid SSoT YAML structure: ssot_sources must contain at least one source",
		);
	}
}

function validateSource(source: unknown): asserts source is SsotSource {
	if (!isPlainObject(source)) {
		throw new Error("Source must be an object");
	}

	const unknownKeys = Object.keys(source).filter(
		(key) => !SOURCE_KEYS.has(key),
	);
	if (unknownKeys.length > 0) {
		throw new Error(`Unknown source key(s): ${unknownKeys.join(", ")}`);
	}

	const candidate = source as SourceCandidate;
	if (typeof candidate.id !== "string" || candidate.id.length < 1) {
		throw new Error("Missing or invalid required parameter: id");
	}
	if (!/^[a-z0-9_]+$/.test(candidate.id)) {
		throw new Error(`ID "${candidate.id}" does not match pattern ^[a-z0-9_]+$`);
	}
	if (typeof candidate.name !== "string" || candidate.name.length < 1) {
		throw new Error("Missing or invalid required parameter: name");
	}
	if (typeof candidate.url !== "string" || !isValidUri(candidate.url)) {
		throw new Error("Missing or invalid required parameter: url");
	}
	if (
		typeof candidate.description !== "string" ||
		candidate.description.length < 1
	) {
		throw new Error("Missing or invalid required parameter: description");
	}

	if (
		candidate.feed_url !== undefined &&
		(typeof candidate.feed_url !== "string" || !isValidUri(candidate.feed_url))
	) {
		throw new Error("Invalid optional parameter: feed_url");
	}
	if (
		candidate.meta_url !== undefined &&
		(typeof candidate.meta_url !== "string" || !isValidUri(candidate.meta_url))
	) {
		throw new Error("Invalid optional parameter: meta_url");
	}
	if (
		candidate.custom_extraction_instruction !== undefined &&
		typeof candidate.custom_extraction_instruction !== "string"
	) {
		throw new Error(
			"Invalid optional parameter: custom_extraction_instruction",
		);
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		(Object.getPrototypeOf(value) === Object.prototype ||
			Object.getPrototypeOf(value) === null)
	);
}

function isValidUri(val: string): boolean {
	try {
		new URL(val);
		return true;
	} catch {
		return false;
	}
}
