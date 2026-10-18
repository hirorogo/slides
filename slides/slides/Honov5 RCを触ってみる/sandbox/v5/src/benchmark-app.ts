import { Hono } from 'hono'

export const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

app.get('/users/:id', (c) => {
  return c.json({
    id: c.req.param('id'),
    name: 'tanahiro2010',
  })
})

app.post('/users', async (c) => {
  const body = await c.req.json()
  return c.json({ data: body }, 201)
})
