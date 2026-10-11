FROM node:24.13.1-slim

WORKDIR /app

# 安装 ffmpeg + python3 + yt-dlp + Chromium（PDF 原生渲染，Puppeteer 无 bundled 下载）
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
    ffmpeg python3 python3-pip python3-numpy curl \
    xvfb xauth libgl1-mesa-dri libxxf86vm1 libsm6 libice6 libxkbcommon0 libegl1 libgl1 \
    unzip xz-utils binutils poppler-utils \
    chromium \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libgbm1 \
 && pip3 install --break-system-packages yt-dlp \
 && rm -rf /var/lib/apt/lists/*

# Official LTS binary pinned to the reviewed Linux x64 release and SHA-256.
# The same image supplies website and heavy worker; no mutable apt Blender version.
ARG BLENDER_VERSION=4.5.14
ARG BLENDER_SHA256=9ba871ff2ecd36526b77432745980b7e6664ecd0c7ca11c48849073dcfe06da3
RUN test "$(dpkg --print-architecture)" = "amd64" \
 && curl --fail --location --retry 3 "https://download.blender.org/release/Blender4.5/blender-${BLENDER_VERSION}-linux-x64.tar.xz" -o /tmp/blender.tar.xz \
 && echo "${BLENDER_SHA256}  /tmp/blender.tar.xz" | sha256sum --check --strict \
 && mkdir -p /opt/blender \
 && tar -xJf /tmp/blender.tar.xz --strip-components=1 -C /opt/blender \
 && rm /tmp/blender.tar.xz
ENV PATH="/opt/blender:${PATH}"

# 白模由确定性脚本在无显示服务器上渲染；使用软件 GL，不要求生产 GPU。
RUN blender --background --factory-startup --version \
 && blender --background --factory-startup --python-exit-code 1 \
    --python-expr "import numpy; import io_scene_gltf2; print('GLTF_DEPENDENCIES_IMPORTED', numpy.__version__)" \
 && command -v xvfb-run && command -v nice
ENV LIBGL_ALWAYS_SOFTWARE=1

RUN npm install -g pnpm@10.4.1

# OCR独立缓存层仅随锁定依赖变更；位于业务COPY/CACHEBUST之前，不重复安装现有Blender。
COPY server/scripts/file_conversion_ocr.requirements.txt /tmp/file_conversion_ocr.requirements.txt
RUN pip3 install --no-cache-dir --target /opt/file-conversion-ocr -r /tmp/file_conversion_ocr.requirements.txt \
 && PYTHONPATH=/opt/file-conversion-ocr python3 -c "import pathlib, rapidocr_onnxruntime as r; p=pathlib.Path(r.__file__).parent/'models'; assert len(list(p.glob('*.onnx')))==3, 'OCR models missing'"

# 配音模型安装默认关闭，须完成独立验收后显式启用构建参数。
ARG INK_FREE_TTS_INSTALL=0
COPY server/scripts/ink_free_tts.requirements.txt /tmp/ink_free_tts.requirements.txt
COPY server/scripts/ink_free_tts.py /tmp/ink_free_tts.py
RUN if [ "$INK_FREE_TTS_INSTALL" = "1" ]; then pip3 install --no-cache-dir --target /opt/ink-tts-runtime -r /tmp/ink_free_tts.requirements.txt \
 && curl --fail --location --retry 3 https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2 -o /tmp/ink-tts.tar.bz2 \
 && echo 'a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6  /tmp/ink-tts.tar.bz2' | sha256sum --check --strict \
 && mkdir -p /opt/ink-tts-model \
 && tar -xjf /tmp/ink-tts.tar.bz2 --strip-components=1 -C /opt/ink-tts-model \
 && rm /tmp/ink-tts.tar.bz2 \
 && PYTHONPATH=/opt/ink-tts-runtime python3 /tmp/ink_free_tts.py --model-dir /opt/ink-tts-model --check; fi

# Fly remote builders 可能長期命中舊的 COPY 快取（建置上下文未變更 checksum 時仍用舊原始碼）。
# 透過 fly.toml [build.args].CACHEBUST 手動遞增，可強制重新 COPY 與後續 RUN。
ARG CACHEBUST=0
RUN test -n "${CACHEBUST:-}" && echo "CACHEBUST=${CACHEBUST}"

COPY . .

# 动画导出恢复原PBR材质的内存回归，不渲染或输出媒体。
RUN blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python server/scripts/test_previs_animation_materials.py

# 接触检查读取实际求值网格；纯内存，不渲染、不导出。
RUN blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python server/scripts/test_previs_rigged_contact_mesh.py
RUN blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python server/scripts/test_previs_sit_runtime.py
RUN blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python server/scripts/test_previs_cough_runtime.py
RUN blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python server/scripts/test_previs_rigged_piggyback.py -- /tmp/previs-rigged-piggyback-memory --block
RUN blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
    --python server/scripts/test_previs_rigged_posture.py -- /tmp/previs-rigged-posture-memory

# 生成媒体的旧夹具仅在展示内容并确认后显式开启。
ARG RUN_MEDIA_SMOKE=0
# 依赖导入成功不代表旧版 glTF 插件能运行；必须真实导出并经生产入口重新导入带骨/表情 GLB。
# 离线自造夹具，不联网、不渲染视频；同时验证拒绝路径、蒙皮、动作与表演数据。
RUN if [ "$RUN_MEDIA_SMOKE" = "1" ]; then blender --background --factory-startup --python-exit-code 1 \
    --python server/scripts/test_previs_rigged_model.py -- /tmp/previs-gltf-build-smoke; else echo "媒体夹具未获本次确认，跳过生成；无媒体检查另行运行"; fi

# 在实际软件渲染环境验证基础色、UV采样、旧无材质夹具及异常回滚；只渲染自造静帧。
RUN if [ "$RUN_MEDIA_SMOKE" = "1" ]; then xvfb-run -a blender --background --factory-startup --disable-autoexec --threads 1 --python-exit-code 1 \
    --python server/scripts/test_previs_workbench_appearance.py -- /tmp/previs-appearance-build-smoke \
    --legacy-fixture /tmp/previs-gltf-build-smoke/TEST_ONLY-rigged-with-morph.glb; else echo "媒体夹具未获本次确认，跳过生成；无媒体检查另行运行"; fi

# 0916 低模绑骨→权重转移→原模导出：在镜像自带的 Blender 上真实跑一遍（合成 >5 万顶点人体，不用用户资产）。
# 含预览渲染，沿用虚拟显示；异常即构建失败。只证明本容器里合成模型链路通过，不证明真模/材质/内存/形变质量。
RUN if [ "$RUN_MEDIA_SMOKE" = "1" ]; then blender --background --factory-startup --version | head -n 1 \
 && xvfb-run -a blender --background --factory-startup --disable-autoexec --threads 1 --python-exit-code 1 \
    --python server/scripts/test_auto_rig_proxy.py -- /tmp/auto-rig-build-smoke \
    | tee /tmp/auto-rig-build-smoke.log \
 && grep -q "^TEST_OK" /tmp/auto-rig-build-smoke.log; else echo "媒体夹具未获本次确认，跳过生成；无媒体检查另行运行"; fi

# 跨进程摘要稳定性：线上「检查」与「绑定」是两次独立 Blender 进程，摘要不稳绑定必被拒。
# 同一脚本跑两遍再比对——同进程跑两次抓不到这个（2026-09-16 线上首跑真的因此失败）。
RUN if [ "$RUN_MEDIA_SMOKE" = "1" ]; then xvfb-run -a blender --background --factory-startup --disable-autoexec --threads 1 --python-exit-code 1 \
    --python server/scripts/test_auto_rig_digest.py -- /tmp/auto-rig-digest-1 \
 && xvfb-run -a blender --background --factory-startup --disable-autoexec --threads 1 --python-exit-code 1 \
    --python server/scripts/test_auto_rig_digest.py -- /tmp/auto-rig-digest-2 \
 && diff /tmp/auto-rig-digest-1/digest.json /tmp/auto-rig-digest-2/digest.json \
 && cat /tmp/auto-rig-digest-1/digest.json; else echo "媒体夹具未获本次确认，跳过生成；无媒体检查另行运行"; fi


# 跳过 postinstall 脚本（youtube-dl-exec 不再自行下载二进制）
# 并告知 youtube-dl-exec 使用系统 yt-dlp
RUN pnpm install --ignore-scripts

# 让 youtube-dl-exec 找到系统 yt-dlp
ENV YOUTUBE_DL_PATH=/usr/local/bin/yt-dlp

# Puppeteer：使用系统 Chromium（禁止下载浏览器二进制，缩短镜像构建）
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 构建阶段必须显式给TypeScript足够堆空间；下方运行时ENV不会追溯影响此RUN。
RUN NODE_OPTIONS=--max-old-space-size=4096 pnpm build \
 && pnpm exec vite build \
 && rm -rf server/_core/public \
 && mkdir -p server/_core/public \
 && cp -R client/dist/. server/_core/public/

# Install only the resolver binary (no system service / DHCP daemon).
# Keep the large Blender and base-media layers reusable for this hotfix.
RUN apt-get update \
 && apt-get install --no-install-recommends -y dnsmasq-base \
 && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

# Fly / 容器內必須監聽 0.0.0.0；PORT 與 fly.toml internal_port / 健康檢查一致
# 网站 Node 堆上限 6GB；8GB 整机剩余空间供原生缓冲与系统使用。
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_OPTIONS=--max-old-space-size=6144

CMD ["node","--max-old-space-size=6144","--import","tsx","server/_core/index.ts"]
