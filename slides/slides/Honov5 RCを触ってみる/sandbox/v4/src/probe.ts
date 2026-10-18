import { Hono } from 'hono'
const R: Record<string, unknown> = {}
const t = async (k: string, fn: () => Promise<unknown>) => {
  try { R[k] = await fn() } catch (e) { R[k] = { threw: true, name: (e as Error)?.name, message: String((e as Error)?.message ?? e) } }
}

// --- onError: パス指定できるか ---
await t('onError_path_arg', async () => {
  const app = new Hono()
  try {
    // @ts-expect-error v4 にパス引数は無いはず
    app.onError('/api/*', (err: Error, c: any) => c.text('scoped', 500))
    app.get('/api/error', () => { throw new Error('boom') })
    const res = await app.request('http://localhost/api/error')
    return { accepted: true, status: res.status, body: await res.text() }
  } catch (e) { return { accepted: false, error: String((e as Error).message) } }
})

// --- onError: 2回登録したら上書きか合成か ---
await t('onError_composition', async () => {
  const app = new Hono()
  const order: string[] = []
  app.onError((err, c) => { order.push('first'); return c.text('first', 500) })
  app.onError((err, c) => { order.push('second'); return c.text('second', 500) })
  app.get('/boom', () => { throw new Error('boom') })
  const res = await app.request('http://localhost/boom')
  return { order, status: res.status, body: await res.text() }
})

// --- 非 Error の throw ---
await t('throw_string', async () => {
  const app = new Hono()
  let seen: any = null
  app.onError((err, c) => { seen = { ctor: err?.constructor?.name, message: err?.message, cause: (err as any)?.cause }; return c.text('handled', 500) })
  app.get('/s', () => { throw 'oops' })
  try {
    const res = await app.request('http://localhost/s')
    return { escaped: false, status: res.status, seen }
  } catch (e) { return { escaped: true, escapedValue: String(e), seen } }
})
await t('throw_object', async () => {
  const app = new Hono()
  let seen: any = null
  app.onError((err, c) => { seen = { ctor: err?.constructor?.name, message: err?.message, cause: (err as any)?.cause }; return c.text('handled', 500) })
  app.get('/o', () => { throw { code: 42 } })
  try {
    const res = await app.request('http://localhost/o')
    return { escaped: false, status: res.status, seen }
  } catch (e) { return { escaped: true, escapedValue: JSON.stringify(e), seen } }
})

// --- notFound 複数/パス ---
await t('notFound_path_arg', async () => {
  const app = new Hono()
  try {
    // @ts-expect-error
    app.notFound('/api/*', (c: any) => c.text('api nf', 404))
    const res = await app.request('http://localhost/api/zzz')
    return { accepted: true, status: res.status, body: await res.text() }
  } catch (e) { return { accepted: false, error: String((e as Error).message) } }
})

// --- c.json(undefined) ---
await t('json_undefined', async () => {
  const app = new Hono()
  app.get('/u', (c) => c.json(undefined as any))
  const res = await app.request('http://localhost/u')
  return { status: res.status, bodyLength: (await res.text()).length }
})
await t('json_function', async () => {
  const app = new Hono()
  app.get('/f', (c) => c.json((() => 1) as any))
  const res = await app.request('http://localhost/f')
  return { status: res.status, body: await res.text() }
})

// --- query の実行時の値 ---
await t('query_runtime', async () => {
  const app = new Hono()
  app.get('/q', (c) => c.json({ q: c.req.query(), qs: c.req.queries() }))
  const res = await app.request('http://localhost/q?a=1&a=2')
  return await res.json()
})

console.log(JSON.stringify(R, null, 2))
