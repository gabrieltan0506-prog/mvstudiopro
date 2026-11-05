#!/usr/bin/env python3
"""Read-only tar.gz validation against a snapshot's exact directory inventory.

Usage: validate-growth-backup-directories.py snapshot-manifest.json directoryRoot archive.tar.gz
No extraction or network access. Empty directories and listed zero-byte regular
files are legitimate; missing files, links and unsupported members are not.
"""
import gzip
import hashlib
import json
import re
import sys
import tarfile


def safe_relative(value):
    return (isinstance(value, str) and bool(value) and not value.startswith("/")
            and "\\" not in value and not any(ord(c) < 32 or ord(c) == 127 for c in value)
            and all(part not in ("", ".", "..") for part in value.split("/")))


def beneath(name, root):
    return name.startswith(root + "/")


def expected_inventory(manifest, root):
    roots = manifest.get("directoryRoots") if isinstance(manifest, dict) else None
    rows = manifest.get("directoryFiles") if isinstance(manifest, dict) else None
    if (not safe_relative(root) or not isinstance(roots, list) or not roots
            or any(not safe_relative(value) for value in roots)
            or len(set(roots)) != len(roots) or root not in roots or not isinstance(rows, list)):
        raise ValueError("backup_directory_manifest_invalid")
    seen = set()
    wanted = {}
    for row in rows:
        name = row.get("relativePath") if isinstance(row, dict) else None
        if (not safe_relative(name) or name in seen
                or not any(beneath(name, directory) for directory in roots)
                or row.get("snapshotFile") != "directories/" + name
                or type(row.get("bytes")) is not int or row["bytes"] < 0
                or not isinstance(row.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", row["sha256"]) is None):
            raise ValueError("backup_directory_manifest_file_invalid:" + str(name))
        seen.add(name)
        if beneath(name, root):
            wanted[name] = {"relativePath": name, "bytes": row["bytes"], "sha256": row["sha256"]}
    return wanted


def validate(manifest, root, archive_path):
    wanted = expected_inventory(manifest, root)
    seen_members, seen_files = set(), set()
    root_present = False
    total = 0
    with open(archive_path, "rb") as raw, gzip.GzipFile(fileobj=raw) as zipped:
        with tarfile.open(fileobj=zipped, mode="r|") as archive:
            for member in archive:
                # Strip one conventional directory slash only; reject alternate path spellings.
                name = member.name[:-1] if member.isdir() and member.name.endswith("/") else member.name
                if not safe_relative(name) or (name != root and not beneath(name, root)):
                    raise ValueError("backup_directory_path_invalid:" + name)
                if name in seen_members:
                    raise ValueError("backup_directory_duplicate_member:" + name)
                seen_members.add(name)
                if member.isdir():
                    if name in wanted:
                        raise ValueError("backup_directory_file_became_directory:" + name)
                    root_present = root_present or name == root
                    continue
                if not member.isfile() or member.issparse():
                    raise ValueError("backup_directory_member_type_invalid:" + name)
                if name not in wanted:
                    raise ValueError("backup_directory_extra_file:" + name)
                expected = wanted[name]
                if member.size != expected["bytes"]:
                    raise ValueError("backup_directory_size_mismatch:" + name)
                digest = hashlib.sha256()
                size = 0
                with archive.extractfile(member) as source:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        size += len(chunk)
                        digest.update(chunk)
                if size != expected["bytes"] or digest.hexdigest() != expected["sha256"]:
                    raise ValueError("backup_directory_hash_mismatch:" + name)
                total += size
                seen_files.add(name)
        # Force the gzip CRC/footer to be consumed even after tar reaches its EOF.
        while True:
            tail = zipped.read(1024 * 1024)
            if not tail:
                break
            if any(tail):
                raise ValueError("backup_directory_trailing_content")
    if not root_present:
        raise ValueError("backup_directory_root_missing:" + root)
    missing = sorted(set(wanted) - seen_files)
    if missing:
        raise ValueError("backup_directory_missing_files:" + ",".join(missing))
    return {"schemaVersion": 1, "directoryRoot": root, "files": len(seen_files),
            "bytes": total, "inventory": [wanted[name] for name in sorted(wanted)]}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 4:
            raise ValueError("usage: snapshot-manifest.json directoryRoot archive.tar.gz")
        with open(sys.argv[1], encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        print(json.dumps(validate(manifest, sys.argv[2], sys.argv[3]), ensure_ascii=False))
    except Exception as error:
        print("Growth directory backup validation failed: " + str(error), file=sys.stderr)
        sys.exit(1)
