import { performance } from 'node:perf_hooks'
import { Hono } from 'hono'

const ITER = 50_000
const WARM = 10_000

function build(conflict: boolean) {
  const app = new Hono()
  if (conflict) app.get('/x*/y', (c) => c.text('a'))
  app.get('/x/*', (c) => c.text('b'))
  app.get('/users/:id', (c) => c.json({ id: c.req.param('id') }))
  return app
}

async function bench(label: string, conflict: boolean) {
  const app = build(conflict)
  const req = new Request('http://localhost/users/123')
  const run = async (n: number) => {
    for (let i = 0; i < n; i++) { const r = await app.fetch(req.clone()); await r.text() }
  }
  await run(WARM)
  const router: any = (app as any).router
  const start = performance.now()
  await run(ITER)
  const d = performance.now() - start
  return { label, router: router?.name ?? router?.constructor?.name, durationMs: Number(d.toFixed(2)), rps: Math.round(ITER / (d / 1000)) }
}

const out = []
for (let i = 0; i < 12; i++) {
  out.push(await bench('no-conflict (RegExpRouter)', false))
  out.push(await bench('conflict (Trie fallback)', true))
}
console.log(JSON.stringify(out, null, 2))
