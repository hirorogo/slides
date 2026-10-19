import { SignJWT, jwtVerify, exportJWK, calculateJwkThumbprint } from 'jose'

console.log('node', process.version, '| jose', (await import('../node_modules/jose/package.json', {with:{type:'json'}})).default.version)

// --- 1. non-extractable key pair, per Google's SKILL.md ---
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign','verify'])
console.log('\n[1] generateKey(extractable=false)')
console.log('  privateKey.extractable =', kp.privateKey.extractable)
console.log('  publicKey.extractable  =', kp.publicKey.extractable)

// public key export still works?
try { console.log('  exportJWK(public) ->', JSON.stringify(await exportJWK(kp.publicKey))) }
catch (e) { console.log('  exportJWK(public) FAILED:', e.message) }

// --- 2. can the private key be persisted? ---
console.log('\n[2] persisting the private key across a process restart')
for (const fmt of ['jwk','pkcs8']) {
  try { await crypto.subtle.exportKey(fmt, kp.privateKey); console.log(`  exportKey('${fmt}') -> OK`) }
  catch (e) { console.log(`  exportKey('${fmt}') -> ${e.name}: ${e.message}`) }
}

// --- 3. raw signature length from crypto.subtle (SKILL.md section D) ---
const sig = await crypto.subtle.sign({ name:'ECDSA', hash:'SHA-256' }, kp.privateKey, new TextEncoder().encode('x'))
console.log('\n[3] crypto.subtle.sign ECDSA output =', sig.byteLength, 'bytes | first byte 0x' + Buffer.from(sig)[0].toString(16).padStart(2,'0'), '(DER would be 0x30)')

// node:crypto legacy API for comparison
const { createSign, KeyObject } = await import('node:crypto')
const ext = await crypto.subtle.generateKey({ name:'ECDSA', namedCurve:'P-256' }, true, ['sign','verify'])
const ko = KeyObject.from(ext.privateKey)
const der = createSign('SHA256').update('x').sign(ko)
console.log('    node:crypto createSign output =', der.length, 'bytes | first byte 0x' + der[0].toString(16), '(ASN.1 DER)')

// --- 4. build a real Google-shaped DPoP proof with jose ---
const jwk = await exportJWK(kp.publicKey)
const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } }
const authCode = '4/0AXEQxIDNpLD-qpSIvjHb2Hl10uS_2sk2GBRpO8UJQ78YZF3hZ9LB9kTA1xYLD4xisi4C5w'
const sha = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authCode))
const jti = Buffer.from(sha).toString('base64url')
const proof = await new SignJWT({ htm:'POST', htu:'https://oauth2.googleapis.com/token', jti })
  .setProtectedHeader(header).setIssuedAt().sign(kp.privateKey)
console.log('\n[4] proof built with a non-extractable key:', proof.length, 'chars')
console.log('    jti =', jti)
const { payload } = await jwtVerify(proof, kp.publicKey)
console.log('    self-verify OK; payload =', JSON.stringify(payload))
console.log('    jkt (RFC9449 cnf) =', await calculateJwkThumbprint(header.jwk))
