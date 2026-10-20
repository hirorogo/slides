/** tools/list の inputSchema をそのまま出す。403を踏む引数を組み立てるために要る。 */
import { startRecording } from './evidence.ts'
import { listTools, resetSession } from './mcp.ts'
import { load, type TokenSet } from './store.ts'

const tokens = load<TokenSet>('tokens')
if (!tokens) throw new Error('先に ./run connect')
const done = startRecording('schema')
resetSession()
const res = await listTools(tokens.access_token)
const tools = ((res.body as any)?.result?.tools ?? []) as any[]
for (const t of tools) {
  console.log(`\n━━━ ${t.name} ━━━`)
  console.log((t.description ?? '').trim().slice(0, 700))
  console.log('  inputSchema:', JSON.stringify(t.inputSchema))
}
done()
