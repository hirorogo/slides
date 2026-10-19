import { jwtVerify, importJWK, decodeProtectedHeader } from 'jose'

const samples = {
  'auth-code exchange': "eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2IjoiUC0yNTYiLCJ4IjoiVkM5MXk5WllkZlNXYUR2OEphSTZneDVpZk93MnJuM1lkcWtBQjUxVXU2RSIsInkiOiJpa1BqT3RlYTRrN2ZXUFZyUll3YUE0V3c2aVZZM3BPT0lDb3RId3dHVjNvIn19.eyJqdGkiOiJvMjlDTjhMSVkwbF9OOGl5NS1pbG9uMWd1YWQ5TkZRSEZPZFhUenJCTmNrIiwiaHRtIjoiUE9TVCIsImh0dSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwiaWF0IjoxNzg0ODIyMDI1fQ.OSdQCmqTng_uZmGK5UXf8hcEMtoOu7ucmYtl5mx4901RXnj6fJRJQmIeTqfhprRBTG_RSJv2fPcWDqvQbDW7YA",
  'token refresh': "eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2IjoiUC0yNTYiLCJ4IjoiVkM5MXk5WllkZlNXYUR2OEphSTZneDVpZk93MnJuM1lkcWtBQjUxVXU2RSIsInkiOiJpa1BqT3RlYTRrN2ZXUFZyUll3YUE0V3c2aVZZM3BPT0lDb3RId3dHVjNvIn19.eyJqdGkiOiJvMjlDTjhaSVkwbF9LOGl5NS1pbG9uMWd1YWQ5TkY2SEZPZFhUenJCTmNrIiwiaHRtIjoiUE9TVCIsImh0dSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwibm9uY2UiOiJBTjNYd0pqWnNqbmIwWnVXa1JsZWs4UVU3d1ktWmhmLTVJUDZ0TzB0T1J6MEtndERUMUJvOEZYLXc0bnozcjVsbmVwSSIsImlhdCI6MTc4NDgyMjAyNX0.MEQCIDm09AXo2c9sovGrTUkrbEB_k9mra_Dkji-CQ9mSZVP1AiBxbiqkCE7Dt9RKyUT_3kj7q1vCvVggwnWJNX3P3vO1mw",
}

for (const [name, jwt] of Object.entries(samples)) {
  const hdr = decodeProtectedHeader(jwt)
  const sigB64 = jwt.split('.')[2]
  const sigLen = Buffer.from(sigB64, 'base64url').length
  const key = await importJWK(hdr.jwk, 'ES256')
  let verdict
  try {
    await jwtVerify(jwt, key, { clockTolerance: Number.MAX_SAFE_INTEGER })
    verdict = 'SIGNATURE VALID'
  } catch (e) {
    verdict = `SIGNATURE FAILED: ${e.code ?? e.name} — ${e.message}`
  }
  console.log(`[${name}] sig=${sigLen}B  ${verdict}`)
}
