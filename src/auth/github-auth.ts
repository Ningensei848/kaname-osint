import * as crypto from "node:crypto";

function base64UrlJson(value: unknown): string {
	return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function generateGitHubAppJwt(
	appId: string,
	privateKeyPem: string,
	nowSeconds = Math.floor(Date.now() / 1000),
): string {
	const header = { alg: "RS256", typ: "JWT" };
	const payload = {
		iss: appId,
		iat: nowSeconds,
		exp: nowSeconds + 600,
	};

	const encodedHeader = base64UrlJson(header);
	const encodedPayload = base64UrlJson(payload);
	const tokenData = `${encodedHeader}.${encodedPayload}`;

	try {
		const signer = crypto.createSign("SHA256");
		signer.update(tokenData);
		signer.end();
		const signature = signer.sign(privateKeyPem).toString("base64url");
		return `${tokenData}.${signature}`;
	} catch (error) {
		throw new Error(
			`Invalid GitHub App private key: ${(error as Error).message}`,
		);
	}
}

export interface GitHubInstallationTokenResponse {
	token: string;
	expiresAt: string;
	permissions: Record<string, string>;
	repositorySelection: string;
}

export interface GitHubInstallationTokenExchangeOptions {
	jwt: string;
	installationId: number;
	nowMs: number;
	githubApiBaseUrl?: string;
}

export interface GitHubInstallationTokenFetchResponse {
	ok: boolean;
	status: number;
	statusText: string;
	json: () => Promise<unknown>;
}

export type GitHubInstallationTokenFetch = (
	url: string,
	init: RequestInit,
) => Promise<GitHubInstallationTokenFetchResponse>;

export async function exchangeJwtForInstallationToken(
	fetchFn: GitHubInstallationTokenFetch,
	options: GitHubInstallationTokenExchangeOptions,
): Promise<GitHubInstallationTokenResponse> {
	const apiBaseUrl = options.githubApiBaseUrl ?? "https://api.github.com";
	const response = await fetchFn(
		`${apiBaseUrl}/app/installations/${options.installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${options.jwt}`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
		},
	);

	if (!response.ok) {
		throw new Error(
			`GitHub installation token exchange failed: ${response.status} ${response.statusText}`,
		);
	}

	const body = (await response.json()) as Record<string, unknown>;
	if (typeof body.token !== "string" || body.token.length === 0) {
		throw new Error("GitHub installation token response did not contain token");
	}
	if (typeof body.expires_at !== "string") {
		throw new Error(
			"GitHub installation token response did not contain expires_at",
		);
	}

	const expiresAtMs = Date.parse(body.expires_at);
	if (Number.isNaN(expiresAtMs) || expiresAtMs <= options.nowMs) {
		throw new Error(
			"GitHub installation token expires_at is not in the future",
		);
	}
	if (expiresAtMs - options.nowMs > 60 * 60 * 1000) {
		throw new Error("GitHub installation token expiry exceeds one hour");
	}

	return {
		token: body.token,
		expiresAt: body.expires_at,
		permissions: (body.permissions ?? {}) as Record<string, string>,
		repositorySelection: String(body.repository_selection ?? "unknown"),
	};
}
