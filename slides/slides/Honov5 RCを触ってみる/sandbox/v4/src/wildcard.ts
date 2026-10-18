import { Hono } from 'hono'
import { RegExpRouter } from 'hono/router/reg-exp-router'
import { TrieRouter } from 'hono/router/trie-router'
import { PatternRouter } from 'hono/router/pattern-router'
import { SmartRouter } from 'hono/router/smart-router'

const CASES: [string, string[]][] = [
  ['/x*/y', ['/x/y', '/xz/y', '/x/z/y']],
  ['/x*y',  ['/xay']],
  ['/wild/*/card', ['/wild//card', '/wild/a/card']],
]

const routers: Record<string, () => any> = {
  SmartRouter: () => new SmartRouter({ routers: [new RegExpRouter(), new TrieRouter()] }),
  RegExpRouter: () => new RegExpRouter(),
  TrieRouter: () => new TrieRouter(),
  PatternRouter: () => new PatternRouter(),
}

const out: any = {}
for (const [rname, factory] of Object.entries(routers)) {
  out[rname] = {}
  for (const [route, paths] of CASES) {
    out[rname][route] = {}
    for (const path of paths) {
      try {
        const app = new Hono({ router: factory() })
        app.get(route, (c) => c.text('matched'))
        const res = await app.request(`http://localhost${path}`)
        out[rname][route][path] = res.status === 200 ? 'match' : `no-match(${res.status})`
      } catch (e: any) {
        out[rname][route][path] = `ERROR: ${e?.constructor?.name}: ${e?.message}`
      }
    }
  }
}

// RegExpRouter で /x*/y と /x/* を同時登録
const conflict: any = {}
for (const [rname, factory] of Object.entries(routers)) {
  try {
    const app = new Hono({ router: factory() })
    app.get('/x*/y', (c) => c.text('a'))
    app.get('/x/*', (c) => c.text('b'))
    const res = await app.request('http://localhost/x/y')
    conflict[rname] = { ok: true, status: res.status, body: await res.text(), router: (app as any).router?.name ?? (app as any).router?.constructor?.name }
  } catch (e: any) {
    conflict[rname] = { ok: false, error: `${e?.constructor?.name}: ${e?.message}` }
  }
}

// SmartRouter が最終的に何を選んだか
const picked: any = {}
for (const [label, routes] of Object.entries({
  'simple': ['/x/*'],
  'conflict': ['/x*/y', '/x/*'],
})) {
  const app = new Hono()
  for (const r of routes) app.get(r, (c) => c.text('ok'))
  await app.request('http://localhost/x/y')
  const router: any = (app as any).router
  picked[label] = router?.name ?? router?.constructor?.name
}

console.log(JSON.stringify({ matrix: out, conflict, smartRouterPicked: picked }, null, 2))
