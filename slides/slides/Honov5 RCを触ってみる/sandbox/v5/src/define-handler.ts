import { Hono } from 'hono'
import { defineHandler } from 'hono/factory'

const app = new Hono()

// 1. 検証なし。返した値がそのまま Response になる
app.get('/ping', defineHandler(() => ({ pong: true })))

// 2. リクエストとレスポンスの両方を検証する
app.post(
  '/users',
  defineHandler({
    json: (value: unknown) => {
      if (
        typeof value !== 'object' || value === null ||
        !('name' in value) || typeof value.name !== 'string'
      ) {
        throw new Error('name must be a string')
      }
      return { name: value.name }
    },
  })((c, input) => {
    return { name: input.json.name.toUpperCase() }
  })
)

const show = async (label: string, res: Response) =>
  console.log(label, res.status, (await res.text()).slice(0, 120))

await show('ping      ->', await app.request('http://localhost/ping'))
await show('valid     ->', await app.request('http://localhost/users', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'tanahiro2010' }),
}))
await show('invalid   ->', await app.request('http://localhost/users', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 42 }),
}))

// 3. Standard Schema を渡した場合（手書きの最小実装）
const NameSchema = {
  '~standard': {
    validate: (value: unknown) => {
      if (
        typeof value !== 'object' || value === null ||
        !('name' in value) || typeof (value as { name: unknown }).name !== 'string'
      ) {
        return { issues: [{ message: 'name must be a string', path: ['name'] }] }
      }
      return { value: value as { name: string } }
    },
  },
} as const

const app2 = new Hono()
app2.post(
  '/users',
  defineHandler({ json: NameSchema })((c, input) => ({
    name: input.json.name.toUpperCase(),
  }))
)

await show('schema ng ->', await app2.request('http://localhost/users', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 42 }),
}))
