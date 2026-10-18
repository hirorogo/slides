import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'
export const app = new Hono()
app.use('/static/*', serveStatic({ root: './' }))
app.get('/', (c) => c.text('Hello Hono!'))
