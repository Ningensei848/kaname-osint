export interface QuartzHtmlArtifact {
	path: string;
	html: string;
}

const forbiddenGraphPatterns = [
	/\bGraph View\b/i,
	/\bglobal-graph\b/i,
	/\blocal-graph\b/i,
	/\bgraph\.inline\.js\b/i,
	/data-component=["']Graph["']/i,
];

export function assertQuartzGraphDisabledArtifact(
	artifacts: QuartzHtmlArtifact[],
): string[] {
	const violations: string[] = [];
	for (const artifact of artifacts) {
		for (const pattern of forbiddenGraphPatterns) {
			if (pattern.test(artifact.html)) {
				violations.push(`${artifact.path} contains ${pattern}`);
			}
		}
	}
	return violations;
}
