import { SignJWT, jwtVerify, exportJWK, importJWK } from 'jose'

// --- persistence round-trip (extractable: true) ---
const kp = await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'}, true, ['sign','verify'])
const privJwk = await exportJWK(kp.privateKey)
const pubJwk  = await exportJWK(kp.publicKey)
console.log('[persist] private JWK keys:', Object.keys(privJwk).join(','), '| has d:', 'd' in privJwk)
const reloaded = await importJWK(privJwk, 'ES256')
const hdr = { typ:'dpop+jwt', alg:'ES256', jwk:{kty:pubJwk.kty,crv:pubJwk.crv,x:pubJwk.x,y:pubJwk.y} }
const p = await new SignJWT({htm:'POST',htu:'https://oauth2.googleapis.com/token',jti:'x'}).setProtectedHeader(hdr).setIssuedAt().sign(reloaded)
await jwtVerify(p, kp.publicKey)
console.log('[persist] sign with reloaded key -> verify OK (round-trip works, but "d" now sits in your DB)')

// --- ES256 cost: the blog's stated reason access tokens stay Bearer ---
const N = 20000
const data = new TextEncoder().encode('.'.repeat(200))
let t = performance.now()
for (let i=0;i<N;i++) await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, kp.privateKey, data)
const signMs = performance.now()-t
const sig = await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'}, kp.privateKey, data)
t = performance.now()
for (let i=0;i<N;i++) await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'}, kp.publicKey, sig, data)
const verifyMs = performance.now()-t
console.log(`[perf] N=${N}  ES256 sign   ${(signMs/N*1000).toFixed(1)} us/op  (${Math.round(N/signMs*1000).toLocaleString()} ops/s)`)
console.log(`[perf] N=${N}  ES256 verify ${(verifyMs/N*1000).toFixed(1)} us/op  (${Math.round(N/verifyMs*1000).toLocaleString()} ops/s)`)
