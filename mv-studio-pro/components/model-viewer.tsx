/**
 * ModelViewer - 3D 模型預覽組件
 *
 * 使用 Google <model-viewer> Web Component 在頁面中展示 3D 模型。
 * 支持 GLB/OBJ 格式，提供旋轉、縮放、平移交互。
 *
 * 在 Web 端通過 iframe 嵌入 model-viewer HTML；
 * 在原生端顯示預覽圖 + 提示在 3D 軟件中查看。
 */
import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TouchableOpacity,
  Linking,
} from "react-native";
import { Image } from "expo-image";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

const isWeb = Platform.OS === "web";

interface ModelViewerProps {
  /** GLB 模型 URL（首選） */
  glbUrl?: string | null;
  /** OBJ 模型 URL（備選） */
  objUrl?: string | null;
  /** 紋理圖片 URL */
  textureUrl?: string | null;
  /** 預覽縮略圖 URL（加載中或原生端顯示） */
  thumbnailUrl?: string | null;
  /** 容器高度 */
  height?: number;
  /** 是否自動旋轉 */
  autoRotate?: boolean;
  /** 背景色 */
  backgroundColor?: string;
}

/**
 * 生成 model-viewer HTML 頁面內容
 * 使用 Google model-viewer CDN，支持 GLB 格式的 3D 模型展示
 */
function generateModelViewerHTML(props: {
  modelUrl: string;
  thumbnailUrl?: string | null;
  autoRotate: boolean;
  backgroundColor: string;
}): string {
  const { modelUrl, thumbnailUrl, autoRotate, backgroundColor } = props;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>3D Model Viewer</title>
  <script type="module" src="https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: ${backgroundColor}; }
    model-viewer {
      width: 100%;
      height: 100%;
      --poster-color: transparent;
    }
    model-viewer::part(default-progress-bar) {
      background: linear-gradient(90deg, #64D2FF, #FF6B6B);
      height: 4px;
    }
    .controls {
      position: absolute;
      bottom: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 10;
    }
    .controls button {
      background: rgba(30, 32, 34, 0.85);
      border: 1px solid rgba(100, 210, 255, 0.3);
      color: #64D2FF;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      transition: all 0.2s;
    }
    .controls button:hover {
      background: rgba(100, 210, 255, 0.15);
      border-color: #64D2FF;
    }
    .controls button:active {
      transform: scale(0.95);
    }
    .hint {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(30, 32, 34, 0.75);
      color: rgba(255, 255, 255, 0.7);
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 11px;
      pointer-events: none;
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      white-space: nowrap;
      opacity: 1;
      transition: opacity 1s;
    }
    .hint.hidden { opacity: 0; }
  </style>
</head>
<body>
  <model-viewer
    id="viewer"
    src="${modelUrl}"
    ${thumbnailUrl ? `poster="${thumbnailUrl}"` : ""}
    ${autoRotate ? 'auto-rotate auto-rotate-delay="0"' : ""}
    camera-controls
    touch-action="pan-y"
    interaction-prompt="auto"
    shadow-intensity="1"
    shadow-softness="0.8"
    exposure="1.2"
    environment-image="neutral"
    loading="eager"
    reveal="auto"
    style="background-color: ${backgroundColor};"
  ></model-viewer>
  <div class="hint" id="hint">🖱️ 拖拽旋转 · 滚轮缩放 · 右键平移</div>
  <div class="controls">
    <button onclick="resetCamera()">↺ 重置视角</button>
    <button onclick="toggleRotate()" id="rotateBtn">${autoRotate ? "⏸ 停止旋转" : "▶ 自动旋转"}</button>
    <button onclick="toggleWireframe()" id="wireBtn">◇ 线框</button>
  </div>
  <script>
    const viewer = document.getElementById('viewer');
    const hint = document.getElementById('hint');
    let isRotating = ${autoRotate};
    let wireframeOn = false;

    // 3 秒後隱藏提示
    setTimeout(() => hint.classList.add('hidden'), 3000);

    function resetCamera() {
      viewer.cameraOrbit = 'auto auto auto';
      viewer.cameraTarget = 'auto auto auto';
      viewer.fieldOfView = 'auto';
      viewer.jumpCameraToGoal();
    }

    function toggleRotate() {
      isRotating = !isRotating;
      viewer.autoRotate = isRotating;
      document.getElementById('rotateBtn').textContent = isRotating ? '⏸ 停止旋转' : '▶ 自动旋转';
    }

    function toggleWireframe() {
      wireframeOn = !wireframeOn;
      const model = viewer.model;
      if (model) {
        model.materials.forEach(mat => {
          mat.setWireframe(wireframeOn);
        });
      }
      document.getElementById('wireBtn').textContent = wireframeOn ? '◆ 实体' : '◇ 线框';
    }
  </script>
</body>
</html>`;
}

export function ModelViewer({
  glbUrl,
  objUrl,
  thumbnailUrl,
  textureUrl,
  height = 320,
  autoRotate = true,
  backgroundColor = "#1a1a2e",
}: ModelViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // model-viewer 原生支持 GLB/glTF。OBJ 不直接支持，需要顯示備選方案。
  const modelUrl = glbUrl || null;
  const canShowViewer = isWeb && !!modelUrl;

  // 生成 iframe 的 srcdoc HTML
  const iframeHtml = useMemo(() => {
    if (!modelUrl) return "";
    return generateModelViewerHTML({
      modelUrl,
      thumbnailUrl,
      autoRotate,
      backgroundColor,
    });
  }, [modelUrl, thumbnailUrl, autoRotate, backgroundColor]);

  // ── Web 端：使用 iframe 嵌入 model-viewer ──
  if (canShowViewer) {
    return (
      <View style={[styles.container, { height }]}>
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#64D2FF" />
            <Text style={styles.loadingText}>加载 3D 模型中...</Text>
          </View>
        )}
        {error && (
          <View style={styles.errorOverlay}>
            <MaterialIcons name="error-outline" size={32} color="#FF6B6B" />
            <Text style={styles.errorText}>3D 模型加载失败</Text>
            {thumbnailUrl && (
              <Image source={{ uri: thumbnailUrl }} style={styles.fallbackImage} contentFit="contain" />
            )}
          </View>
        )}
        <iframe
          srcDoc={iframeHtml}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: 12,
            opacity: loading ? 0 : 1,
            transition: "opacity 0.3s",
          } as any}
          onLoad={() => setLoading(false)}
          onError={() => { setError(true); setLoading(false); }}
          allow="autoplay; fullscreen; xr-spatial-tracking"
          sandbox="allow-scripts allow-same-origin"
          title="3D Model Viewer"
        />
      </View>
    );
  }

  // ── OBJ only（無 GLB）或原生端：顯示預覽圖 + 提示 ──
  const hasObjOnly = !glbUrl && !!objUrl;

  return (
    <View style={[styles.container, { height }]}>
      {thumbnailUrl ? (
        <Image source={{ uri: thumbnailUrl }} style={styles.previewImage} contentFit="contain" />
      ) : (
        <View style={styles.placeholderBox}>
          <MaterialIcons name="view-in-ar" size={48} color="rgba(100,210,255,0.5)" />
        </View>
      )}
      <View style={styles.nativeOverlay}>
        <MaterialIcons name="3d-rotation" size={36} color="rgba(255,255,255,0.8)" />
        <Text style={styles.nativeHint}>
          {hasObjOnly
            ? "OBJ 格式暂不支持在线预览\n请下载后在 3D 软件中查看"
            : isWeb
              ? "模型加载中..."
              : "请在 Web 端查看 3D 预览\n或下载模型文件在 3D 软件中打开"
          }
        </Text>
        {hasObjOnly && objUrl && (
          <TouchableOpacity
            style={styles.openBtn}
            onPress={() => Linking.openURL(objUrl)}
            activeOpacity={0.8}
          >
            <MaterialIcons name="open-in-new" size={16} color="#000" />
            <Text style={styles.openBtnText}>下载 OBJ 文件</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1a1a2e",
    position: "relative",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    zIndex: 2,
  },
  loadingText: {
    marginTop: 8,
    fontSize: 13,
    color: "rgba(255,255,255,0.6)",
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
    zIndex: 2,
  },
  errorText: {
    marginTop: 8,
    fontSize: 13,
    color: "#FF6B6B",
  },
  fallbackImage: {
    width: "80%",
    height: "60%",
    marginTop: 12,
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  placeholderBox: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#1a1a2e",
  },
  nativeOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  nativeHint: {
    marginTop: 8,
    fontSize: 13,
    color: "rgba(255,255,255,0.7)",
    textAlign: "center",
    lineHeight: 20,
  },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    backgroundColor: "#64D2FF",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  openBtnText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#000",
  },
});
