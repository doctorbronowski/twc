import hashlib
import importlib.util
import io
import json
import subprocess
import tarfile
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


SPEC = importlib.util.spec_from_file_location("deploy_remote", Path(__file__).with_name("remote.py"))
REMOTE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REMOTE)


def archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as result:
        for name, contents in entries.items():
            item = tarfile.TarInfo(name)
            item.size = len(contents)
            result.addfile(item, io.BytesIO(contents))
    return output.getvalue()


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        base = Path(self.temporary.name)
        self.root = base / "twc"
        self.root.mkdir()
        self.state = base / "state"
        self.modules = base / "modules"
        self.modules.mkdir()
        (self.root / "node_modules").symlink_to(self.modules)
        self.installer = self.root / "scripts" / "install-production.sh"
        self.installer.parent.mkdir()
        self.installer.write_text("#!/bin/sh\n")
        self.installer.chmod(0o644)
        self.installer_hash = REMOTE.digest(self.installer)
        self.old = "b" * 40
        self.new = "a" * 40
        self.entries = {name: ("new " + name).encode() for name in REMOTE.REQUIRED}
        self.entries["server/added.ts"] = b"new server file"
        self.entries["dist/assets/new.js"] = b"new asset"
        for name in REMOTE.REQUIRED:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(("old " + name).encode())
        (self.root / "pnpm-workspace.yaml").chmod(0o600)
        (self.root / ".twc-release").write_text(self.old + "\n")
        (self.root / "tmp").mkdir()
        (self.root / "tmp/restart.txt").touch()
        (self.root / "server/deleted.ts").write_text("old file")
        (self.root / "server/unmanaged.ts").write_text("do not remove")
        old_asset = self.root / "dist/assets/old.js"
        old_asset.parent.mkdir(parents=True, exist_ok=True)
        old_asset.write_text("old asset")
        self.state.mkdir(mode=0o700)
        self.old_manifest = sorted(REMOTE.REQUIRED | {"server/deleted.ts", "dist/assets/old.js"})
        (self.state / "manifest.json").write_text(json.dumps(self.old_manifest))
        patches = mock.patch.multiple(
            REMOTE, ROOT=self.root, STATE=self.state, INSTALLER=self.installer,
            NODE_MODULES=self.modules
        )
        patches.start()
        self.addCleanup(patches.stop)
        self.payload = archive(self.entries)

    def deploy(self, payload=None):
        payload = self.payload if payload is None else payload
        stdin = types.SimpleNamespace(buffer=io.BytesIO(payload))
        with mock.patch.object(REMOTE.sys, "stdin", stdin):
            REMOTE.deploy(self.new, hashlib.sha256(payload).hexdigest(), self.installer_hash)

    def test_promotes_only_managed_files_and_preserves_old_assets(self):
        with mock.patch.object(REMOTE, "install") as install, \
             mock.patch.object(REMOTE, "restart") as restart, \
             mock.patch.object(REMOTE, "verify_release") as verify:
            self.deploy()
        self.assertEqual((self.root / "app.js").read_bytes(), self.entries["app.js"])
        self.assertFalse((self.root / "server/deleted.ts").exists())
        self.assertEqual((self.root / "server/unmanaged.ts").read_text(), "do not remove")
        self.assertEqual((self.root / "dist/assets/old.js").read_text(), "old asset")
        self.assertEqual((self.root / "pnpm-workspace.yaml").stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.root / ".twc-release").read_text().strip(), self.new)
        self.assertEqual(set(json.loads((self.state / "manifest.json").read_text())), set(self.entries))
        self.assertFalse((self.state / "in-progress.json").exists())
        install.assert_called_once_with(self.installer_hash)
        restart.assert_called_once()
        self.assertEqual(verify.call_args_list, [mock.call(self.old), mock.call(self.new)])

    def test_install_failure_restores_previous_release_and_dependencies(self):
        failure = subprocess.CalledProcessError(1, "installer")
        with mock.patch.object(REMOTE, "install", side_effect=[failure, None]) as install, \
             mock.patch.object(REMOTE, "restart"), \
             mock.patch.object(REMOTE, "verify_release") as verify:
            with self.assertRaises(subprocess.CalledProcessError):
                self.deploy()
        self.assertEqual((self.root / "app.js").read_bytes(), b"old app.js")
        self.assertEqual((self.root / "server/deleted.ts").read_text(), "old file")
        self.assertFalse((self.root / "server/added.ts").exists())
        self.assertEqual((self.root / ".twc-release").read_text().strip(), self.old)
        self.assertEqual(json.loads((self.state / "manifest.json").read_text()), self.old_manifest)
        self.assertFalse((self.state / "in-progress.json").exists())
        self.assertEqual(install.call_count, 2)
        self.assertEqual(verify.call_args_list, [mock.call(self.old), mock.call(self.old)])

    def test_rejects_traversal_before_live_files_change(self):
        payload = archive(dict(self.entries, **{"../escape": b"bad"}))
        with mock.patch.object(REMOTE, "verify_release"):
            with self.assertRaisesRegex(RuntimeError, "Unsafe or duplicate"):
                self.deploy(payload)
        self.assertEqual((self.root / "app.js").read_bytes(), b"old app.js")
        self.assertFalse((self.state / "in-progress.json").exists())

    def test_unverified_first_release_leaves_recovery_record_after_rollback(self):
        (self.root / ".twc-release").unlink()
        with mock.patch.object(REMOTE, "install", side_effect=[RuntimeError("failed"), None]), \
             mock.patch.object(REMOTE, "restart"), \
             mock.patch.object(REMOTE, "verify_release"):
            with self.assertRaisesRegex(RuntimeError, "failed"):
                self.deploy()
        self.assertEqual((self.root / "app.js").read_bytes(), b"old app.js")
        self.assertFalse((self.root / ".twc-release").exists())
        self.assertTrue((self.state / "in-progress.json").is_file())

    def test_refuses_modified_installer_before_changing_files(self):
        self.installer.write_text("changed")
        with self.assertRaisesRegex(RuntimeError, "installer hash"):
            self.deploy()
        self.assertEqual((self.root / "app.js").read_bytes(), b"old app.js")

    def test_runs_verified_installer(self):
        self.installer.write_text("#!/bin/sh\nexit 0\n")
        REMOTE.install(REMOTE.digest(self.installer))

    def test_refuses_symlinked_live_file(self):
        (self.root / "app.js").unlink()
        (self.root / "app.js").symlink_to(self.root / "server/unmanaged.ts")
        with mock.patch.object(REMOTE, "verify_release"):
            with self.assertRaisesRegex(RuntimeError, "symbolic link"):
                self.deploy()
        self.assertEqual((self.root / "server/unmanaged.ts").read_text(), "do not remove")
        self.assertFalse((self.state / "in-progress.json").exists())

    def test_refuses_archive_hash_mismatch(self):
        stdin = types.SimpleNamespace(buffer=io.BytesIO(self.payload))
        with mock.patch.object(REMOTE.sys, "stdin", stdin), \
             mock.patch.object(REMOTE, "verify_release"):
            with self.assertRaisesRegex(RuntimeError, "archive hash"):
                REMOTE.deploy(self.new, "f" * 64, self.installer_hash)
        self.assertEqual((self.root / "app.js").read_bytes(), b"old app.js")
        self.assertFalse((self.state / "in-progress.json").exists())

    def test_failed_release_verification_rolls_back(self):
        with mock.patch.object(REMOTE, "install") as install, \
             mock.patch.object(REMOTE, "restart") as restart, \
             mock.patch.object(REMOTE, "verify_release", side_effect=[None, RuntimeError("unhealthy"), None]):
            with self.assertRaisesRegex(RuntimeError, "unhealthy"):
                self.deploy()
        self.assertEqual((self.root / "app.js").read_bytes(), b"old app.js")
        self.assertEqual((self.root / ".twc-release").read_text().strip(), self.old)
        self.assertFalse((self.state / "in-progress.json").exists())
        self.assertEqual(install.call_count, 2)
        self.assertEqual(restart.call_count, 2)


if __name__ == "__main__":
    unittest.main()
