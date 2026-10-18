import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json()

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string'
  ) {
    return c.json({ error: 'Invalid body' }, 400)
  }

  return c.json({ name: body.name.toUpperCase() })
})

export default app
