import { Hono } from 'hono'

const app = new Hono()

app.post('/users', async (c) => {
  const body = await c.req.json()

  return c.json({
    name: body.name.toUpperCase(),
  })
})

export default app
