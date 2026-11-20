#!/usr/bin/env python3
"""Receive and deploy a release over an authenticated SSH connection."""

import fcntl
import hashlib
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path("/home/hoffma12/twc")
STATE = Path("/home/hoffma12/.twc-deploy")
INSTALLER = ROOT / "scripts/install-production.sh"
NODE_MODULES = Path("/home/hoffma12/nodevenv/twc/22/lib/node_modules")
ORIGINS = ("https://hitsdev.com", "https://www.hitsdev.com")
REQUIRED = {
    "app.js", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "server/index.ts", "dist/index.html",
}
MAX_ARCHIVE = 128 * 1024 * 1024
MAX_CONTENT = 256 * 1024 * 1024


class InstallerTerminationError(RuntimeError):
    pass


def fail(message):
    raise RuntimeError(message)


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def valid_name(name):
    if not re.fullmatch(r"[A-Za-z0-9._/-]+", name):
        return False
    parts = name.split("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in parts):
        return False
    if name in REQUIRED:
        return True
    if len(parts) == 2 and parts[0] == "server":
        return name.endswith(".ts") and not name.endswith(".test.ts")
    return len(parts) >= 2 and parts[0] == "dist"


def target(name):
    if not valid_name(name):
        fail("Invalid managed path: " + name)
    path = ROOT / name
    for parent in (path,) + tuple(path.parents):
        if parent == ROOT:
            break
        if parent.is_symlink():
            fail("Managed path contains a symbolic link: " + name)
    if path.exists() and not path.is_file():
        fail("Managed path is not a regular file: " + name)
    return path


def atomic_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".twc-deploy-", dir=str(destination.parent))
    try:
        with os.fdopen(fd, "wb") as output, source.open("rb") as input_file:
            shutil.copyfileobj(input_file, output)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, stat.S_IMODE(source.stat().st_mode))
        os.replace(temporary, str(destination))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def atomic_text(destination, text):
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".twc-deploy-", dir=str(destination.parent))
    try:
        with os.fdopen(fd, "w") as output:
            output.write(text)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, str(destination))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def verify_installer(expected):
    if INSTALLER.is_symlink() or not INSTALLER.is_file():
        fail("The production installer must be a regular file")
    for path in (INSTALLER, INSTALLER.parent, ROOT):
        if path.is_symlink():
            fail("Installer path contains a symbolic link: " + str(path))
        info = path.stat()
        if info.st_uid != os.getuid() or info.st_mode & 0o022:
            fail("Unsafe installer ownership or write permissions: " + str(path))
    if digest(INSTALLER) != expected:
        fail("The production installer hash does not match the approved hash")


def unpack(archive, directory):
    names = set()
    total = 0
    with tarfile.open(str(archive), "r:gz") as source:
        for member in source:
            name = member.name
            if not member.isfile() or not valid_name(name) or name in names:
                fail("Unsafe or duplicate archive entry: " + name)
            names.add(name)
            total += member.size
            if total > MAX_CONTENT or len(names) > 2000:
                fail("Release archive exceeds size or file-count limits")
            output = directory / name
            output.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as content, output.open("xb") as dest:
                shutil.copyfileobj(content, dest)
            os.chmod(str(output), 0o644)
    if not REQUIRED.issubset(names):
        fail("Release archive is missing required files")
    return names


def read_manifest(path):
    if path.is_symlink():
        fail("Deployment manifest is not a regular file")
    if not path.exists():
        return set()
    if not path.is_file():
        fail("Deployment manifest is not a regular file")
    data = json.loads(path.read_text())
    if not isinstance(data, list) or not all(isinstance(n, str) and valid_name(n) for n in data):
        fail("Invalid deployment manifest")
    return set(data)


def request_json(url):
    request = urllib.request.Request(
        url, headers={"User-Agent": "Mozilla/5.0", "Cache-Control": "no-cache"}
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            fail("Unexpected HTTP status from " + url)
        actual = urllib.parse.urlsplit(response.geturl())
        expected = urllib.parse.urlsplit(url)
        if actual.scheme != "https" or actual.netloc != expected.netloc:
            fail("Health check redirected to a different origin: " + url)
        return json.loads(response.read(4096).decode("utf-8"))


def verify_release(release):
    last_error = None
    for attempt in range(12):
        try:
            for origin in ORIGINS:
                if request_json(origin + "/api/health") != {"status": "ok"}:
                    fail("Unexpected health response from " + origin)
                if release is not None and request_json(origin + "/api/release") != {"release": release}:
                    fail("Unexpected release identifier from " + origin)
            return
        except (OSError, ValueError, RuntimeError) as error:
            last_error = error
            if attempt < 11:
                time.sleep(5)
    fail("Release verification failed: " + str(last_error))


def restart_marker():
    marker = ROOT / "tmp/restart.txt"
    if (marker.is_symlink() or not marker.is_file() or marker.parent.is_symlink()
            or not os.access(str(marker), os.W_OK)):
        fail("Passenger restart marker is missing or unsafe")
    return marker


def restart():
    os.utime(str(restart_marker()), None)


def install(expected):
    verify_installer(expected)
    process = subprocess.Popen(
        ["/bin/bash", str(INSTALLER)], cwd=str(ROOT), start_new_session=True
    )
    try:
        status = process.wait()
    except BaseException:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError as error:
            raise InstallerTerminationError(
                "Could not stop the installer; manual recovery is required"
            ) from error
        process.wait()
        raise
    if status:
        raise subprocess.CalledProcessError(status, process.args)
    if not (ROOT / "node_modules").is_symlink() or (ROOT / "node_modules").resolve() != NODE_MODULES.resolve():
        fail("The managed node_modules link changed during installation")


def deploy(commit, archive_hash, installer_hash):
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        fail("Invalid commit identifier")
    if not all(re.fullmatch(r"[0-9a-f]{64}", v) for v in (archive_hash, installer_hash)):
        fail("Invalid SHA-256 identifier")
    if ROOT.is_symlink() or not ROOT.is_dir():
        fail("Application root is missing or is a symbolic link")
    if not (ROOT / "node_modules").is_symlink() or (ROOT / "node_modules").resolve() != NODE_MODULES.resolve():
        fail("Unexpected cPanel-managed node_modules link")
    if not NODE_MODULES.is_dir():
        fail("The cPanel-managed dependency directory is missing")
    verify_installer(installer_hash)

    STATE.mkdir(mode=0o700, exist_ok=True)
    state_stat = STATE.lstat()
    if not stat.S_ISDIR(state_stat.st_mode) or state_stat.st_uid != os.getuid() or state_stat.st_mode & 0o077:
        fail("Deployment state directory is not private")
    fd = os.open(str(STATE / "deployment.lock"), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("Another deployment holds the server-side lock")
        execute_locked(commit, archive_hash, installer_hash)


def execute_locked(commit, archive_hash, installer_hash):
    journal = STATE / "in-progress.json"
    manifest = STATE / "manifest.json"
    marker = ROOT / ".twc-release"
    if journal.exists() or journal.is_symlink():
        fail("An unfinished deployment requires manual recovery: " + str(journal))
    if marker.is_symlink() or (marker.exists() and not marker.is_file()):
        fail("Release marker is not a regular file")
    previous_release = marker.read_text().strip() if marker.exists() else None
    if previous_release is not None and not re.fullmatch(r"[0-9a-f]{40}", previous_release):
        fail("Invalid previous release identifier")
    previous = read_manifest(manifest)
    manifest_existed = manifest.exists()
    restart_marker()
    verify_release(previous_release)
    with tempfile.TemporaryDirectory(prefix="stage-", dir=str(STATE)) as stage_name:
        stage = Path(stage_name)
        archive = stage / "release.tar.gz"
        size = 0
        with archive.open("wb") as output:
            while True:
                chunk = sys.stdin.buffer.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_ARCHIVE:
                    fail("Release archive exceeds size limit")
                output.write(chunk)
        if digest(archive) != archive_hash:
            fail("Transferred archive hash does not match")
        if shutil.disk_usage(str(ROOT)).free < MAX_CONTENT + size:
            fail("Insufficient filesystem free space for deployment")
        staged = stage / "files"
        staged.mkdir()
        incoming = unpack(archive, staged)
        removed = {name for name in previous - incoming if not name.startswith("dist/assets/")}
        affected = incoming | removed
        for name in affected:
            target(name)
        backups = STATE / "backups"
        backups.mkdir(mode=0o700, exist_ok=True)
        if backups.is_symlink() or not backups.is_dir():
            fail("Backup directory is unsafe")
        backup = Path(tempfile.mkdtemp(prefix=commit[:12] + "-", dir=str(backups)))
        existed = []
        for name in sorted(affected):
            original = target(name)
            if original.exists():
                saved = backup / "files" / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(str(original), str(saved))
                if digest(original) != digest(saved):
                    fail("Backup verification failed: " + name)
                existed.append(name)
        if not {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"}.issubset(existed):
            fail("Existing dependency files are missing; cannot prepare rollback")
        record = {"backup": str(backup), "affected": sorted(affected), "existed": existed,
                  "previous_release": previous_release, "previous_manifest": sorted(previous),
                  "manifest_existed": manifest_existed}
        atomic_text(backup / "recovery.json", json.dumps(record, indent=2) + "\n")
        atomic_text(journal, json.dumps(record, indent=2) + "\n")
        touched = set()
        installation_started = False
        try:
            for name in sorted(incoming):
                touched.add(name)
                destination = target(name)
                if destination.exists():
                    os.chmod(str(staged / name), stat.S_IMODE(destination.stat().st_mode))
                atomic_copy(staged / name, destination)
            for name in sorted(removed):
                path = target(name)
                if path.exists():
                    touched.add(name)
                    path.unlink()
            atomic_text(marker, commit + "\n")
            installation_started = True
            install(installer_hash)
            restart()
            verify_release(commit)
            atomic_text(manifest, json.dumps(sorted(incoming), indent=2) + "\n")
            journal.unlink()
            print("Deployment verified for commit " + commit)
            print("Private rollback backup: " + str(backup))
        except BaseException as error:
            print("Deployment failed: " + str(error), file=sys.stderr)
            if isinstance(error, InstallerTerminationError):
                print("Installer may still be running; recovery record: " + str(journal), file=sys.stderr)
                raise
            print("Attempting rollback", file=sys.stderr)
            try:
                for name in sorted(touched):
                    path = target(name)
                    if name in existed:
                        atomic_copy(backup / "files" / name, path)
                    elif path.exists():
                        path.unlink()
                if previous_release is None:
                    if marker.exists():
                        marker.unlink()
                else:
                    atomic_text(marker, previous_release + "\n")
                if manifest_existed:
                    atomic_text(manifest, json.dumps(sorted(previous), indent=2) + "\n")
                elif manifest.exists():
                    manifest.unlink()
                if installation_started:
                    install(installer_hash)
                restart()
                verify_release(previous_release)
                if previous_release is None:
                    fail("Previous release has no identity; manual verification is required")
                journal.unlink()
                print("Previous release restored and verified", file=sys.stderr)
            except BaseException as rollback_error:
                print("Rollback incomplete; manual recovery required: " + str(rollback_error), file=sys.stderr)
                print("Recovery record: " + str(journal), file=sys.stderr)
            raise


def interrupted(signum, _frame):
    raise RuntimeError("Deployment interrupted by signal " + str(signum))


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    if len(sys.argv) != 4:
        sys.exit("Usage: remote.py COMMIT ARCHIVE_SHA256 INSTALLER_SHA256")
    try:
        deploy(*sys.argv[1:])
    except Exception as error:
        print("Deployment error: " + str(error), file=sys.stderr)
        sys.exit(1)
