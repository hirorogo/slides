import { Hono } from 'hono'
const R: Record<string, unknown> = {}
const t = async (k: string, fn: () => Promise<unknown>) => {
  try { R[k] = await fn() } catch (e) { R[k] = { threw: true, name: (e as Error)?.name, message: String((e as Error)?.message ?? e) } }
}

// --- onError: パス指定 ---
await t('onError_path_arg', async () => {
  const app = new Hono()
  app.onError('/api/*', async (c, next) => { c.header('X-Error-Handler', 'api'); await next() })
  app.onError((c) => c.json({ error: 'Internal Server Error' }, 500))
  app.get('/api/error', () => { throw new Error('boom') })
  app.get('/other/error', () => { throw new Error('boom') })
  const a = await app.request('http://localhost/api/error')
  const b = await app.request('http://localhost/other/error')
  return {
    accepted: true,
    api: { status: a.status, header: a.headers.get('X-Error-Handler'), body: await a.json() },
    other: { status: b.status, header: b.headers.get('X-Error-Handler'), body: await b.json() },
  }
})

// --- onError: 2回登録したら上書きか合成か ---
await t('onError_composition', async () => {
  const app = new Hono()
  const order: string[] = []
  app.onError(async (c, next) => { order.push('first'); await next() })
  app.onError((c) => { order.push('second'); return c.text('second', 500) })
  app.get('/boom', () => { throw new Error('boom') })
  const res = await app.request('http://localhost/boom')
  return { order, status: res.status, body: await res.text() }
})

// --- onError: 両方がレスポンスを返したら？ ---
await t('onError_first_returns', async () => {
  const app = new Hono()
  const order: string[] = []
  app.onError((c) => { order.push('first'); return c.text('first', 500) })
  app.onError((c) => { order.push('second'); return c.text('second', 500) })
  app.get('/boom', () => { throw new Error('boom') })
  const res = await app.request('http://localhost/boom')
  return { order, status: res.status, body: await res.text() }
})

// --- v4 スタイルのコードを v5 で動かすとどうなるか ---
await t('onError_v4_style', async () => {
  const app = new Hono()
  let observed: any = null
  // @ts-expect-error v4 の書き方をあえて残す
  app.onError((err: any, c: any) => {
    observed = { firstArgCtor: err?.constructor?.name, firstArgIsContext: typeof err?.json === 'function', secondArgType: typeof c }
    try { return c.text('v4 style', 500) } catch (e) { return undefined }
  })
  app.get('/boom', () => { throw new Error('boom') })
  try {
    const res = await app.request('http://localhost/boom')
    return { observed, status: res.status, body: await res.text() }
  } catch (e) { return { observed, threw: true, message: String((e as Error).message) } }
})

// --- 非 Error の throw ---
await t('throw_string', async () => {
  const app = new Hono()
  let seen: any = null
  app.onError((c) => { const e: any = c.error; seen = { ctor: e?.constructor?.name, message: e?.message, cause: e?.cause }; return c.text('handled', 500) })
  app.get('/s', () => { throw 'oops' })
  try {
    const res = await app.request('http://localhost/s')
    return { escaped: false, status: res.status, seen }
  } catch (e) { return { escaped: true, escapedValue: String(e), seen } }
})
await t('throw_object', async () => {
  const app = new Hono()
  let seen: any = null
  app.onError((c) => { const e: any = c.error; seen = { ctor: e?.constructor?.name, message: e?.message, cause: e?.cause }; return c.text('handled', 500) })
  app.get('/o', () => { throw { code: 42 } })
  try {
    const res = await app.request('http://localhost/o')
    return { escaped: false, status: res.status, seen }
  } catch (e) { return { escaped: true, escapedValue: JSON.stringify(e), seen } }
})

// --- notFound 複数/パス ---
await t('notFound_path_arg', async () => {
  const app = new Hono()
  app.notFound('/api/*', async (c, next) => { c.header('x-not-found', 'api'); await next() }, (c) => c.text('API resource not found', 404))
  app.notFound((c) => c.text('Not Found', 404))
  const a = await app.request('http://localhost/api/zzz')
  const b = await app.request('http://localhost/other/zzz')
  return {
    accepted: true,
    api: { status: a.status, header: a.headers.get('x-not-found'), body: await a.text() },
    other: { status: b.status, header: b.headers.get('x-not-found'), body: await b.text() },
  }
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
