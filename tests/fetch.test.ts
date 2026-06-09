import { test } from "node:test";
import * as assert from "node:assert";
import * as http from "node:http";
import { fetchWithRetry, cleanHtml, parseRssFeed } from "../src/crawler/fetch";

test("Fetch Client and Parser MECE Tests", async (t) => {
	// 疑似HTTPサーバーの起動
	let requestCount = 0;
	const server = http.createServer((req, res) => {
		requestCount++;
		if (req.url === "/304") {
			res.writeHead(304, { "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT" });
			res.end();
		} else if (req.url === "/500") {
			res.writeHead(500);
			res.end("Server Error");
		} else if (req.url === "/html") {
			res.writeHead(200, {
				"Content-Type": "text/html",
				"Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT",
			});
			res.end(
				"<html><head><title>Test</title></head><body><main>Hello World &amp; welcome</main></body></html>",
			);
		} else if (req.url === "/rss") {
			res.writeHead(200, { "Content-Type": "application/rss+xml" });
			res.end(`
        <rss version="2.0">
          <channel>
            <item>
              <title><![CDATA[Test Title]]></title>
              <description><![CDATA[Test Description]]></description>
              <pubDate>Wed, 21 Oct 2015 07:28:00 GMT</pubDate>
              <link>https://example.com/item</link>
            </item>
          </channel>
        </rss>
      `);
		} else {
			res.writeHead(200);
			res.end("OK");
		}
	});

	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => {
			resolve();
		});
	});

	const address = server.address();
	assert.ok(address && typeof address === "object");
	const baseUrl = `http://127.0.0.1:${address.port}`;

	await t.test(
		"正常系：コンテンツとLast-Modifiedヘッダーが正しく読み込めること",
		async () => {
			const result = await fetchWithRetry(`${baseUrl}/html`);
			assert.ok(result.content.includes("Hello World"));
			assert.strictEqual(
				result.lastModifiedHeader,
				"Wed, 21 Oct 2015 07:28:00 GMT",
			);
		},
	);

	await t.test(
		"べき等性：304 Not Modified 時に空文字列が返りヘッダーが維持されること",
		async () => {
			const result = await fetchWithRetry(
				`${baseUrl}/304`,
				3,
				10,
				"Wed, 21 Oct 2015 07:28:00 GMT",
			);
			assert.strictEqual(result.content, "");
			assert.strictEqual(
				result.lastModifiedHeader,
				"Wed, 21 Oct 2015 07:28:00 GMT",
			);
		},
	);

	await t.test(
		"回復性：エラー時に規定の3回リトライアウトして適切に終了すること",
		async () => {
			requestCount = 0;
			await assert.rejects(async () => {
				await fetchWithRetry(`${baseUrl}/500`, 3, 10);
			}, /Failed to fetch/);
			assert.strictEqual(requestCount, 3);
		},
	);

	await t.test(
		'クレンジング：属性内に ">" が存在する難解なタグも破綻せずサニタイズできること',
		() => {
			const badHtml = '<div><input value="a > b" type="text">安全な本文</div>';
			const cleaned = cleanHtml(badHtml);
			assert.strictEqual(cleaned, "安全な本文");
		},
	);

	await t.test(
		"クレンジング：大文字小文字が混在する悪質なscriptやstyleが除去されること",
		() => {
			const badHtml = "<ScRiPt>alert(1)</sCrIpT><STYLE>body{}</style>本文";
			const cleaned = cleanHtml(badHtml);
			assert.strictEqual(cleaned, "本文");
		},
	);

	await t.test(
		"RSSパース：Namespaceが存在するフィード（dc:date, content:encoded等）もパースできること",
		() => {
			const xml = `
      <rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
        <item>
          <title>高度アラート</title>
          <content:encoded><![CDATA[<h2>詳細データ</h2>]]></content:encoded>
          <dc:date>2026-05-27</dc:date>
          <link>https://example.com</link>
        </item>
      </rss>
    `;
			const parsed = parseRssFeed(xml);
			assert.ok(parsed.includes("Title: 高度アラート"));
			assert.ok(parsed.includes("Date: 2026-05-27"));
			assert.ok(parsed.includes("Description: 詳細データ"));
		},
	);

	// サーバーのクローズ
	await new Promise<void>((resolve) => {
		server.close(() => {
			resolve();
		});
	});
});
