import { performance } from 'node:perf_hooks'
import { app } from './benchmark-app.js'

const ITERATIONS = 100_000
const WARMUP = 20_000
const request = new Request('http://localhost/users/123')

async function run(n: number) {
  for (let i = 0; i < n; i++) {
    const res = await app.fetch(request.clone())
    if (res.status !== 200) throw new Error(`Unexpected status: ${res.status}`)
    await res.text()
  }
}

await run(WARMUP)
const start = performance.now()
await run(ITERATIONS)
const duration = performance.now() - start

console.log(JSON.stringify({
  iterations: ITERATIONS,
  durationMs: Number(duration.toFixed(2)),
  requestsPerSecond: Math.round(ITERATIONS / (duration / 1000)),
  averageMs: Number((duration / ITERATIONS).toFixed(6)),
}))
