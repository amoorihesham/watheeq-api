"""Normalizes an E2E raw directory into a stable transcript: masks request IDs, tokens, UUIDs, and dates."""
import json
import re
import sys
from pathlib import Path

raw = Path(sys.argv[1])

UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TOKEN = re.compile(r"(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])")
DATE_HDR = re.compile(r"^(date|etag|keep-alive):", re.I)


def mask(text: str) -> str:
    text = UUID.sub("<uuid>", text)
    text = TOKEN.sub("<token>", text)
    return text


def mask_value(value):
    if isinstance(value, dict):
        return {k: mask_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [mask_value(v) for v in value]
    if isinstance(value, str):
        return mask(value)
    return value


print("## HTTP")
for f in sorted(raw.glob("http-*.txt")):
    content = f.read_text().replace("\r\n", "\n")
    head, _, body = content.partition("\n\n")
    lines = head.split("\n")
    print(f"\n### {f.stem[5:]}")
    print(lines[0])
    for h in sorted(lines[1:], key=str.lower):
        if DATE_HDR.match(h):
            continue
        print(mask(h))
    if body:
        try:
            print("body:", json.dumps(mask_value(json.loads(body)), sort_keys=True))
        except json.JSONDecodeError:
            print("body(raw):", mask(body))

print("\n## CLI")
for f in sorted(raw.glob("cli-*")):
    print(f"\n### {f.name}")
    print(mask(f.read_text()).rstrip())

print("\n## DB state")
print(mask((raw / "db-state.txt").read_text()).rstrip())

print("\n## Server log")
DROP = {"time", "pid", "hostname", "responseTime"}
for line in (raw / "server.log").read_text().splitlines():
    try:
        entry = json.loads(line)
    except json.JSONDecodeError:
        print("text:", mask(line))
        continue
    for k in DROP:
        entry.pop(k, None)
    res = entry.get("res", {})
    if isinstance(res, dict):
        res.get("headers", {}).pop("date", None)
        res.get("headers", {}).pop("etag", None)
    req = entry.get("req", {})
    if isinstance(req, dict):
        req.pop("remotePort", None)
    print(json.dumps(mask_value(entry), sort_keys=True))
