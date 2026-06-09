/**
 * tests/github-auth.test.ts
 *
 * Covers: spec.md §5.4 (Autonomous Integration), roadmap-tdd.md §3.2
 *
 * Key rules under test:
 * - generateGitHubAppJwt signs a valid JWT using RS256 algorithm.
 * - Payload includes correct GitHub App claims: 'iss' (App ID), 'iat' (issued at), 'exp' (expiry).
 * - Expiration window is strictly capped (typically 10 minutes/600 seconds as per GitHub API rules).
 * - Throws a clear error if the private key format is invalid.
 */

import { test } from "node:test";
import * as assert from "node:assert";
import * as crypto from "node:crypto";
import { generateGitHubAppJwt } from "../src/auth/github-auth";

test("GitHub App Authentication TDD Tests", async (t) => {
	// テスト用にメモリ内でRSA秘密鍵・公開鍵ペアを動的生成
	// これにより、ダミーの鍵ファイルを固定でコミットするセキュリティリスクを排除する
	const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
		modulusLength: 2048,
		publicKeyEncoding: {
			type: "spki",
			format: "pem",
		},
		privateKeyEncoding: {
			type: "pkcs8",
			format: "pem",
		},
	});

	await t.test(
		"正常系：正しいApp IDと秘密鍵からRS256署名済みJWTが生成されること",
		() => {
			const appId = "123456";
			const nowSeconds = Math.floor(Date.now() / 1000);

			// JWT生成関数の呼び出し
			const jwt = generateGitHubAppJwt(appId, privateKey, nowSeconds);

			assert.ok(jwt, "JWTトークン文字列が生成されていること");

			// JWTの構造検証 (header.payload.signature)
			const parts = jwt.split(".");
			assert.strictEqual(parts.length, 3, "JWTは3つの部分で構成されていること");

			// ヘッダーデコード検証
			const header = JSON.parse(
				Buffer.from(parts[0], "base64url").toString("utf8"),
			);
			assert.strictEqual(
				header.alg,
				"RS256",
				"署名アルゴリズムはRS256であること",
			);
			assert.strictEqual(header.typ, "JWT", "トークンタイプはJWTであること");

			// ペイロードデコード検証
			const payload = JSON.parse(
				Buffer.from(parts[1], "base64url").toString("utf8"),
			);
			assert.strictEqual(
				payload.iss,
				appId,
				"iss クレームにApp IDが正しく設定されていること",
			);
			assert.strictEqual(
				payload.iat,
				nowSeconds,
				"iat クレームに生成時刻（秒）が設定されていること",
			);

			// 有効期限の上限検証（GitHub App仕様で最大10分）
			const validityDuration = payload.exp - payload.iat;
			assert.ok(validityDuration > 0, "expはiatより未来であること");
			assert.ok(
				validityDuration <= 600,
				"JWTの有効期間はGitHubの制約に従い最大10分（600秒）であること",
			);
		},
	);

	await t.test(
		"検証：生成されたJWTが、対応する公開鍵を用いて暗号的に検証可能であること",
		() => {
			const appId = "987654";
			const jwt = generateGitHubAppJwt(appId, privateKey);

			const parts = jwt.split(".");
			const tokenData = `${parts[0]}.${parts[1]}`;
			const signature = Buffer.from(parts[2], "base64url");

			// 公開鍵によるRS256署名の署名検証
			const verify = crypto.createVerify("SHA256");
			verify.update(tokenData);
			const isValid = verify.verify(publicKey, signature);

			assert.strictEqual(
				isValid,
				true,
				"生成されたJWT署名が公開鍵で検証可能であること",
			);
		},
	);

	await t.test(
		"異常系：無効な形式の秘密鍵が渡された場合に、適切なエラーをスローすること",
		() => {
			const appId = "123456";
			const badKey = "---INVALID PRIVATE KEY---";

			assert.throws(
				() => {
					generateGitHubAppJwt(appId, badKey);
				},
				/invalid/i,
				"無効な秘密鍵を渡した場合はエラーがスローされること",
			);
		},
	);
});
