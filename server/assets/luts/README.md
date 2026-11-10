# server/assets/luts

20 个 33³ `.cube` 调色 LUT（每个约 0.97 MB，共约 19.4 MB），由 [color-fx](https://pypi.org/project/color-fx/) 0.1.2（MIT，见 `LICENSE-color-fx.txt`）离线烘焙。清单见 `manifest.json`（`id / labelZh / category / intensity / source / colorFxSlug / file / sizeBytes`）。

- `cinematic`：color-fx cinematic grades 6 种风格 × subtle(0.35)/standard(0.7)，未收 bold。
- `film_stock`：4 种胶片风格，**是近似，不是实测胶片数据**；只烘焙了基础色彩，颗粒和光晕属于空间效果，无法写进 LUT。
- `basic`：冷暗暖亮分离色调（color-fx `split_toning`），以及用 color-fx `temperature_matrix(±600)` / `saturation_matrix(0.75)` 烘焙的偏暖、偏冷、压饱和。

## 复现

```bash
pip install color-fx==0.1.2 --break-system-packages   # Python>=3.10；验证要 ffmpeg>=6
python3 server/assets/luts/bake_luts.py               # 覆盖写入 *.cube 与 manifest.json，输出确定，可重复
ffmpeg -f lavfi -i smptehdbars=s=384x216 -frames:v 1 \
  -vf lut3d=file=server/assets/luts/golden_hour_standard.cube -y /tmp/check.png
```

注意：color-fx 0.1.2 自带的 `write_cube` / `color-fx bake-lut` 按「B 最快」顺序写数据，但 .cube 规范要求「R 最快」，ffmpeg/Resolve 读入后会把 R 和 B 对调（恒等 LUT 在色卡上的偏差达 40/255）。所以 `bake_luts.py` 只用 color-fx 来采样颜色函数，再按规范顺序自己写 .cube。请勿改回 `color-fx bake-lut`。
