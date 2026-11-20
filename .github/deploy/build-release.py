#!/usr/bin/env python3
import os
import subprocess
import sys
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REQUIRED = {"app.js", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"}
EXCLUDED = {"server/bootstrapOwner.ts", "server/setupDatabase.ts"}


def build(destination):
    tracked = subprocess.check_output(
        ["git", "ls-files", "-z", "--", "server"], cwd=ROOT
    ).decode().split("\0")
    files = set(REQUIRED)
    files.update(
        name for name in tracked
        if name.endswith(".ts") and not name.endswith(".test.ts") and name not in EXCLUDED
    )
    for directory, _, filenames in os.walk(ROOT / "dist", followlinks=False):
        for filename in filenames:
            files.add(str((Path(directory) / filename).relative_to(ROOT)))
    if "server/index.ts" not in files or "dist/index.html" not in files:
        raise ValueError("Required server entry point or frontend build is missing")
    with tarfile.open(destination, "w:gz") as archive:
        for name in sorted(files):
            file = ROOT / name
            if file.is_symlink() or not file.is_file():
                raise ValueError("Release file is missing or is a link: " + name)
            archive.add(file, arcname=name, recursive=False)
            print(name)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: build-release.py ARCHIVE")
    build(sys.argv[1])
