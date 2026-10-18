import { Hono } from 'hono'

const app = new Hono()

// v4 の書き方そのまま
app.onError((err, c) => {
  console.error(err.message)
  return c.json({ error: 'Internal Server Error' }, 500)
})

app.get('/error', () => {
  throw new Error('boom')
})

export default app
