#!/usr/bin/env python3
"""Offline bake of color-fx presets into .cube LUTs + manifest.json.

Usage (from repo root):
    pip install color-fx==0.1.2 --break-system-packages
    python3 server/assets/luts/bake_luts.py

Deterministic: no network, no paid calls. Requires Python>=3.10.
"""
from __future__ import annotations

import json
from importlib.metadata import version
from pathlib import Path

import numpy as np
from color_fx.color_math.matrices import apply_matrix, saturation_matrix, temperature_matrix
from color_fx.config import GradeConfig
from color_fx.lut.bake import bake_lut
from color_fx.resolver import resolve

OUT = Path(__file__).resolve().parent
SIZE = 33
CFX_VERSION = version("color-fx")
SOURCE = f"color-fx {CFX_VERSION} MIT"

# (id, color-fx catalog slug, labelZh, category, intensity)
CATALOG = [
    # cinematic grades: subtle (0.35) + standard (0.7); bold skipped
    ("nordic_desaturation_subtle", "nordic_desaturation_subtle", "北欧冷灰低饱和-轻", "cinematic", "subtle"),
    ("nordic_desaturation_standard", "nordic_desaturation_standard", "北欧冷灰低饱和-标准", "cinematic", "standard"),
    ("golden_hour_subtle", "golden_hour_subtle", "暖阳黄昏-轻", "cinematic", "subtle"),
    ("golden_hour_standard", "golden_hour_standard", "暖阳黄昏-标准", "cinematic", "standard"),
    ("neo_noir_subtle", "neo_noir_subtle", "暗调黑色电影-轻", "cinematic", "subtle"),
    ("neo_noir_standard", "neo_noir_standard", "暗调黑色电影-标准", "cinematic", "standard"),
    ("cyberpunk_neon_subtle", "cyberpunk_neon_subtle", "赛博霓虹雨夜-轻", "cinematic", "subtle"),
    ("cyberpunk_neon_standard", "cyberpunk_neon_standard", "赛博霓虹雨夜-标准", "cinematic", "standard"),
    ("dream_sequence_subtle", "dream_sequence_subtle", "梦境柔光低对比-轻", "cinematic", "subtle"),
    ("dream_sequence_standard", "dream_sequence_standard", "梦境柔光低对比-标准", "cinematic", "standard"),
    ("vintage_film_fade_subtle", "vintage_film_fade_subtle", "复古褪色回忆-轻", "cinematic", "subtle"),
    ("vintage_film_fade_standard", "vintage_film_fade_standard", "复古褪色回忆-标准", "cinematic", "standard"),
    # film-stock approximations (primary color only, grain/halation not baked)
    ("film_warm_print", "warm_print_film", "暖调印片胶片（近似，非实测）", "film_stock", "standard"),
    ("film_punchy_consumer", "punchy_consumer_film", "鲜艳民用胶片（近似，非实测）", "film_stock", "standard"),
    ("film_35mm_prestige", "35mm_prestige", "35mm 院线胶片质感（近似，非实测）", "film_stock", "standard"),
    ("film_super8", "super_8_film", "Super 8 怀旧家庭录像（近似，非实测）", "film_stock", "standard"),
    # basic building block from catalog
    ("basic_split_tone_teal_orange", "split_toning", "基础-冷暗暖亮分离色调", "basic", "standard"),
]

# Basic warm/cool/desaturate pieces built from color-fx color_math primitives.
BASIC_FNS = [
    ("basic_warm", "基础-整体偏暖", "basic", "standard",
     lambda p: apply_matrix(p, temperature_matrix(+600.0))),
    ("basic_cool", "基础-整体偏冷", "basic", "standard",
     lambda p: apply_matrix(p, temperature_matrix(-600.0))),
    ("basic_desaturate", "基础-压饱和（75%）", "basic", "standard",
     lambda p: apply_matrix(p, saturation_matrix(0.75))),
]


def write_cube_spec(lut, path: Path, title: str) -> None:
    """Write .cube with RED index fastest (Adobe/Resolve/ffmpeg spec).

    color-fx 0.1.2 `write_cube` emits BLUE-fastest order, which ffmpeg/Resolve
    read with R and B swapped (identity LUT -> MAD 40/255 on colour bars).
    data is indexed [r, g, b]; transpose to [b, g, r] so r iterates fastest.
    """
    flat = lut.data.transpose(2, 1, 0, 3).reshape(-1, 3)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(f'TITLE "{title}"\n')
        fh.write(f"LUT_3D_SIZE {lut.size}\n")
        fh.write("DOMAIN_MIN 0.0 0.0 0.0\nDOMAIN_MAX 1.0 1.0 1.0\n")
        for r, g, b in flat:
            fh.write(f"{r:.6f} {g:.6f} {b:.6f}\n")


def catalog_fn(slug: str):
    engine, _params = resolve(slug)
    return engine.get_color_fn(slug, GradeConfig(grade=slug))


def main() -> None:
    manifest = []
    for lut_id, slug, label, cat, inten in CATALOG:
        path = OUT / f"{lut_id}.cube"
        lut = bake_lut(catalog_fn(slug), size=SIZE, title=lut_id)
        write_cube_spec(lut, path, lut_id)
        manifest.append({"id": lut_id, "labelZh": label, "category": cat, "intensity": inten,
                         "source": SOURCE, "colorFxSlug": slug, "file": path.name,
                         "sizeBytes": path.stat().st_size})
    for lut_id, label, cat, inten, fn in BASIC_FNS:
        path = OUT / f"{lut_id}.cube"
        lut = bake_lut(lambda p, fn=fn: fn(p.astype(np.float32)), size=SIZE, title=lut_id)
        write_cube_spec(lut, path, lut_id)
        manifest.append({"id": lut_id, "labelZh": label, "category": cat, "intensity": inten,
                         "source": SOURCE, "colorFxSlug": None, "file": path.name,
                         "sizeBytes": path.stat().st_size})
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                       encoding="utf-8")
    print(f"baked {len(manifest)} LUTs with {SOURCE}")


if __name__ == "__main__":
    main()
