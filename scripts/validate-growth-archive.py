#!/usr/bin/env python3
"""只读验证归档或顺序分片；不解包到磁盘，不访问网络。"""
import hashlib
import gzip
import io
import json
import re
import sys
import tarfile


class PartsReader(io.RawIOBase):
    def __init__(self, paths):
        self.paths = iter(paths)
        self.current = None

    def readable(self):
        return True

    def readinto(self, buf):
        while True:
            if self.current is None:
                try:
                    self.current = open(next(self.paths), "rb")
                except StopIteration:
                    return 0
            count = self.current.readinto(buf)
            if count:
                return count
            self.current.close()
            self.current = None

    def close(self):
        if self.current:
            self.current.close()
        super().close()


def validate(directory, paths):
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:-\d{2})?", directory) or not paths:
        raise ValueError("archive_directory_invalid")
    seen = set()
    files = items = logical_bytes = 0
    inventory = []
    with PartsReader(paths) as parts, io.BufferedReader(parts) as raw, gzip.GzipFile(fileobj=raw) as zipped:
        with tarfile.open(fileobj=zipped, mode="r|") as archive:
            for member in archive:
                name = member.name.rstrip("/")
                components = name.split("/")
                if (not name or name.startswith("/") or "\\" in name
                        or any(c in ("", ".", "..") for c in components)
                        or any(ord(c) < 32 for c in name)
                        or not (name == directory or name.startswith(directory + "/"))):
                    raise ValueError("archive_path_invalid:" + name)
                if name in seen:
                    raise ValueError("archive_duplicate_member:" + name)
                seen.add(name)
                if member.isdir():
                    continue
                if not member.isfile() or not name.endswith(".json.gz") or member.size <= 0:
                    raise ValueError("archive_member_invalid:" + name)
                with archive.extractfile(member) as source:
                    compressed = source.read()
                with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as payload:
                    # 与生产恢复器相同的 items 数组契约；空数组可合法表示该平台无结果。
                    value = json.load(io.TextIOWrapper(payload, encoding="utf-8"))
                if not isinstance(value, dict) or not isinstance(value.get("items"), list):
                    raise ValueError("archive_json_invalid:" + name)
                inventory.append({"path": name[len(directory)+1:], "bytes": member.size, "sha256": hashlib.sha256(compressed).hexdigest(), "items": len(value["items"])})
                files += 1
                items += len(value["items"])
                logical_bytes += member.size
        # tar 在末尾零块停止；继续读完整 gzip 尾部，拒绝 CRC 错误和拼接的隐藏内容。
        while True:
            rest = zipped.read(1024 * 1024)
            if not rest:
                break
            if any(rest):
                raise ValueError("archive_trailing_content")
    if files == 0:
        raise ValueError("archive_content_empty:" + directory)
    return {"dir": directory, "files": files, "items": items, "logicalBytes": logical_bytes, "inventory": sorted(inventory, key=lambda row: row["path"])}


if __name__ == "__main__":
    try:
        print(json.dumps(validate(sys.argv[1], sys.argv[2:]), ensure_ascii=False))
    except Exception as error:
        print("归档发布前验证失败: " + str(error), file=sys.stderr)
        sys.exit(1)
