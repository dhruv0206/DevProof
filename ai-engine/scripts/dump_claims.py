import json
from pathlib import Path

p = Path(__file__).resolve().parent.parent / "diagnostic" / "reddit_calendar" / "regular_mode_full.json"
v4 = (json.load(open(p, encoding="utf-8")).get("v4_output") or {})
for i, c in enumerate(v4.get("claims", []), 1):
    print("=" * 78)
    print(f"CLAIM {i}")
    print("=" * 78)
    print(json.dumps(c, indent=2, default=str)[:4000])
    print()

print()
print("=" * 78)
print("Architecture (full)")
print("=" * 78)
arch = v4.get("architecture_features") or v4.get("architecture") or {}
print(json.dumps(arch, indent=2, default=str)[:3000])

print()
print("=" * 78)
print("Intent + standards (full)")
print("=" * 78)
intent = v4.get("intent_and_standards") or {}
print(json.dumps(intent, indent=2, default=str)[:3000])

print()
print("=" * 78)
print("Forensics (full)")
print("=" * 78)
print(json.dumps(v4.get("forensics") or {}, indent=2, default=str))
