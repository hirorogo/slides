#!/usr/bin/env node
/**
 * SSG のプリレンダ工程。アプリのディレクトリで実行する。
 *
 * `vp build`（クライアント）と `vp build --ssr`（サーバ）の後に走り、
 * entry-server が公開している routes を全部 HTML にして dist へ書き出す。
 * <head> も同時に差し込むので、各ページが単体で正しい meta / OGP / JSON-LD を持つ。
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { renderHead } from "@tanahiro2010/ssg/head";

const root = process.cwd();
const clientDir = path.join(root, "dist");
const serverDir = path.join(root, ".vite-ssg");

const site = JSON.parse(await readFile(path.join(root, "site.config.json"), "utf8"));
const template = await readFile(path.join(clientDir, "index.html"), "utf8");
const { render, routes } = await import(
  pathToFileURL(path.join(serverDir, "entry-server.js")).href
);

for (const route of routes) {
  const { html, title } = render(route.path);
  const head = renderHead({
    site,
    title,
    description: route.description,
    pathname: route.path,
    jsonLd: route.jsonLd,
  });

  const page = template.replace("<!--app-head-->", head).replace("<!--app-html-->", html);

  const outFile = path.join(clientDir, route.path.replace(/^\//, ""), "index.html");
  await mkdir(path.dirname(outFile), { recursive: true });
  await writeFile(outFile, page);
}

// Cloudflare Pages は 404.html が無いと、未知のパスに index.html を 200 で返す。
// 消したページや打ち間違いがソフト404になり、検索側に「中身のある別ページ」として
// 扱われてしまうので、本物の 404 を置く。
const notFound = template
  .replace(
    "<!--app-head-->",
    renderHead({
      site,
      title: `404 — ページが見つかりません | ${site.title}`,
      description: "お探しのページは見つかりませんでした。",
      pathname: "/404.html",
      noindex: true,
    }),
  )
  .replace(
    "<!--app-html-->",
    `<main>
<h1>404</h1>
<p>お探しのページは見つかりませんでした。</p>
<ul>
<li><a href="/">トップへ戻る</a></li>
</ul>
</main>`,
  );
await writeFile(path.join(clientDir, "404.html"), notFound);

console.log(`prerendered ${routes.length} route(s) + 404.html -> dist/`);

await rm(serverDir, { recursive: true, force: true });
