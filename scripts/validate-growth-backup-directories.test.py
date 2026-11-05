"""Synthetic tar files; no production reads, extraction, remote downloads or writes."""
import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("validate-growth-backup-directories.py")
spec = importlib.util.spec_from_file_location("directory_validator", SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class DirectoryValidationTests(unittest.TestCase):
    def manifest(self, root="platforms", files=None):
        if files is None:
            files = {root + "/one.json": b'{"items":[]}'}
        return {"directoryRoots": [root, "history-ledger"], "directoryFiles": [
            {"relativePath": name, "snapshotFile": "directories/" + name,
             "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
            for name, body in files.items()]}

    def bundle(self, entries):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for name, kind, body in entries:
                member = tarfile.TarInfo(name)
                member.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    member.linkname = "/outside/evidence"
                if kind == tarfile.REGTYPE:
                    member.size = len(body)
                archive.addfile(member, io.BytesIO(body) if kind == tarfile.REGTYPE else None)
        return gzip.compress(raw.getvalue())

    def regular(self, root="platforms"):
        return [(root, tarfile.DIRTYPE, b""), (root + "/one.json", tarfile.REGTYPE, b'{"items":[]}')]

    def check(self, manifest, entries, root="platforms", mutate=None):
        raw = self.bundle(entries)
        if mutate:
            raw = mutate(raw)
        with tempfile.NamedTemporaryFile() as handle:
            handle.write(raw); handle.flush()
            return module.validate(manifest, root, handle.name)

    def test_exact_files_and_other_manifest_root(self):
        manifest = self.manifest(files={"platforms/one.json": b'{"items":[]}', "history-ledger/other.json": b"{}"})
        result = self.check(manifest, self.regular())
        self.assertEqual(result["files"], 1)
        self.assertEqual(result["bytes"], 12)

    def test_nested_root_paid_research(self):
        root = "paid-research/guaikei"
        result = self.check(self.manifest(root), self.regular(root), root)
        self.assertEqual(result["directoryRoot"], root)
        self.assertEqual(result["files"], 1)

    def test_empty_directory_and_zero_regular_file_are_valid(self):
        self.assertEqual(self.check(self.manifest(files={}), [("platforms", tarfile.DIRTYPE, b"")])["files"], 0)
        self.assertEqual(self.check(self.manifest(files={"platforms/empty.bin": b""}),
                                   [("platforms", tarfile.DIRTYPE, b""), ("platforms/empty.bin", tarfile.REGTYPE, b"")])["bytes"], 0)

    def test_missing_file(self):
        with self.assertRaisesRegex(ValueError, "missing_files"):
            self.check(self.manifest(), [("platforms", tarfile.DIRTYPE, b"")])

    def test_extra_file(self):
        with self.assertRaisesRegex(ValueError, "extra_file"):
            self.check(self.manifest(), self.regular() + [("platforms/extra", tarfile.REGTYPE, b"unexpected")])

    def test_missing_root_is_not_valid_empty_directory(self):
        with self.assertRaisesRegex(ValueError, "root_missing"):
            self.check(self.manifest(files={}), [])

    def test_duplicate_regular_and_directory(self):
        for entry in self.regular():
            with self.subTest(entry=entry[0]), self.assertRaisesRegex(ValueError, "duplicate_member"):
                self.check(self.manifest(), self.regular() + [entry])

    def test_links_and_special_types(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE, tarfile.BLKTYPE]:
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "member_type_invalid"):
                self.check(self.manifest(), self.regular() + [("platforms/danger", kind, b"")])

    def test_unsafe_paths_and_wrong_root(self):
        for name in ["platforms/../escape", "/platforms/file", "platforms/./file", "platforms//file", "platforms/back\\slash", "history-ledger/file", "platforms/file\n"]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "path_invalid"):
                self.check(self.manifest(), self.regular() + [(name, tarfile.REGTYPE, b"")])

    def test_size_and_hash_mismatch(self):
        for body, reason in [(b"short", "size_mismatch"), (b'{"items":{}}', "hash_mismatch")]:
            with self.subTest(body=body), self.assertRaisesRegex(ValueError, reason):
                self.check(self.manifest(), [("platforms", tarfile.DIRTYPE, b""), ("platforms/one.json", tarfile.REGTYPE, body)])

    def test_manifest_path_digest_and_duplicates_rejected(self):
        mutations = [lambda m: m["directoryFiles"][0].update(snapshotFile="../escape"),
                     lambda m: m["directoryFiles"][0].update(sha256="bad"),
                     lambda m: m["directoryFiles"].append(dict(m["directoryFiles"][0])),
                     lambda m: m["directoryFiles"][0].update(bytes=True),
                     lambda m: m.update(directoryRoots=["../outside"])]
        for mutate in mutations:
            manifest = self.manifest(); mutate(manifest)
            with self.subTest(manifest=manifest), self.assertRaisesRegex(ValueError, "manifest"):
                self.check(manifest, self.regular())

    def test_crc_and_truncation(self):
        def corrupt(raw):
            raw = bytearray(raw); raw[-8] ^= 1; return bytes(raw)
        for mutate in [corrupt, lambda raw: raw[:-6]]:
            with self.subTest(mutate=mutate), self.assertRaises((gzip.BadGzipFile, EOFError)):
                self.check(self.manifest(), self.regular(), mutate=mutate)

    def test_real_tar_command_and_cli_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "directories" / "paid-research" / "guaikei"
            source.mkdir(parents=True)
            (source / "one.json").write_bytes(b'{"items":[]}')
            manifest = root / "snapshot-manifest.json"
            manifest.write_text(json.dumps(self.manifest("paid-research/guaikei")))
            bundle = root / "archive.tar.gz"
            import os
            subprocess.run(["tar", "-C", str(root / "directories"), "-czf", str(bundle), "paid-research/guaikei"],
                           check=True, env={**os.environ, "COPYFILE_DISABLE": "1"})
            result = subprocess.run([sys.executable, str(SCRIPT), str(manifest), "paid-research/guaikei", str(bundle)],
                                    check=True, capture_output=True, text=True)
            self.assertEqual(json.loads(result.stdout)["files"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
