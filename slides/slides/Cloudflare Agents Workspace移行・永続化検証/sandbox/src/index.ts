import { WorkspaceLab } from "./lab";
export { WorkspaceLab };
export type { Env } from "./lab";

import type { Env } from "./lab";

/**
 * ルーター。
 *   GET /run/<scenario>?do=<name>&...params
 * DO 名はシナリオごとに変える（移行は不可逆なので使い回すと前提が壊れる）。
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/run\/([a-z0-9-]+)$/);
    if (!m) {
      return Response.json({ usage: "GET /run/<scenario>?do=<name>" }, { status: 404 });
    }
    const scenario = m[1]!;
    const doName = url.searchParams.get("do");
    if (!doName) return Response.json({ error: "do= is required" }, { status: 400 });

    const params: Record<string, string> = {};
    for (const [k, v] of url.searchParams) if (k !== "do") params[k] = v;

    const stub = env.LAB.getByName(doName);
    const startedAt = Date.now();
    const result = await stub.run(scenario, params);
    return Response.json({ httpMs: Date.now() - startedAt, ...(result as object) });
  },
} satisfies ExportedHandler<Env>;
