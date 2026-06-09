# `kaname` アルゴリズム・設定詳細 (implementation-details/agent-logic.md)

## 1. Aegis-Orchestrator 制御アルゴリズム（TypeScript）

バッチ起動時に Cloud Run Jobs 内で実行され、Fetch、正規表現パース、および2つのエージェント間対話ループをプログラム的に仲介する中核ロジックの**擬似コード**。

```ts
import { spawn } from "child_process";
import { runAegisWriter, runAegisReviewer } from "./agents";
import { fetchAndExtractDiff } from "./crawler";

interface ExecutionState {
	prNumber: number | null;
	loopCount: number;
	maxLoops: number;
	status: "PENDING" | "PROPOSED" | "APPROVED" | "REJECTED" | "ERROR";
}

export async function main() {
	console.log("--- Aegis Orchestrator Started ---");

	// 1. クローラーによる前回の状態取得、ビルトインFetchおよび正規表現置換による機械的テキスト抽出
	const diffData = await fetchAndExtractDiff();
	if (diffData.length === 0) {
		console.log(
			"No new updates detected in SSoT. Execution stopped (Idempotent).",
		);
		process.exit(0);
	}

	// 2. インプロセスでのGitHub MCP子プロセスの起動 (Stdio接続)
	const mcpProcess = spawn(
		"node",
		["node_modules/@modelcontextprotocol/server-github/dist/index.js"],
		{
			env: {
				...process.env,
				GITHUB_PERSONAL_ACCESS_TOKEN: await getGitHubAppToken(),
			},
		},
	);

	const state: ExecutionState = {
		prNumber: null,
		loopCount: 0,
		maxLoops: 3,
		status: "PENDING",
	};

	// 3. マルチエージェント対話ループの制御
	while (state.loopCount < state.maxLoops && state.status !== "APPROVED") {
		state.loopCount++;
		console.log(
			`\n--- Starting Agent Loop: ${state.loopCount}/${state.maxLoops} ---`,
		);

		if (state.status === "PENDING" || state.status === "REJECTED") {
			// 提案エージェント (Aegis-Writer) の実行。
			// 新規トピック作成、既存インクリメンタルアップデート、孤立リンク補正、レポートMarkdownを自動コミットしてPR起票。
			state.prNumber = await runAegisWriter(
				mcpProcess,
				diffData,
				state.prNumber,
			);
			state.status = "PROPOSED";
		}

		if (state.status === "PROPOSED") {
			// 査読エージェント (Aegis-Reviewer) の実行。
			// 起票されたPRのDiffとGitHub Actionsの検証結果を評価。
			const reviewResult = await runAegisReviewer(mcpProcess, state.prNumber!);

			if (reviewResult.isApproved) {
				state.status = "APPROVED";
				console.log(
					`PR #${state.prNumber} successfully APPROVED and Self-Merged by Aegis-Reviewer.`,
				);
			} else {
				state.status = "REJECTED";
				console.log(
					`PR #${state.prNumber} REJECTED with comments: ${reviewResult.feedback}`,
				);
			}
		}
	}

	// 4. 最大ループ回数に達しても合意形成されなかった場合は、自律的に管理者に差し戻し
	if (state.status !== "APPROVED") {
		console.error(
			"Cooperative agent loop exceeded max limit without reaching consensus.",
		);
		await raiseFailureIssue(mcpProcess, state.prNumber);
		process.exit(1);
	}

	// 5. 子プロセスのクリーンアップと終了
	mcpProcess.kill("SIGTERM");
	console.log("--- Aegis Orchestrator Finished Successfully ---");
}
```


## 2. 孤立ノート自動リンク解決アルゴリズム (Aegis-Writer側)

提案エージェント（Aegis-Writer）が、ナレッジの孤立（相互リンクがゼロの状態）を自律的に検知し、リンク網を補正するステップの内部論理アルゴリズム。

```ts
interface TopicIndex {
	fileName: string;
	title: string;
	aliases: string[];
	inboundLinks: number;
}

export async function resolveOrphanNotes(
	mcp: any,
	newlyCreatedFile: string,
	newlyCreatedTitle: string,
) {
	// 1. Vault内の全トピックファイルおよびインデックス（ファイル名、エイリアス、被リンク数）を走査
	const allTopics: TopicIndex[] = await fetchVaultTopicIndexes(mcp);

	// 2. 被リンク数がゼロ（inboundLinks === 0）の孤立ノート（Orphan Note）を特定
	const orphanNotes = allTopics.filter(
		(t) => t.inboundLinks === 0 && t.fileName !== newlyCreatedFile,
	);
	if (orphanNotes.length === 0) return;

	// 3. 提案エージェントは、新しく追加・更新されたファイル（newlyCreatedTitle）と孤立ノートの意味的関連性を推論
	for (const orphan of orphanNotes) {
		const isRelated = await evaluateSemanticRelationship(
			newlyCreatedTitle,
			orphan.title,
			orphan.aliases,
		);

		if (isRelated) {
			// 4. 関連性が極めて高いと判断された場合、新しく作成されたファイルに
			// 孤立トピックへの内部リンク [[孤立ノートタイトル]] を自然な文脈で動的に追記
			console.log(
				`Connecting orphan note [[${orphan.title}]] from newly created [[${newlyCreatedTitle}]]`,
			);
			await injectInternalLink(mcp, newlyCreatedFile, orphan.title);
		}
	}
}
```


## 3. インクリメンタル・アップデート（上書き禁止）プロンプト境界条件

`Aegis-Writer` が、既存Wikiファイルを壊さずに最新の差分情報のみをセクション追加・改訂する際に使用する、厳格なシステム命令プロンプト構造。

```markdown
<system_instructions>
# Aegis-Writer インクリメンタルアップデートシステム命令

## 1. 役割と責務（Role & Responsibilities）

あなたは、Obsidian Vault内に存在する既存の Wiki Topic（`{{TOPIC_NAME}}`）に対して、新規に検知された差分ファクトを正確にインクリメンタル追記（追加統合）する、専門のドキュメント更新エンジニア「`Aegis-Writer`」です。

## 2. 厳守ルールとガードレール（MODE_GUARD）

- **既存記述の破壊・全上書きの絶対禁止**: すでにファイル内に記述されている歴史、役割、概念定義、過去のインシデント履歴などのテキストは、一文字たりとも削除、改変、または無効化してはならない。
- **限定的追記の徹底**: 今回新しく検知された追加ファクト（`{{NEW_CRAWLED_DIFFERENCE}}`）以外の、既存ドキュメントに含まれない情報を勝手に捏造（ハルシネーション）して追加してはならない。

## 3. 実行ステップとプロセス（MODE_ACTION）

1. **既存データの解析**: `target_prompt` から提供される既存のMarkdownコンテンツ（{{EXISTING_MARKDOWN_CONTENT}}）および記述されている `[[内部リンク]]` の位置を正確に把握する。
2. **追記・統合プロセスの実行**: 追加ファクト（{{NEW_CRAWLED_DIFFERENCE}}）のみを、適切な新しい章見出し（例：`### {{HEADING}}` 等）を新規に切って挿入するか、あるいは既存の最新動向セクション（例：`## 最近の動向`）の末尾に追記・統合して改訂する。
3. **リンクの温存と自動拡張**: 既存の `[[内部リンク]]` 記法をすべて100%完全に維持したまま、新規に追記した記述に対しても、関連性がある既存トピックへの `[[内部リンク]]` を適応的に生成・埋め込む。
4. **出力処理**: 更新が完了した全体のMarkdownドキュメントのみを出力する。

## 4. 出力フォーマット契約（MODE_GUARD）
- 余計な解説、前置き、挨拶、後書きなどは一切出力してはならない。
- Markdownファイルとしての有効なソースコードのみを、生のプレーンテキストとして出力しなければならない。
</system_instructions>

<query_trigger>
`system_instructions` のルールとプロセスに完全準拠し、`target_prompt` 内の既存Markdownコンテンツに対して新しい追加事実をインクリメンタル追記・更新した最終Markdownドキュメントを出力してください。
</query_trigger>

<target_prompt>
TOPIC_NAME: "{{TOPIC_NAME}}"
EXISTING_MARKDOWN_CONTENT: """
{{EXISTING_MARKDOWN_CONTENT}}
"""
NEW_CRAWLED_DIFFERENCE: """
{{NEW_CRAWLED_DIFFERENCE}}
"""
</target_prompt>
```