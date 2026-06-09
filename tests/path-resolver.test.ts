import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveTopicPath, sanitizeName } from "../src/crawler/path-resolver";

const tempDir = path.join(__dirname, "temp_resolver_MECE");

test("Path Resolver MECE Tests", async (t) => {
	if (fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
	fs.mkdirSync(tempDir, { recursive: true });

	await t.test(
		"正常系：安全なフォルダ解決とMarkdownパス決定ができること",
		() => {
			const resolved = resolveTopicPath(
				tempDir,
				"gov-agencies",
				"NCO",
				100,
				95,
			);
			const expected = path.join(tempDir, "topics", "gov-agencies", "NCO.md");
			assert.strictEqual(resolved, expected);
			assert.ok(fs.existsSync(path.dirname(resolved)));
		},
	);

	await t.test(
		"サニタイズ：パストラバーサルや危険文字の連続が安全に置換されること",
		() => {
			// '../' などのトラバーサル攻撃をサニタイズして、同一フラット階層に安全に抑制する
			const badFileName = "../../etc/passwd";
			const sanitized = sanitizeName(badFileName);
			assert.strictEqual(sanitized.includes(".."), false);
			assert.strictEqual(sanitized.includes("/"), false);
			assert.ok(sanitized.includes("_etc_passwd"));
		},
	);

	await t.test(
		"サニタイズ：Windowsの予約ファイル名が確実に防御・エスケープされること",
		() => {
			const reserved = "CON.md";
			const sanitized = sanitizeName(reserved);
			// CON_safe のように安全に退避されること
			assert.ok(sanitized.toLowerCase().includes("con_safe"));
		},
	);

	await t.test("サニタイズ：ヌルバイトや制御文字が完全に除去されること", () => {
		const dirty = "My\x00Topic\x1fTitle";
		const sanitized = sanitizeName(dirty);
		assert.strictEqual(sanitized, "MyTopicTitle");
	});

	await t.test(
		"サニタイズ：極端な空文字や不整合入力がデフォルト値にフォールバックすること",
		() => {
			assert.strictEqual(sanitizeName(""), "unnamed");
			assert.strictEqual(sanitizeName("..."), "unnamed");
		},
	);

	await t.test(
		"フォールバック制限：サブディレクトリ総数が94件の時に新規カテゴリにアサインされること",
		() => {
			const topicsDir = path.join(tempDir, "topics");
			fs.rmSync(topicsDir, { recursive: true, force: true });
			fs.mkdirSync(topicsDir, { recursive: true });

			// 94個のダミーフォルダを作成
			for (let i = 0; i < 94; i++) {
				fs.mkdirSync(path.join(topicsDir, `dummy_agency_${i}`), {
					recursive: true,
				});
			}

			// 閾値未満の新規カテゴリは、そのカテゴリのフォルダへアサイン
			const resolved = resolveTopicPath(
				tempDir,
				"brand-new-agency",
				"IntelligenceReport",
				100,
				95,
			);
			const expected = path.join(
				tempDir,
				"topics",
				"brand-new-agency",
				"IntelligenceReport.md",
			);
			assert.strictEqual(resolved, expected);
			assert.notStrictEqual(
				resolved,
				path.join(tempDir, "topics", "misc", "IntelligenceReport.md"),
			);
		},
	);

	await t.test(
		"フォールバック制限：サブディレクトリ総数が95件以上の時にmiscにアサインされること",
		() => {
			const topicsDir = path.join(tempDir, "topics");
			fs.rmSync(topicsDir, { recursive: true, force: true });
			fs.mkdirSync(topicsDir, { recursive: true });

			// 95個のダミーフォルダを作成
			for (let i = 0; i < 95; i++) {
				fs.mkdirSync(path.join(topicsDir, `dummy_agency_${i}`), {
					recursive: true,
				});
			}

			// 閾値オーバーの新規カテゴリは強制的に 'misc' フォルダへアサイン
			const resolved = resolveTopicPath(
				tempDir,
				"brand-new-agency",
				"IntelligenceReport",
				100,
				95,
			);
			const expected = path.join(
				tempDir,
				"topics",
				"misc",
				"IntelligenceReport.md",
			);
			assert.strictEqual(resolved, expected);

			// 新規の危険ディレクトリが自律作成されていないこと
			assert.strictEqual(
				fs.existsSync(path.join(topicsDir, "brand-new-agency")),
				false,
			);
		},
	);

	// クリーンアップ
	if (fs.existsSync(tempDir)) {
		fs.rmSync(tempDir, { recursive: true, force: true });
	}
});
