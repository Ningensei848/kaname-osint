/**
 * tests/markdown-updater.test.ts
 *
 * Covers: spec.md §5.2 (Incremental Update), §5.3 (Orphan Note), business-rules.md §3
 *
 * Key rules under test:
 * - appendSectionToMarkdown preserves existing structures and inserts facts into correct headings.
 * - appendSectionToMarkdown appends a new section to the end of the file if heading does not exist.
 * - injectInternalLinkToMarkdown turns the first occurrence of title/alias into [[title|matched]].
 * - injectInternalLinkToMarkdown does not double-link if already linked.
 * - injectInternalLinkToMarkdown appends to "## 関連項目" if no in-text match is found.
 */

import { test } from "node:test";
import * as assert from "node:assert";
import {
	appendSectionToMarkdown,
	injectInternalLinkToMarkdown,
} from "../src/utils/markdown-updater";

test("appendSectionToMarkdown", async (t) => {
	await t.test(
		"appends a new section at the end if the heading does not exist",
		() => {
			const original = [
				"---",
				'title: "JPCERT/CC"',
				"---",
				"# JPCERT/CC",
				"",
				"## 概要",
				"JPCERT/CC is a CSIRT in Japan.",
			].join("\n");

			const heading = "2026年5月の動向";
			const content = "新たな注意喚起スキームを公表。";

			const result = appendSectionToMarkdown(original, heading, content);

			assert.ok(result.includes("## 概要"));
			assert.ok(result.includes("### 2026年5月の動向"));
			assert.ok(result.includes("- 新たな注意喚起スキームを公表。"));
			// 末尾にアペンドされていることを検証
			assert.ok(result.endsWith("- 新たな注意喚起スキームを公表。"));
		},
	);

	await t.test(
		"appends content inside the existing heading without breaking following headings",
		() => {
			const original = [
				"# JPCERT/CC",
				"",
				"## 概要",
				"JPCERT/CC is a CSIRT in Japan.",
				"",
				"### 2026年5月の動向",
				"- 2026-05-10: 概要発表。",
				"",
				"## 組織の役割",
				"- インシデントの分析と調整。",
			].join("\n");

			const heading = "2026年5月の動向";
			const content = "2026-05-27: 新たな注意喚起スキームを公表。";

			const result = appendSectionToMarkdown(original, heading, content);

			assert.ok(result.includes("- 2026-05-10: 概要発表。"));
			assert.ok(
				result.includes("- 2026-05-27: 新たな注意喚起スキームを公表。"),
			);
			assert.ok(result.includes("## 組織の役割"));

			// 新しい事実が、次の同等以上のレベルの見出し「## 組織の役割」の前に差し込まれていることを検証
			const nextHeadingPos = result.indexOf("## 組織の役割");
			const newContentPos = result.indexOf(
				"- 2026-05-27: 新たな注意喚起スキームを公表。",
			);
			assert.ok(
				newContentPos < nextHeadingPos,
				"New content should be inserted before the next heading",
			);
		},
	);

	await t.test(
		"appends content at the end of the section if it is the last section in the file",
		() => {
			const original = [
				"# JPCERT/CC",
				"",
				"## 概要",
				"JPCERT/CC is a CSIRT in Japan.",
				"",
				"### 2026年5月の動向",
				"- 2026-05-10: 概要発表。",
			].join("\n");

			const heading = "2026年5月の動向";
			const content = "2026-05-27: 新たな注意喚起スキームを公表。";

			const result = appendSectionToMarkdown(original, heading, content);

			assert.ok(result.includes("- 2026-05-10: 概要発表。"));
			assert.ok(
				result.includes("- 2026-05-27: 新たな注意喚起スキームを公表。"),
			);
			assert.ok(
				result.endsWith("- 2026-05-27: 新たな注意喚起スキームを公表。"),
			);
		},
	);

	await t.test(
		"handles empty or whitespace-only original markdown gracefully",
		() => {
			const result = appendSectionToMarkdown("", "概要", "コンテンツ");
			assert.ok(result.includes("# 概要"));
			assert.ok(result.includes("- コンテンツ"));
		},
	);
});

test("injectInternalLinkToMarkdown", async (t) => {
	await t.test(
		"injects a link for the first occurrence of matched title/aliases",
		() => {
			const original =
				"JPCERT/CCは日本のCSIRTです。JPCERT/CCの活動は重要です。";
			const title = "JPCERT_CC";
			const aliases = ["JPCERT/CC", "ジェーピーサート"];

			const result = injectInternalLinkToMarkdown(original, title, aliases);

			// 最初に出現した JPCERT/CC のみがリンク化されていることを検証
			assert.ok(result.includes("[[JPCERT_CC|JPCERT/CC]]は日本のCSIRTです。"));
			// 2回目に出現した JPCERT/CC は多重リンクを避けるため置換されないことを検証
			assert.ok(result.includes("です。JPCERT/CCの活動は重要です。"));
		},
	);

	await t.test("ignores replacement if target title is already linked", () => {
		const original =
			"JPCERT/CCの詳細は [[JPCERT_CC]] または [[JPCERT_CC|ジェーピーサート]] を参照。";
		const title = "JPCERT_CC";
		const aliases = ["JPCERT/CC", "ジェーピーサート"];

		const result = injectInternalLinkToMarkdown(original, title, aliases);

		// 既にリンク化されている構造を破壊・多重化しないことを検証
		assert.strictEqual(result, original);
	});

	await t.test(
		"appends link to 関連項目 at the end if no in-text matches are found",
		() => {
			const original = [
				"# サイバーセキュリティ基本法",
				"我が国の基本方針を定めます。",
			].join("\n");

			const title = "能動的サイバー防御";
			const aliases = ["NCO", "アクティブディフェンス"];

			const result = injectInternalLinkToMarkdown(original, title, aliases);

			assert.ok(result.includes("## 関連項目"));
			assert.ok(result.includes("- [[能動的サイバー防御]]"));
			assert.ok(result.endsWith("- [[能動的サイバー防御]]"));
		},
	);

	await t.test(
		"appends link to an existing 関連項目 section if it already exists but the link is absent",
		() => {
			const original = [
				"# サイバーセキュリティ基本法",
				"我が国の基本方針を定めます。",
				"",
				"## 関連項目",
				"- [[NICT]]",
			].join("\n");

			const title = "能動的サイバー防御";
			const aliases = ["NCO"];

			const result = injectInternalLinkToMarkdown(original, title, aliases);

			assert.ok(result.includes("- [[NICT]]"));
			assert.ok(result.includes("- [[能動的サイバー防御]]"));
		},
	);
});
