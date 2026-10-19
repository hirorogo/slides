import hashlib, base64, json
code = "4/0AXEQxIDNpLD-qpSIvjHb2Hl10uS_2sk2GBRpO8UJQ78YZF3hZ9LB9kTA1xYLD4xisi4C5w"
doc_jti = "o29CN8LIY0l_N8iy5-ilon1guad9NFQHFOdXTzrBNck"
calc = base64.urlsafe_b64encode(hashlib.sha256(code.encode()).digest()).rstrip(b'=').decode()
print("doc jti :", doc_jti)
print("calc jti:", calc)
print("match   :", calc == doc_jti)

# decode the sample DPoP JWT from the doc (auth-code exchange)
jwt = ("eyJ0eXAiOiJkcG9wK2p3dCIsImFsZyI6IkVTMjU2IiwiandrIjp7Imt0eSI6IkVDIiwiY3J2IjoiUC0yNTYiLCJ4IjoiVkM5MXk5WllkZlNXYUR2OEphSTZneDVpZk93MnJuM1lkcWtBQjUxVXU2RSIsInkiOiJpa1BqT3RlYTRrN2ZXUFZyUll3YUE0V3c2aVZZM3BPT0lDb3RId3dHVjNvIn19"
       ".eyJqdGkiOiJvMjlDTjhMSVkwbF9OOGl5NS1pbG9uMWd1YWQ5TkZRSEZPZFhUenJCTmNrIiwiaHRtIjoiUE9TVCIsImh0dSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwiaWF0IjoxNzg0ODIyMDI1fQ"
       ".OSdQCmqTng_uZmGK5UXf8hcEMtoOu7ucmYtl5mx4901RXnj6fJRJQmIeTqfhprRBTG_RSJv2fPcWDqvQbDW7YA")
h,p,s = jwt.split('.')
def d(x): return json.loads(base64.urlsafe_b64decode(x + '='*(-len(x)%4)))
print("\nheader :", json.dumps(d(h)))
print("payload:", json.dumps(d(p)))
sig = base64.urlsafe_b64decode(s + '='*(-len(s)%4))
print("sig bytes:", len(sig), "(64 = IEEE P1363 raw r||s)")
import datetime
print("iat:", d(p)['iat'], "=", datetime.datetime.fromtimestamp(d(p)['iat'], datetime.timezone.utc).isoformat())
