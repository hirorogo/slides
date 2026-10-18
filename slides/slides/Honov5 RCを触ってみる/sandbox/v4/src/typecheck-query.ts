import { Hono } from 'hono'

const app = new Hono()

app.get('/search', (c) => {
  const { name } = c.req.query()
  const upper: string = name.toUpperCase()

  const all = c.req.queries()
  const tags: string[] = all.tag

  return c.json({ upper, tags })
})

export default app
