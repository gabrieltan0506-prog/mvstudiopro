"""真实 tar/gzip 异常输入回归；全部数据均为隔离夹具。"""
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('validator', Path(__file__).with_name('validate-growth-archive.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
DIR = '2026-09-11-01'

class ArchiveValidationTests(unittest.TestCase):
    def bundle(self, members):
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode='w') as archive:
            for name, kind, body in members:
                entry = tarfile.TarInfo(name)
                entry.type = kind
                if kind in (tarfile.SYMTYPE, tarfile.LNKTYPE):
                    entry.linkname = '/outside/valuable'
                if kind == tarfile.REGTYPE:
                    entry.size = len(body)
                archive.addfile(entry, io.BytesIO(body) if kind == tarfile.REGTYPE else None)
        return gzip.compress(raw.getvalue())

    def validate(self, raw):
        with tempfile.NamedTemporaryFile() as f:
            f.write(raw); f.flush()
            return module.validate(DIR, [f.name])

    def normal(self):
        return (DIR + '/items.json.gz', tarfile.REGTYPE, gzip.compress(b'{"items":[{"id":"test"}]}'))

    def test_path_traversal_absolute_and_wrong_root(self):
        for name in [DIR + '/../escape.json.gz', '/absolute.json.gz', 'wrong/items.json.gz', DIR + '/./items.json.gz']:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'archive_path_invalid'):
                self.validate(self.bundle([(name, *self.normal()[1:])]))

    def test_duplicate_member(self):
        with self.assertRaisesRegex(ValueError, 'archive_duplicate_member'):
            self.validate(self.bundle([self.normal(), self.normal()]))

    def test_link_and_special_file(self):
        for kind in [tarfile.SYMTYPE, tarfile.LNKTYPE, tarfile.FIFOTYPE, tarfile.CHRTYPE]:
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, 'archive_member_invalid'):
                self.validate(self.bundle([self.normal(), (DIR + '/danger', kind, b'')]))

    def test_nested_empty_directories(self):
        with self.assertRaisesRegex(ValueError, 'archive_content_empty'):
            self.validate(self.bundle([(DIR, tarfile.DIRTYPE, b''), (DIR + '/nested', tarfile.DIRTYPE, b'')]))

    def test_zero_file_and_unsupported_file(self):
        for name, body in [(DIR + '/zero.json.gz', b''), (DIR + '/readme.txt', b'data')]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'archive_member_invalid'):
                self.validate(self.bundle([(name, tarfile.REGTYPE, body)]))

    def test_truncated_outer_gzip(self):
        with self.assertRaises(EOFError):
            self.validate(self.bundle([self.normal()])[:-6])

    def test_bad_outer_crc(self):
        raw = bytearray(self.bundle([self.normal()])); raw[-8] ^= 1
        with self.assertRaises(gzip.BadGzipFile):
            self.validate(raw)

    def test_normal_nested_and_empty_items_contract(self):
        raw = self.bundle([(DIR + '/nested/data.json.gz', tarfile.REGTYPE, gzip.compress(b'{"items":[]}')), self.normal()])
        self.assertEqual(self.validate(raw)['files'], 2)

if __name__ == '__main__':
    unittest.main(verbosity=2)
