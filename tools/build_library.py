#!/usr/bin/env python3
"""Write library.json, the index of the library that clients read.

    tools/build_library.py            # write library.json
    tools/build_library.py --check    # exit 1 when library.json is not what this would write

Every .yaml under sensors/ and stimuli/ is one entry: {path, name, kind, label}, sorted by
path; a stimulus has kind "stimulus". The version is the library's release (vX.Y.Z tags).
Python standard library only (tools/yaml2json.py reads the YAML).
"""
import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import yaml2json  # noqa: E402

VERSION = "0.1.0"
FORMAT = 1
OUT = os.path.join(ROOT, "library.json")


def entries():
    out = []
    for top in ("sensors", "stimuli"):
        for d, _, files in os.walk(os.path.join(ROOT, top)):
            for f in files:
                if not f.endswith(".yaml"):
                    continue
                path = os.path.relpath(os.path.join(d, f), ROOT).replace(os.sep, "/")
                doc = yaml2json.convert(os.path.join(ROOT, path))
                for key in ("name", "kind"):
                    if not isinstance(doc.get(key), str):
                        sys.exit(f"{path}: no {key}")
                out.append({"path": path, "name": doc["name"], "kind": doc["kind"],
                            "label": doc.get("label") or ""})
    return sorted(out, key=lambda e: e["path"])


def render():
    lib = {"format": FORMAT, "version": VERSION, "entries": entries()}
    return json.dumps(lib, indent=2) + "\n", len(lib["entries"])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="fail when library.json is stale")
    a = ap.parse_args()
    text, n = render()
    if a.check:
        try:
            with open(OUT, encoding="utf-8") as f:
                current = f.read()
        except FileNotFoundError:
            current = ""
        if current != text:
            sys.exit("library.json is stale: run tools/build_library.py and commit it")
        print(f"library.json is up to date ({n} entries)")
        return
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"wrote library.json ({n} entries)")


if __name__ == "__main__":
    main()
