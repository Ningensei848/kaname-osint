/**
 * Shared fail-closed policy for GitHub MCP Writer file destinations.
 *
 * Keep this allowlist intentionally narrow. Generated index paths may be added
 * only after the feature plan explicitly lists their exact locations.
 */
const allowedWriterPathPatterns = [
	/^topics\/[^/]+\/[^/]+\.md$/,
	/^reports\/\d{4}-\d{2}-\d{2}_Report\.md$/,
] as const;

export function isAllowedMcpWriterPath(filePath: string): boolean {
	if (hasPathTraversal(filePath) || hasControlChars(filePath)) {
		return false;
	}

	return allowedWriterPathPatterns.some((pattern) => pattern.test(filePath));
}

function hasPathTraversal(filePath: string): boolean {
	return filePath
		.split("/")
		.some((segment) => segment === "." || segment === "..");
}

function hasControlChars(filePath: string): boolean {
	return [...filePath].some((char) => {
		const codePoint = char.codePointAt(0);
		return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
	});
}
