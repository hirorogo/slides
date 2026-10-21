import { DurableObject } from "cloudflare:workers";
import { Workspace as ShellWorkspace } from "@cloudflare/shell";
import { Workspace } from "@cloudflare/computer";
import { Recorder, sha256, enc } from "./evidence";
import { FIXTURES, SIZE_CASES, makeBytes } from "./fixtures";
import { copyShellWorkspace, copyShellWorkspaceFixed, resolveTargetFixed } from "./migrate";
import { walkComputer, walkShell, readAllBytes, type Entry } from "./walk";

export interface Env {
  LAB: DurableObjectNamespace<WorkspaceLab>;
  R2: R2Bucket;
}

/**
 * 旧 Workspace（@cloudflare/shell）と新 Workspace（@cloudflare/computer）を
 * **同じ Durable Object storage** の上に同居させる検証台。
 *
 * 別の DO namespace に分けると「同じストレージを使った移行」にならないので、
 * 1 クラスの中でどちらを使うかをリクエストで切り替える。
 * これは「デプロイを旧実装から新実装に差し替えた」状況と同じ状態を作る。
 *
 * Think 0.20.2 は Shell を `new Workspace({ sql: this.ctx.storage.sql, name: () => this.name })`
 * で構築していた（direct dependency）。ここでも同じ形で作る。
 */
export class WorkspaceLab extends DurableObject<Env> {
  /** コンストラクタで 1 回だけ生成する。値が変わった = 新しい incarnation（C03 の生命線） */
  readonly bootId: string = crypto.randomUUID();
  readonly bornAt: number = Date.now();

  get doName(): string {
    return this.ctx.id.name ?? "(unnamed)";
  }

  private shell(opts: { r2?: R2Bucket; namespace?: string } = {}): ShellWorkspace {
    return new ShellWorkspace({
      sql: this.ctx.storage.sql,
      name: () => this.ctx.id.name ?? undefined,
      ...opts,
    });
  }

  private computer(): Workspace {
    return new Workspace({ storage: this.ctx.storage });
  }

  private tables(): string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .toArray()
      .map((r) => r.name);
  }

  private count(table: string): number | string {
    try {
      return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM "${table}"`).one().n;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    }
  }

  /** Shell 側に FIXTURES を書く */
  private async seedShell(rec: Recorder, ws: ShellWorkspace, claim: string) {
    for (const f of FIXTURES) {
      if (f.kind === "dir") {
        await rec.step(claim, `seed ${f.path}`, "shell.mkdir", { path: f.path }, () =>
          ws.mkdir(f.path, { recursive: true })
        );
      } else if (f.kind === "file") {
        await rec.step(claim, `seed ${f.path}`, "shell.writeFile", { path: f.path, bytes: enc.encode(f.text).length }, () =>
          ws.writeFile(f.path, f.text, f.mime)
        );
      } else if (f.kind === "bytes") {
        const bytes = makeBytes(f.size, f.seed);
        await rec.step(claim, `seed ${f.path}`, "shell.writeFileBytes", { path: f.path, size: f.size, sha256: await sha256(bytes) }, () =>
          ws.writeFileBytes(f.path, bytes)
        );
      } else {
        await rec.step(claim, `seed ${f.path}`, "shell.symlink", { path: f.path, target: f.target, note: f.note }, () =>
          ws.symlink(f.target, f.path)
        );
      }
    }
  }

  async run(scenario: string, params: Record<string, string>): Promise<unknown> {
    const rec = new Recorder();
    const started = Date.now();
    rec.note("meta", "incarnation", {
      bootId: this.bootId,
      aliveMs: started - this.bornAt,
      doName: this.doName,
      scenario,
    });

    const fn = (this.scenarios as Record<string, undefined | ((r: Recorder, p: Record<string, string>) => Promise<void>)>)[scenario];
    if (!fn) return { error: `unknown scenario: ${scenario}`, known: Object.keys(this.scenarios) };
    await fn.call(this, rec, params);

    return {
      scenario,
      bootId: this.bootId,
      aliveMs: Date.now() - this.bornAt,
      doName: this.doName,
      tables: this.tables(),
      records: rec.records,
      wallMs: Date.now() - started,
    };
  }

  // ----------------------------------------------------------------------
  // シナリオ。claims.md の C 番号と対応させる。
  // ----------------------------------------------------------------------
  private scenarios: Record<string, (this: WorkspaceLab, rec: Recorder, p: Record<string, string>) => Promise<void>> = {
    /**
     * C01 / C06 — まず「検証したい機能を外した状態」で通す。
     * 旧 Workspace が正常に動くことを先に見ないと、後続の失敗の切り分けができない。
     */
    async "baseline-shell"(rec) {
      const ws = this.shell();
      rec.note("C06", "tables before", this.tables());
      await this.seedShell(rec, ws, "C01");
      const tree = await rec.step("C01", "walk shell", "shell.glob", { pattern: "/**" }, () => walkShell(ws), (t) => t);
      rec.note("C06", "tables after", this.tables());
      rec.note("C06", "cf_workspace_default rows", this.count("cf_workspace_default"));
      if (tree.ok) rec.note("C01", "entry count", tree.value.length);
    },

    /**
     * C07 / C08 / S3 — 新 Workspace を同じ storage に構築すると何が起きるか。
     * テーブルが「いつ」作られるか（構築時か初回 fs 操作時か）も観測する。
     */
    async tables(rec) {
      const shell = this.shell();
      await this.seedShell(rec, shell, "C08");
      rec.note("C08", "tables after shell seed", this.tables());

      const ws = this.computer();
      rec.note("S3", "tables right after new Workspace()", this.tables());

      await rec.step("S3", "first fs op", "computer.mkdir", { path: "/workspace" }, () =>
        ws.fs.mkdir("/workspace", { recursive: true })
      );
      rec.note("S3", "tables after first fs op", this.tables());

      rec.note("C08", "cf_workspace_default rows", this.count("cf_workspace_default"));
      rec.note("C07", "vfs_nodes rows", this.count("vfs_nodes"));
      rec.note("C07", "schema_version", this.ctx.storage.sql
        .exec<{ v: number }>("SELECT v FROM vfs_meta WHERE k = 'schema_version'").toArray());
    },

    /**
     * C09 / C10 — 記事の中心。移行せずに切り替えると旧ファイルはどう見えるか。
     *
     * 対照が要になる: 「新から見えない」だけでは「そもそも書けていなかった」と
     * 区別できない。**同じ DO で旧 Workspace からは読めること**を同じ run の中で示す。
     */
    async "no-migration"(rec) {
      const shell = this.shell();
      await this.seedShell(rec, shell, "C09");

      // 対照①: 旧側では読める
      await rec.step("C09", "対照: 旧から読む", "shell.readFile", { path: "/notes.md" }, () =>
        shell.readFile("/notes.md"), (v) => ({ found: v !== null, length: v?.length ?? 0 }));

      const before = this.tables();
      rec.note("C09", "tables before switch", before);

      // ここで「デプロイを新実装に差し替えた」ことに相当する
      const ws = this.computer();
      await rec.step("C09", "新 Workspace を構築", "new Workspace", { storage: "ctx.storage" }, async () => {
        await ws.fs.mkdir("/workspace", { recursive: true });
      });

      // 本題: 新から旧ファイルが見えるか
      for (const path of ["/workspace/notes.md", "/notes.md"]) {
        await rec.step("C09", `新から読む ${path}`, "computer.readFile", { path }, () =>
          ws.fs.readFile(path, "utf8"), (v) => ({ length: v.length }));
      }
      await rec.step("C09", "新側のツリー", "computer.walk", { root: "/" }, () => walkComputer(ws, "/"), (t) => t);

      // 対照②: 切り替え後も旧側からはまだ読める = データは消えていない
      await rec.step("C10", "対照: 切り替え後に旧から読む", "shell.readFile", { path: "/notes.md" }, () =>
        this.shell().readFile("/notes.md"), (v) => ({ found: v !== null, length: v?.length ?? 0 }));
      rec.note("C10", "cf_workspace_default rows after switch", this.count("cf_workspace_default"));
      rec.note("C09", "tables after switch", this.tables());
    },

    /**
     * C11〜C15 / C23 / C25 — 公式移行スクリプトを「そのまま」流す。
     * variant=fixed で修正版を流して対照にする。
     */
    async migrate(rec, p) {
      const fixed = p.variant === "fixed";
      const shell = this.shell();
      await this.seedShell(rec, shell, "C11");

      const before = await rec.step("C11", "移行前のツリー（旧）", "shell.walk", {}, () => walkShell(shell), (t) => t);

      // C25: glob の順序（公式スクリプトが暗黙に依存している前提）
      if (before.ok) {
        const paths = before.value.map((e) => e.path);
        const sorted = [...paths].sort();
        const parentsFirst = paths.every((path, i) =>
          paths.slice(0, i).includes(path.slice(0, path.lastIndexOf("/"))) || path.lastIndexOf("/") === 0
        );
        rec.note("C25", "glob order", { pathsInGlobOrder: paths, isSorted: JSON.stringify(paths) === JSON.stringify(sorted), parentsBeforeChildren: parentsFirst });
      }

      const ws = this.computer();
      const copy = fixed ? copyShellWorkspaceFixed : copyShellWorkspace;
      await rec.step(fixed ? "C14-fixed" : "C11", `移行実行（${fixed ? "修正版" : "公式そのまま"}）`, "copyShellWorkspace", { root: "/workspace" }, () =>
        copy(shell, ws, "/workspace"));

      const after = await rec.step("C11", "移行後のツリー（新）", "computer.walk", { root: "/workspace" }, () => walkComputer(ws, "/workspace"), (t) => t);

      if (before.ok && after.ok) {
        rec.note("C11", "comparison", compare(before.value, after.value, "/workspace"));
        // C14: シンボリックリンクの着地点
        rec.note("C14", "symlinks", await symlinkReport(before.value, after.value, ws));
        // C23: タイムスタンプ
        rec.note("C23", "timestamps", before.value
          .filter((e) => e.type === "file")
          .map((e) => {
            const a = after.value.find((x) => x.path === `/workspace${e.path}`);
            return { path: e.path, shellCreatedAt: e.createdAt, shellUpdatedAt: e.updatedAt, computerMtime: a?.mtime, computerMtimeIsNow: a?.mtime !== undefined && Math.abs(a.mtime - Date.now()) < 60_000 };
          }));
        // C24: Shell 側が持っていた mime の一覧（新側に受け皿が無いことの材料）
        rec.note("C24", "shell mimeTypes", before.value.filter((e) => e.type === "file").map((e) => ({ path: e.path, mimeType: e.mimeType })));
      }
    },

    /** C16 / C17 — 2 回流す。variant=fixed で修正版、flag=1 でフラグ方式 */
    async "migrate-twice"(rec, p) {
      const fixed = p.variant === "fixed";
      const useFlag = p.flag === "1";
      const shell = this.shell();
      await this.seedShell(rec, shell, "C16");
      const ws = this.computer();
      const copy = fixed ? copyShellWorkspaceFixed : copyShellWorkspace;

      for (const attempt of [1, 2]) {
        if (useFlag && this.ctx.storage.kv.get("shellMigrated")) {
          rec.note("C17", `${attempt} 回目`, "フラグが立っているのでスキップ");
          continue;
        }
        const r = await rec.step("C16", `${attempt} 回目の移行（${fixed ? "修正版" : "公式そのまま"}${useFlag ? " + フラグ" : ""}）`, "copyShellWorkspace", { attempt }, () =>
          copy(shell, ws, "/workspace"));
        if (useFlag && r.ok) this.ctx.storage.kv.put("shellMigrated", true);
      }

      const after = await rec.step("C16", "2 回目のあとのツリー", "computer.walk", { root: "/workspace" }, () => walkComputer(ws, "/workspace"), (t) => t);
      const before = await rec.step("C16", "旧ツリー", "shell.walk", {}, () => walkShell(shell), (t) => t);
      if (before.ok && after.ok) rec.note("C16", "comparison", compare(before.value, after.value, "/workspace"));
    },

    /**
     * C18 — サイズ別。旧（R2 なし）と新で同じバイト列を書いて、どこで落ちるか。
     * 対照: 同じサイズで新 Computer は通ること。
     */
    async sizes(rec, p) {
      const withR2 = p.r2 === "1";
      const shell = this.shell(withR2 ? { r2: this.env.R2 } : {});
      const ws = this.computer();
      // 対照を成立させるために先に作る。
      // （初回これを忘れて対照が全部 ENOENT になり、C18 の結論が出せなかった）
      await rec.step("C18", "対照の準備", "computer.mkdir", { path: "/workspace" }, () =>
        ws.fs.mkdir("/workspace", { recursive: true }));

      for (const c of SIZE_CASES) {
        const bytes = makeBytes(c.size, c.size);
        const digest = await sha256(bytes);
        const base64Len = Math.ceil(c.size / 3) * 4;

        const w = await rec.step("C18", `旧 Shell に ${c.label}${withR2 ? "（R2あり）" : "（R2なし）"}`, "shell.writeFileBytes",
          { label: c.label, size: c.size, base64Len, sha256: digest, r2: withR2 }, () =>
          shell.writeFileBytes(`/size-${c.label}.bin`, bytes));
        if (w.ok) {
          await rec.step("C18", `旧 Shell から ${c.label} を読む`, "shell.readFileBytes", { label: c.label }, async () => {
            const got = await shell.readFileBytes(`/size-${c.label}.bin`);
            return { size: got?.length ?? -1, sha256: got ? await sha256(got) : null, match: got ? (await sha256(got)) === digest : false };
          }, (v) => v);
          // 格納先（inline か r2 か）も残す
          rec.note("C18", `${c.label} の storage_backend`, this.ctx.storage.sql
            .exec("SELECT path, size, storage_backend, content_encoding, length(content) AS content_len FROM cf_workspace_default WHERE path = ?", `/size-${c.label}.bin`)
            .toArray());
        }

        // 対照: 同じバイト列を新 Computer へ
        const w2 = await rec.step("C18", `対照: 新 Computer に ${c.label}`, "computer.writeFile",
          { label: c.label, size: c.size, sha256: digest, expectedChunks: Math.ceil(c.size / 524288) }, () =>
          ws.fs.writeFile(`/workspace/size-${c.label}.bin`, bytes));
        if (w2.ok) {
          await rec.step("C18", `新 Computer から ${c.label} を読む`, "computer.readFile", { label: c.label }, async () => {
            const got = await readAllBytes(await ws.fs.readFile(`/workspace/size-${c.label}.bin`));
            return { size: got.length, match: (await sha256(got)) === digest };
          }, (v) => v);
          rec.note("C18", `${c.label} のチャンク数`, this.ctx.storage.sql
            .exec("SELECT COUNT(*) AS chunks, SUM(size) AS total FROM vfs_chunks WHERE inode = (SELECT child_inode FROM vfs_dirents WHERE name = ?)", `size-${c.label}.bin`)
            .toArray());
        }
      }
    },

    /**
     * C19 — 新スキーマを書いたあと、古い Computer に戻せるか。
     * 実際に古い版をデプロイする代わりに、on-disk の schema_version を 1 つ上げて
     * 「このバイナリより新しい DB」を作り、同じ構築経路を通す。
     */
    async rollback(rec) {
      const ws = this.computer();
      await rec.step("C19", "まず普通に書く", "computer.writeFile", { path: "/workspace/a.txt" }, async () => {
        await ws.fs.mkdir("/workspace", { recursive: true });
        await ws.fs.writeFile("/workspace/a.txt", "hello");
      });
      rec.note("C19", "schema_version（現在）", this.ctx.storage.sql
        .exec("SELECT v FROM vfs_meta WHERE k='schema_version'").toArray());

      // 対照: 同じバージョンのまま作り直せば開ける
      await rec.step("C19", "対照: 同じ版で再構築", "new Workspace", {}, async () => {
        const again = this.computer();
        return await again.fs.readFile("/workspace/a.txt", "utf8");
      }, (v) => ({ read: v }));

      // on-disk を 1 つ進める = 「未来の版が書いた DB」
      await rec.step("C19", "schema_version を 11 に偽装", "sql.exec", { to: 11 }, async () => {
        this.ctx.storage.sql.exec("UPDATE vfs_meta SET v = 11 WHERE k = 'schema_version'");
      });

      await rec.step("C19", "古いバイナリで開き直す", "new Workspace + fs op", {}, async () => {
        const stale = this.computer();
        return await stale.fs.readFile("/workspace/a.txt", "utf8");
      }, (v) => ({ read: v }));

      // 後片付け（この DO を他のテストで使わないが念のため）
      await rec.step("C19", "schema_version を 10 に戻す", "sql.exec", { to: 10 }, async () => {
        this.ctx.storage.sql.exec("UPDATE vfs_meta SET v = 10 WHERE k = 'schema_version'");
      });
      await rec.step("C19", "戻したら開けるか", "new Workspace + fs op", {}, async () => {
        return await this.computer().fs.readFile("/workspace/a.txt", "utf8");
      }, (v) => ({ read: v }));
    },

    /**
     * C13 の negative control。
     * 「SHA-256 が一致した」は、比較が**不一致を検出できる**ことを示さないと意味がない。
     */
    async "hash-control"(rec) {
      const ws = this.computer();
      await ws.fs.mkdir("/workspace", { recursive: true });
      const a = makeBytes(4096, 1);
      const b = makeBytes(4096, 1);
      b[2000] = (b[2000]! ^ 0x01) & 0xff; // 1 ビットだけ変える
      const [ha, hb] = [await sha256(a), await sha256(b)];
      rec.note("C13", "対照: 1 ビット違いのハッシュ", { sha256A: ha, sha256B: hb, differ: ha !== hb });

      await rec.step("C13", "A を書いて読む", "computer.roundtrip", {}, async () => {
        await ws.fs.writeFile("/workspace/h.bin", a);
        const got = await readAllBytes(await ws.fs.readFile("/workspace/h.bin"));
        return { sha256: await sha256(got), matchesA: (await sha256(got)) === ha, matchesB: (await sha256(got)) === hb };
      }, (v) => v);
    },

    /** C18 の上限探索。2MB 行上限は本当にあるのか。落ちるまでサイズを上げる */
    async "probe-size"(rec, p) {
      const shell = this.shell();
      const ws = this.computer();
      await ws.fs.mkdir("/workspace", { recursive: true });
      const list = (p.sizes ?? "4194304,8388608,16777216,33554432").split(",").map(Number);
      for (const size of list) {
        const bytes = makeBytes(size, size);
        const digest = await sha256(bytes);
        const base64Len = Math.ceil(size / 3) * 4;
        const w = await rec.step("C18", `旧 Shell に ${(size / 1048576).toFixed(0)}MB`, "shell.writeFileBytes",
          { size, base64Len }, () => shell.writeFileBytes(`/p-${size}.bin`, bytes));
        if (w.ok) {
          await rec.step("C18", `読み戻し ${(size / 1048576).toFixed(0)}MB`, "shell.readFileBytes", { size }, async () => {
            const got = await shell.readFileBytes(`/p-${size}.bin`);
            return { size: got?.length ?? -1, match: got ? (await sha256(got)) === digest : false };
          }, (v) => v);
        }
        await rec.step("C18", `対照: 新 Computer に ${(size / 1048576).toFixed(0)}MB`, "computer.writeFile",
          { size, chunks: Math.ceil(size / 524288) }, () => ws.fs.writeFile(`/workspace/p-${size}.bin`, bytes));
      }
    },

    /**
     * R3 の追加調査。公式 Limits は
     *   「Key and value combined cannot exceed 2 MB」（KV）
     *   「Maximum string, BLOB or table row size: 2 MB」（SQL）
     * と書いている。TEXT では 8 MiB だった。BLOB と KV でも同じか、素の SQL で直接測る。
     * Workspace を経由しないので、Shell / Computer の実装の影響を受けない。
     */
    async limits(rec, p) {
      const sizes = (p.sizes ?? "1048576,2097152,2097153,4194304,8388000,8388608,8388609")
        .split(",").map(Number);
      const sql = this.ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS probe (k TEXT PRIMARY KEY, t TEXT, b BLOB)");

      for (const size of sizes) {
        const bytes = makeBytes(size, size);
        const text = "a".repeat(size);

        await rec.step("R3", `TEXT ${size}`, "sql.insert", { size, kind: "TEXT" }, async () => {
          sql.exec("INSERT OR REPLACE INTO probe (k, t) VALUES (?, ?)", `t${size}`, text);
          const got = sql.exec<{ n: number }>("SELECT length(t) AS n FROM probe WHERE k = ?", `t${size}`).one();
          return { storedLength: got.n };
        }, (v) => v);

        await rec.step("R3", `BLOB ${size}`, "sql.insert", { size, kind: "BLOB" }, async () => {
          sql.exec("INSERT OR REPLACE INTO probe (k, b) VALUES (?, ?)", `b${size}`, bytes);
          const got = sql.exec<{ n: number }>("SELECT length(b) AS n FROM probe WHERE k = ?", `b${size}`).one();
          return { storedLength: got.n };
        }, (v) => v);

        await rec.step("R3", `KV value ${size}`, "storage.kv.put", { size, kind: "KV" }, async () => {
          this.ctx.storage.kv.put(`kv${size}`, text);
          const got = this.ctx.storage.kv.get(`kv${size}`);
          return { readBackLength: typeof got === "string" ? got.length : null };
        }, (v) => v);
      }
      sql.exec("DROP TABLE probe");
    },

    /**
     * R3 の決定実験。
     * 素の 1 値は 8,388,609 が通り 16,777,216 で落ちた（= 上限は 16 MiB 付近）。
     * ところが旧 Shell は base64 8,388,548 文字で落ちた。約半分。
     *
     * 仮説: Shell の書き込みは `INSERT ... ON CONFLICT DO UPDATE SET content = excluded.content`
     * の **UPSERT** で、`excluded` 側ともう一方で値を 2 本持つため実質 2 倍を食う。
     *
     * 対照: 同じサイズを (a) 素の INSERT と (b) 行が既にある UPSERT で撃ち分ける。
     */
    async upsert(rec, p) {
      const sql = this.ctx.storage.sql;
      sql.exec("CREATE TABLE IF NOT EXISTS up (k TEXT PRIMARY KEY, t TEXT)");
      const sizes = (p.sizes ?? "8388544,8388548,12582912").split(",").map(Number);

      for (const size of sizes) {
        const text = "a".repeat(size);

        // (a) 対照: 行が無い状態への素の INSERT
        await rec.step("R3", `素の INSERT ${size}`, "sql", { size, mode: "insert" }, async () => {
          sql.exec("DELETE FROM up WHERE k = 'x'");
          sql.exec("INSERT INTO up (k, t) VALUES ('x', ?)", text);
          return { stored: sql.exec<{ n: number }>("SELECT length(t) AS n FROM up WHERE k='x'").one().n };
        }, (v) => v);

        // (b) 本題: 行が既にある状態への UPSERT（Shell と同じ形）
        await rec.step("R3", `UPSERT ${size}`, "sql", { size, mode: "upsert" }, async () => {
          sql.exec("DELETE FROM up WHERE k = 'y'");
          sql.exec("INSERT INTO up (k, t) VALUES ('y', 'seed')");
          sql.exec("INSERT INTO up (k, t) VALUES ('y', ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t", text);
          return { stored: sql.exec<{ n: number }>("SELECT length(t) AS n FROM up WHERE k='y'").one().n };
        }, (v) => v);

        // (c) 対照: 行が無い状態への UPSERT（衝突しないので excluded は効かないはず）
        await rec.step("R3", `UPSERT（衝突なし）${size}`, "sql", { size, mode: "upsert-nohit" }, async () => {
          sql.exec("DELETE FROM up WHERE k = 'z'");
          sql.exec("INSERT INTO up (k, t) VALUES ('z', ?) ON CONFLICT(k) DO UPDATE SET t = excluded.t", text);
          return { stored: sql.exec<{ n: number }>("SELECT length(t) AS n FROM up WHERE k='z'").one().n };
        }, (v) => v);
      }
      sql.exec("DROP TABLE up");
    },

    /**
     * R3 の切り分け。同じ DO・同じペイロード長で
     *   (a) 旧 Shell の writeFileBytes
     *   (b) Shell とまったく同じ列構成のテーブルへの素の UPSERT
     *   (c) 2 列だけのテーブルへの素の INSERT
     * を並べる。どこで差が出るかを見る。
     */
    async "shell-vs-raw"(rec, p) {
      const size = Number(p.size ?? 6291409);
      const bytes = makeBytes(size, size);
      const b64len = Math.ceil(size / 3) * 4;
      const text = "a".repeat(b64len);
      const sql = this.ctx.storage.sql;
      rec.note("R3", "payload", { fileBytes: size, base64Len: b64len });

      await rec.step("R3", "(a) shell.writeFileBytes", "shell", { size }, () =>
        this.shell().writeFileBytes(`/x-${size}.bin`, bytes));

      await rec.step("R3", "(b) Shell と同じ列構成への素の UPSERT", "sql", { b64len }, async () => {
        sql.exec(`CREATE TABLE IF NOT EXISTS mimic (
          path TEXT PRIMARY KEY, parent_path TEXT NOT NULL, name TEXT NOT NULL,
          type TEXT NOT NULL, mime_type TEXT NOT NULL DEFAULT 'text/plain',
          size INTEGER NOT NULL DEFAULT 0,
          storage_backend TEXT NOT NULL DEFAULT 'inline', r2_key TEXT, target TEXT,
          content_encoding TEXT NOT NULL DEFAULT 'utf8', content TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          modified_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
        sql.exec(`INSERT INTO mimic
          (path, parent_path, name, type, mime_type, size, storage_backend, r2_key, content_encoding, content, created_at, modified_at)
          VALUES (?, '/', ?, 'file', 'application/octet-stream', ?, 'inline', NULL, 'base64', ?, 0, 0)
          ON CONFLICT(path) DO UPDATE SET content = excluded.content`,
          `/x-${size}.bin`, `x-${size}.bin`, size, text);
        return { stored: sql.exec<{ n: number }>("SELECT length(content) AS n FROM mimic").one().n };
      }, (v) => v);

      await rec.step("R3", "(d) Shell の DDL と INSERT を完全複製", "sql", { b64len }, async () => {
        sql.exec(`CREATE TABLE IF NOT EXISTS exact_copy (
          path             TEXT PRIMARY KEY,
          parent_path      TEXT NOT NULL,
          name             TEXT NOT NULL,
          type             TEXT NOT NULL CHECK(type IN ('file','directory','symlink')),
          mime_type        TEXT NOT NULL DEFAULT 'text/plain',
          size             INTEGER NOT NULL DEFAULT 0,
          storage_backend  TEXT NOT NULL DEFAULT 'inline' CHECK(storage_backend IN ('inline','r2')),
          r2_key           TEXT,
          target           TEXT,
          content_encoding TEXT NOT NULL DEFAULT 'utf8',
          content          TEXT,
          created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
          modified_at      INTEGER NOT NULL DEFAULT (unixepoch()))`);
        sql.exec("CREATE INDEX IF NOT EXISTS exact_copy_parent ON exact_copy(parent_path)");
        sql.exec(`INSERT INTO exact_copy
            (path, parent_path, name, type, mime_type, size,
             storage_backend, r2_key, content_encoding, content, created_at, modified_at)
          VALUES (?, ?, ?, 'file', ?, ?, 'inline', NULL, 'base64', ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET
            mime_type         = excluded.mime_type,
            size              = excluded.size,
            storage_backend   = 'inline',
            r2_key            = NULL,
            content_encoding  = 'base64',
            content           = excluded.content,
            modified_at       = excluded.modified_at`,
          `/x-${size}.bin`, "/", `x-${size}.bin`, "application/octet-stream", size, text, 0, 0);
        return { stored: sql.exec<{ n: number }>("SELECT length(content) AS n FROM exact_copy").one().n };
      }, (v) => v);

      await rec.step("R3", "(e) Shell が作る base64 そのものを使う", "sql", {}, async () => {
        // "a".repeat() ではなく、実際に btoa した文字列で試す
        let binary = "";
        const CHUNK = 8192;
        for (let i = 0; i < bytes.byteLength; i += CHUNK)
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
        const real = btoa(binary);
        sql.exec("CREATE TABLE IF NOT EXISTS realb64 (k TEXT PRIMARY KEY, t TEXT)");
        sql.exec("INSERT OR REPLACE INTO realb64 (k, t) VALUES ('k', ?)", real);
        return { base64Len: real.length, stored: sql.exec<{ n: number }>("SELECT length(t) AS n FROM realb64").one().n };
      }, (v) => v);

      await rec.step("R3", "(c) 2 列テーブルへの素の INSERT", "sql", { b64len }, async () => {
        sql.exec("CREATE TABLE IF NOT EXISTS two (k TEXT PRIMARY KEY, t TEXT)");
        sql.exec("INSERT OR REPLACE INTO two (k, t) VALUES ('k', ?)", text);
        return { stored: sql.exec<{ n: number }>("SELECT length(t) AS n FROM two").one().n };
      }, (v) => v);
    },

    /** C20 — 同一バイト列の重複排除。対照は「違うバイト列なら 2 行になる」 */
    async dedup(rec) {
      const ws = this.computer();
      const a = makeBytes(512 * 1024, 11);
      const b = makeBytes(512 * 1024, 22);
      await rec.step("C20", "準備", "computer.mkdir", {}, () => ws.fs.mkdir("/workspace/d", { recursive: true }));
      const blobs = () => this.count("vfs_blobs");

      rec.note("C20", "blobs 初期", blobs());
      await rec.step("C20", "同じ内容を 1 パス目", "computer.writeFile", { sha256: await sha256(a) }, () => ws.fs.writeFile("/workspace/d/x1.bin", a));
      rec.note("C20", "blobs 1 パス後", blobs());
      await rec.step("C20", "同じ内容を 2 パス目", "computer.writeFile", { sha256: await sha256(a) }, () => ws.fs.writeFile("/workspace/d/x2.bin", a));
      rec.note("C20", "blobs 2 パス後（増えなければ重複排除）", blobs());
      await rec.step("C20", "対照: 違う内容", "computer.writeFile", { sha256: await sha256(b) }, () => ws.fs.writeFile("/workspace/d/y.bin", b));
      rec.note("C20", "blobs 違う内容を足した後（増えるはず）", blobs());
      rec.note("C20", "chunks", this.ctx.storage.sql.exec("SELECT inode, COUNT(*) AS n FROM vfs_chunks GROUP BY inode").toArray());
    },

    /** C21 — 旧 R2 退避ファイルの移行 */
    async r2(rec) {
      const shell = this.shell({ r2: this.env.R2 });
      const big = makeBytes(2 * 1024 * 1024, 7); // 1.5MB 閾値超え → R2 へ
      const digest = await sha256(big);
      await rec.step("C21", "旧 Shell に 2MB（R2 退避されるはず）", "shell.writeFileBytes", { size: big.length, sha256: digest }, () =>
        shell.writeFileBytes("/big.bin", big));
      rec.note("C21", "行の storage_backend", this.ctx.storage.sql
        .exec("SELECT path, size, storage_backend, r2_key FROM cf_workspace_default WHERE path='/big.bin'").toArray());

      const ws = this.computer();
      await rec.step("C21", "移行（r2 を渡した Shell から）", "copyShellWorkspace", {}, () =>
        copyShellWorkspace(shell, ws, "/workspace"));
      await rec.step("C21", "新側で SHA-256 照合", "computer.readFile", {}, async () => {
        const got = await readAllBytes(await ws.fs.readFile("/workspace/big.bin"));
        return { size: got.length, sha256: await sha256(got), match: (await sha256(got)) === digest };
      }, (v) => v);

      // 対照: r2 を渡さない Shell からは本体が読めないこと
      await rec.step("C21", "対照: r2 を渡さない Shell で読む", "shell.readFileBytes", {}, async () => {
        const bare = new ShellWorkspace({ sql: this.ctx.storage.sql, name: () => this.ctx.id.name ?? undefined });
        const got = await bare.readFileBytes("/big.bin");
        return { size: got?.length ?? -1 };
      }, (v) => v);
    },

    /** C01 / C02 / C03 / C04 — 永続化。外部から複数回呼ぶ。write / read を分ける */
    async persist(rec, p) {
      const ws = this.computer();
      const mode = p.mode ?? "read";
      const path = "/workspace/persist.txt";
      if (mode === "write") {
        const payload = `written-by ${this.bootId} at ${new Date().toISOString()}`;
        await rec.step("C01", "書く", "computer.writeFile", { path }, async () => {
          await ws.fs.mkdir("/workspace", { recursive: true });
          await ws.fs.writeFile(path, payload);
        });
        rec.note("C01", "payload", payload);
      }
      await rec.step("C02", "読む", "computer.readFile", { path }, () => ws.fs.readFile(path, "utf8"), (v) => ({ text: v }));
    },

    /**
     * C22 — サイズ別ベンチ。
     *
     * ⚠️ **Worker の中では Date.now() が進まない。**
     * 本番では DO storage への読み書きを挟んでも時計が動かず、4MB の書き込みすら
     * 0ms と記録された（ローカル miniflare では進む）。Spectre 対策の時計粗化。
     * → 計測はドライバ側の壁時計で行い、ここは「指定回数だけ回す」役に徹する。
     *   ドライバは rounds=0（素通し）との差分を取って 1 回あたりを出す。
     */
    async loop(rec, p) {
      const rounds = Number(p.rounds ?? 0);
      const side = p.side ?? "computer";
      const size = Number(p.size ?? 1024);
      const bytes = makeBytes(size, size);
      const ws = this.computer();
      const shell = this.shell();
      await ws.fs.mkdir("/workspace", { recursive: true });
      for (let i = 0; i < rounds; i++) {
        if (side === "shell") {
          await shell.writeFileBytes("/loop.bin", bytes);
          await shell.readFileBytes("/loop.bin");
        } else {
          await ws.fs.writeFile("/workspace/loop.bin", bytes);
          await readAllBytes(await ws.fs.readFile("/workspace/loop.bin"));
        }
      }
      rec.note("C22", "loop done", { side, size, rounds });
    },

    /** C22（旧設計）— 参考として残す。本番では全て 0ms になる */
    async bench(rec, p) {
      const rounds = Number(p.rounds ?? 10);
      const ws = this.computer();
      const shell = this.shell();
      await ws.fs.mkdir("/workspace/bench", { recursive: true });

      for (const c of SIZE_CASES.filter((s) => s.size <= 1024 * 1024)) {
        const bytes = makeBytes(c.size, c.size);
        for (const side of ["shell", "computer"] as const) {
          const write: number[] = [];
          const read: number[] = [];
          for (let i = 0; i < rounds + 1; i++) {
            const p1 = `/bench-${c.label}.bin`;
            let t = Date.now();
            if (side === "shell") await shell.writeFileBytes(p1, bytes);
            else await ws.fs.writeFile(`/workspace/bench${p1}`, bytes);
            const wMs = Date.now() - t;
            t = Date.now();
            if (side === "shell") await shell.readFileBytes(p1);
            else await readAllBytes(await ws.fs.readFile(`/workspace/bench${p1}`));
            const rMs = Date.now() - t;
            if (i > 0) { write.push(wMs); read.push(rMs); } // 1 回目はウォームアップとして捨てる
          }
          rec.note("C22", `${side} ${c.label}`, {
            side, label: c.label, size: c.size, rounds,
            writeMs: { median: median(write), all: write },
            readMs: { median: median(read), all: read },
          });
        }
      }
    },
  };
}

function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function compare(before: Entry[], after: Entry[], root: string) {
  const at = (p: string) => `${root}${p}`;
  const byPath = new Map(after.map((e) => [e.path, e]));
  const rows = before.map((b) => {
    const a = byPath.get(at(b.path));
    return {
      path: b.path,
      expected: at(b.path),
      present: a !== undefined,
      typeBefore: b.type,
      typeAfter: a?.type,
      sha256Match: b.type === "file" ? b.sha256 === a?.sha256 : undefined,
    };
  });
  return {
    total: before.length,
    missing: rows.filter((r) => !r.present).map((r) => r.expected),
    typeChanged: rows.filter((r) => r.present && r.typeBefore !== r.typeAfter).map((r) => r.expected),
    contentMismatch: rows.filter((r) => r.sha256Match === false).map((r) => r.expected),
    extra: after.filter((a) => !before.some((b) => at(b.path) === a.path)).map((a) => a.path),
  };
}

/** C14: 移行後のシンボリックリンクが「どこに着地するか」まで見る */
async function symlinkReport(before: Entry[], after: Entry[], ws: Workspace) {
  const out = [];
  for (const b of before.filter((e) => e.type === "symlink")) {
    const expectedPath = `/workspace${b.path}`;
    const a = after.find((e) => e.path === expectedPath);
    // 実際に辿れるか = 中身が読めるか
    const resolved = await ws.fs.readFile(expectedPath, "utf8").then(
      (t) => ({ readable: true, length: t.length }),
      (e) => ({ readable: false, error: String((e as Error).message) })
    );
    out.push({
      link: b.path,
      shellTarget: b.target,
      migratedTarget: a?.target,
      // 「あるべき着地点」= Shell と同じ解決をしてから /workspace 配下に移した位置
      expectedTarget: b.target ? `/workspace${resolveTargetFixed(b.path, b.target)}` : undefined,
      resolved,
    });
  }
  return out;
}
