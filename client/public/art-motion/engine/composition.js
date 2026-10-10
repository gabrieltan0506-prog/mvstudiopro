// 安全场景图执行器：所有帧由绝对时间求值；不执行用户代码、不加载远程脚本。
(() => {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const rad = x => (x * Math.PI) / 180;
  const defaults = {
    x: 0.5,
    y: 0.5,
    z: 0,
    scale: 1,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    rotationX: 0,
    rotationY: 0,
    opacity: 1,
    reveal: 1,
    fill: "#26354a",
    stroke: "#26354a",
  };
  const cameraDefaults = {
    x: 0.5,
    y: 0.5,
    z: 4,
    rotationX: 0,
    rotationY: 0,
    zoom: 1,
  };
  const ease = (t, kind) =>
    kind === "step"
      ? t >= 1
        ? 1
        : 0
      : kind === "easeIn"
        ? t * t
        : kind === "easeOut"
          ? 1 - (1 - t) * (1 - t)
          : kind === "easeInOut"
            ? t * t * (3 - 2 * t)
            : t;
  function interpolate(a, b, p) {
    if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
    if (
      typeof a === "string" &&
      /^#[\da-f]{6}$/i.test(a) &&
      /^#[\da-f]{6}$/i.test(b)
    )
      return (
        "#" +
        [1, 3, 5]
          .map(i =>
            Math.round(
              parseInt(a.slice(i, i + 2), 16) +
                (parseInt(b.slice(i, i + 2), 16) -
                  parseInt(a.slice(i, i + 2), 16)) *
                  p
            )
              .toString(16)
              .padStart(2, "0")
          )
          .join("")
      );
    return p >= 1 ? b : a;
  }
  function sample(initial, frames, t) {
    const out = { ...initial };
    for (const key of Object.keys(initial)) {
      let previous = initial[key],
        at = 0;
      for (const frame of frames || []) {
        if (frame[key] === undefined) continue;
        if (t < frame.at) {
          out[key] = interpolate(
            previous,
            frame[key],
            ease(clamp((t - at) / (frame.at - at || 1)), frame.ease)
          );
          break;
        }
        previous = frame[key];
        at = frame.at;
        out[key] = previous;
      }
    }
    return out;
  }
  function hash(seed, index) {
    let x = (seed + Math.imul(index + 1, 374761393)) | 0;
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
  }
  function rotate(p, x, y, z) {
    let [a, b, c] = p;
    const sx = Math.sin(rad(x)),
      cx = Math.cos(rad(x)),
      sy = Math.sin(rad(y)),
      cy = Math.cos(rad(y)),
      sz = Math.sin(rad(z)),
      cz = Math.cos(rad(z));
    [b, c] = [b * cx - c * sx, b * sx + c * cx];
    [a, c] = [a * cy + c * sy, -a * sy + c * cy];
    return [a * cz - b * sz, a * sz + b * cz, c];
  }
  function projector(camera, W, H) {
    const U = Math.min(W, H),
      near = 0.025;
    const cameraSpace = point =>
      rotate(
        [
          point[0] - ((camera.x - 0.5) * W) / U,
          point[1] - ((camera.y - 0.5) * H) / U,
          point[2] - camera.z,
        ],
        -camera.rotationX,
        -camera.rotationY,
        0
      );
    const screen = ([x, y, z]) => {
      const depth = -z,
        scale = (camera.z / depth) * camera.zoom;
      return {
        x: W / 2 + x * U * scale,
        y: H / 2 + y * U * scale,
        scale,
        depth,
      };
    };
    const project = point => {
      const p = cameraSpace(point);
      return -p[2] < near ? null : screen(p);
    };
    // 三维面跨过近裁面时裁掉不可见部分，不能整面突然消失。
    project.polygon = points => {
      const input = points.map(cameraSpace),
        clipped = [];
      for (let i = 0; i < input.length; i++) {
        const a = input[i],
          b = input[(i + 1) % input.length],
          aIn = -a[2] >= near,
          bIn = -b[2] >= near;
        if (aIn) clipped.push(a);
        if (aIn !== bIn) {
          const t = (-near - a[2]) / (b[2] - a[2]);
          clipped.push([
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            -near,
          ]);
        }
      }
      return clipped.map(screen);
    };
    return project;
  }
  const world = (v, W, H) => [
    ((v.x - 0.5) * W) / Math.min(W, H),
    ((v.y - 0.5) * H) / Math.min(W, H),
    v.z,
  ];
  const geometries = {
    box: {
      vertices: [
        [-1, -1, -1],
        [1, -1, -1],
        [1, 1, -1],
        [-1, 1, -1],
        [-1, -1, 1],
        [1, -1, 1],
        [1, 1, 1],
        [-1, 1, 1],
      ],
      faces: [
        [0, 1, 2, 3],
        [4, 7, 6, 5],
        [0, 4, 5, 1],
        [3, 2, 6, 7],
        [0, 3, 7, 4],
        [1, 5, 6, 2],
      ],
    },
    tetrahedron: {
      vertices: [
        [1, 1, 1],
        [-1, -1, 1],
        [-1, 1, -1],
        [1, -1, -1],
      ],
      faces: [
        [0, 1, 2],
        [0, 3, 1],
        [0, 2, 3],
        [1, 3, 2],
      ],
    },
    octahedron: {
      vertices: [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ],
      faces: [
        [0, 2, 4],
        [2, 1, 4],
        [1, 3, 4],
        [3, 0, 4],
        [2, 0, 5],
        [1, 2, 5],
        [3, 1, 5],
        [0, 3, 5],
      ],
    },
  };
  function shade(color, factor) {
    return (
      "#" +
      [1, 3, 5]
        .map(i =>
          Math.round(
            clamp(parseInt(color.slice(i, i + 2), 16) * factor, 0, 255)
          )
            .toString(16)
            .padStart(2, "0")
        )
        .join("")
    );
  }
  function meshDraw(c, e, v, project, W, H) {
    const g = geometries[e.geometry];
    if (!g) throw new Error("不支持的三维几何体");
    const U = Math.min(W, H),
      center = world(v, W, H);
    const vertices = g.vertices.map(p => {
      const q = rotate(
        [
          ((p[0] * e.width * W) / U / 2) * v.scaleX,
          ((p[1] * e.height * H) / U / 2) * v.scaleY,
          (p[2] * e.depth) / 2,
        ],
        v.rotationX,
        v.rotationY,
        v.rotation
      );
      return q.map((n, i) => n * v.scale + center[i]);
    });
    const faces = g.faces
      .map((face, i) => ({
        points: project.polygon(face.map(j => vertices[j])),
        i,
      }))
      .filter(f => f.points.length >= 3)
      .sort(
        (a, b) =>
          b.points.reduce((n, p) => n + p.depth, 0) / b.points.length -
          a.points.reduce((n, p) => n + p.depth, 0) / a.points.length
      );
    for (const face of faces) {
      c.beginPath();
      face.points.forEach((p, i) =>
        i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)
      );
      c.closePath();
      if (!e.wireframe) {
        c.fillStyle = shade(v.fill, 0.5 + (face.i / g.faces.length) * 0.5);
        c.fill();
      }
      if (e.strokeWidth) {
        c.strokeStyle = v.stroke;
        c.lineWidth = e.strokeWidth * U;
        c.stroke();
      }
    }
  }
  function textLines(c, text, maxWidth, spacing) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let line = "";
      for (const char of [...paragraph]) {
        const next = line + char;
        if (
          line &&
          c.measureText(next).width +
            Math.max(0, [...next].length - 1) * spacing >
            maxWidth
        ) {
          lines.push(line);
          line = char;
        } else line = next;
      }
      lines.push(line);
    }
    return lines;
  }
  function drawPath(c, e, v, W, H) {
    const pts = e.points.map(p => [p[0] * W, p[1] * H]);
    if (e.closed) pts.push(pts[0]);
    const lengths = pts
      .slice(1)
      .map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    let remain = lengths.reduce((s, n) => s + n, 0) * v.reveal;
    c.beginPath();
    c.moveTo(...pts[0]);
    for (let i = 0; i < lengths.length; i++) {
      const p = pts[i],
        q = pts[i + 1],
        portion = clamp(remain / (lengths[i] || 1));
      c.lineTo(p[0] + (q[0] - p[0]) * portion, p[1] + (q[1] - p[1]) * portion);
      remain -= lengths[i];
      if (remain <= 0) break;
    }
    if (e.closed && v.reveal >= 1) c.closePath();
    if (e.filled && v.reveal >= 1) c.fill();
    c.lineWidth = e.strokeWidth * Math.min(W, H);
    c.lineJoin = "round";
    c.lineCap = "round";
    c.stroke();
  }
  function drawElement(c, e, v, t, project, images, W, H) {
    if (v.opacity <= 0 || v.reveal <= 0) return;
    c.save();
    c.globalAlpha *= v.opacity;
    c.globalCompositeOperation = {
      normal: "source-over",
      add: "lighter",
      multiply: "multiply",
      screen: "screen",
    }[e.blend || "normal"];
    c.fillStyle = v.fill;
    c.strokeStyle = v.stroke;
    if (e.type === "mesh") {
      meshDraw(c, e, v, project, W, H);
      c.restore();
      return;
    }
    const center = world(v, W, H),
      p = project(center);
    if (!p) {
      c.restore();
      return;
    }
    const U = Math.min(W, H);
    if (e.type === "particles") {
      for (let i = 0; i < e.count; i++) {
        const a = hash(e.seed, i * 4) * Math.PI * 2,
          r = hash(e.seed, i * 4 + 1),
          phase = hash(e.seed, i * 4 + 2),
          age = Math.max(0, t - e.start + e.elapsedOffset);
        let dx,
          dy,
          dz = (phase - 0.5) * e.depth;
        if (e.motion === "orbit") {
          dx = Math.cos(a + age * e.speed * 4) * r * e.spread;
          dy = Math.sin(a + age * e.speed * 4) * r * e.spread;
        } else if (e.motion === "burst") {
          const distance = r * e.spread + age * e.speed;
          dx = Math.cos(a) * distance;
          dy = Math.sin(a) * distance;
        } else {
          dx = (r - 0.5) * e.spread + Math.sin(a) * age * e.speed;
          dy = (phase - 0.5) * e.spread - age * e.speed;
        }
        const rotated = rotate(
            [dx * v.scale * v.scaleX, dy * v.scale * v.scaleY, dz * v.scale],
            v.rotationX,
            v.rotationY,
            v.rotation
          ),
          pp = project(rotated.map((n, j) => n + center[j]));
        if (pp) {
          c.beginPath();
          c.arc(pp.x, pp.y, e.size * U * pp.scale * (0.5 + r), 0, Math.PI * 2);
          c.fill();
        }
      }
      c.restore();
      return;
    }
    c.translate(p.x, p.y);
    c.rotate(rad(v.rotation));
    c.scale(v.scale * v.scaleX * p.scale, v.scale * v.scaleY * p.scale);
    if (e.type === "text") {
      c.font = `${e.fontSize * U}px ${e.font === "serif" ? '"LXGWWenKai-500",serif' : e.font === "mono" ? '"CMU-rm","PuHui-Medium",monospace' : e.weight === "bold" ? '"PuHui-Bold",sans-serif' : '"PuHui-Medium",sans-serif'}`;
      c.textBaseline = "middle";
      c.textAlign = "left";
      const spacing = e.letterSpacing * U,
        visible = [...e.text]
          .slice(0, Math.ceil([...e.text].length * v.reveal))
          .join(""),
        lines = textLines(c, e.text, e.maxWidth * W, spacing),
        lineStep = e.fontSize * U * e.lineHeight;
      let remaining = [...visible.replace(/\n/g, "")].length;
      lines.forEach((line, i) => {
        const chars = [...line],
          width =
            c.measureText(line).width + Math.max(0, chars.length - 1) * spacing;
        let x =
          e.align === "center" ? -width / 2 : e.align === "right" ? -width : 0;
        const y = (i - (lines.length - 1) / 2) * lineStep;
        for (const char of chars) {
          if (remaining-- <= 0) break;
          c.fillText(char, x, y);
          x += c.measureText(char).width + spacing;
        }
      });
    } else if (e.type === "image") {
      const img = images.get(e.imageUri);
      if (!img) throw new Error("镜头图片尚未加载");
      const w = e.width * W,
        h = e.height * H,
        scale = (e.fit === "cover" ? Math.max : Math.min)(
          w / img.width,
          h / img.height
        ),
        iw = img.width * scale,
        ih = img.height * scale;
      c.beginPath();
      c.rect(-w / 2, -h / 2, w, h);
      c.clip();
      c.drawImage(img, -iw / 2, -ih / 2, iw, ih);
    } else if (e.type === "path") drawPath(c, e, v, W, H);
    else if (e.type === "shape") {
      const w = e.width * W,
        h = e.height * H;
      c.beginPath();
      if (e.shape === "ellipse")
        c.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      else if (e.shape === "triangle") {
        c.moveTo(0, -h / 2);
        c.lineTo(w / 2, h / 2);
        c.lineTo(-w / 2, h / 2);
        c.closePath();
      } else if (e.shape === "line") {
        c.moveTo(-w / 2, -h / 2);
        c.lineTo(-w / 2 + w * v.reveal, -h / 2 + h * v.reveal);
      } else if (e.radius && c.roundRect)
        c.roundRect(-w / 2, -h / 2, w, h, Math.min(e.radius * U, w / 2, h / 2));
      else c.rect(-w / 2, -h / 2, w, h);
      if (e.filled && e.shape !== "line") c.fill();
      if (e.strokeWidth) {
        c.lineWidth = e.strokeWidth * U;
        c.stroke();
      }
    }
    c.restore();
  }
  async function boot() {
    const spec = window.COMPOSITION_SPEC;
    if (!spec?.composition || spec.composition.version !== 1)
      throw new Error("逐镜编排格式无效");
    if (
      !Array.isArray(spec.composition.scenes) ||
      !spec.composition.scenes.length ||
      spec.composition.scenes.length > 18
    )
      throw new Error("逐镜编排场景数量无效");
    for (const scene of spec.composition.scenes) {
      if (
        !Array.isArray(scene.elements) ||
        !scene.elements.length ||
        scene.elements.length > 48
      )
        throw new Error("逐镜元素数量无效");
      if (
        scene.elements.some(
          e =>
            !["text", "shape", "path", "particles", "mesh", "image"].includes(
              e.type
            )
        )
      )
        throw new Error("不支持的逐镜元素类型");
    }
    const cv = document.getElementById("c"),
      c = cv.getContext("2d", { willReadFrequently: true }),
      W = spec.width,
      H = spec.height;
    cv.width = W;
    cv.height = H;
    const images = new Map();
    const imageUrls = new Map(
      (spec.cues || []).filter(q => q.imageUri).map(q => [q.imageUri, q.image])
    );
    for (const uri of new Set(
      spec.composition.scenes.flatMap(s =>
        s.elements.filter(e => e.type === "image").map(e => e.imageUri)
      )
    )) {
      const url = imageUrls.get(uri);
      if (!url) throw new Error("镜头图片缺少已核验素材映射");
      const parsed = new URL(url, location.href);
      if (
        !(
          parsed.origin === location.origin ||
          parsed.protocol === "https:" ||
          /^data:image\/(?:png|jpeg|webp);base64,/i.test(url)
        )
      )
        throw new Error("镜头图片映射协议无效");
      const image = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("镜头图片加载失败"));
        im.src = url;
      });
      images.set(uri, image);
    }
    for (const f of window.FONT_FACES || []) {
      const ff = new FontFace(f.family, `url(${f.url})`, f.desc || {});
      await ff.load();
      document.fonts.add(ff);
    }
    await document.fonts.ready;
    let at = 0,
      prior = new Map(),
      priorElapsed = new Map(),
      priorTypes = new Map();
    const scenes = spec.composition.scenes.map(scene => {
      const start = at;
      at += scene.duration;
      const states = new Map(),
        elapsed = new Map(),
        types = new Map(),
        elements = scene.elements.map(e => {
          if (
            e.continuity === "carry" &&
            (!prior.has(e.id) || priorTypes.get(e.id) !== e.type)
          )
            throw new Error("贯穿元素缺少上一镜同类型实体");
          const elapsedOffset =
            e.continuity === "carry" ? priorElapsed.get(e.id) : 0;
          const initial = {
            ...defaults,
            ...(e.continuity === "carry" ? prior.get(e.id) : {}),
            ...e.transform,
          };
          states.set(e.id, sample(initial, e.keyframes, scene.duration));
          elapsed.set(e.id, elapsedOffset + scene.duration - e.start);
          types.set(e.id, e.type);
          return { ...e, initial, elapsedOffset };
        });
      prior = states;
      priorElapsed = elapsed;
      priorTypes = types;
      return { ...scene, at: start, elements };
    });
    if (Math.abs(at - spec.duration) > 0.001)
      throw new Error("逐镜编排总时长与影片不一致");
    const drawScene = (scene, t, alpha = 1, offset = 0, zoom = 1, clip = 1) => {
      c.save();
      c.globalAlpha = alpha;
      c.beginPath();
      c.rect(0, 0, W * clip, H);
      c.clip();
      c.translate(offset, 0);
      c.translate(W / 2, H / 2);
      c.scale(zoom, zoom);
      c.translate(-W / 2, -H / 2);
      if (!spec.alpha) {
        c.fillStyle = scene.background || spec.background;
        c.fillRect(0, 0, W, H);
      }
      const camera = sample(
          { ...cameraDefaults, ...scene.camera },
          scene.camera?.keyframes,
          t
        ),
        project = projector(camera, W, H);
      const items = scene.elements
        .filter(
          e =>
            t >= e.start &&
            (t < (e.end ?? scene.duration) ||
              (t === scene.duration &&
                (e.end ?? scene.duration) === scene.duration))
        )
        .map(e => ({ e, v: sample(e.initial, e.keyframes, t) }));
      items.sort(
        (a, b) =>
          a.e.layer - b.e.layer ||
          (project(world(b.v, W, H))?.depth || 0) -
            (project(world(a.v, W, H))?.depth || 0)
      );
      for (const item of items)
        drawElement(c, item.e, item.v, t, project, images, W, H);
      c.restore();
    };
    window.renderFrame = seconds => {
      const t = clamp(
        Number(seconds) || 0,
        0,
        Math.max(0, spec.duration - 1e-8)
      );
      let i = scenes.findIndex(s => t < s.at + s.duration);
      if (i < 0) i = scenes.length - 1;
      const scene = scenes[i],
        local = t - scene.at,
        tr = scene.transition;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
      c.clearRect(0, 0, W, H);
      if (
        i > 0 &&
        tr &&
        tr.type !== "cut" &&
        tr.duration > 0 &&
        local < tr.duration
      ) {
        const p = ease(local / tr.duration, "easeInOut");
        drawScene(scenes[i - 1], scenes[i - 1].duration);
        drawScene(
          scene,
          local,
          tr.type === "fade" || tr.type === "zoom" ? p : 1,
          tr.type === "slideLeft" ? (1 - p) * W : 0,
          tr.type === "zoom" ? 1.25 - 0.25 * p : 1,
          tr.type === "wipe" ? p : 1
        );
      } else drawScene(scene, local);
    };
    window.__canvas = cv;
    window.__total = spec.duration;
    window.__fps = spec.fps;
    window.__size = [W, H];
    window.prepare = async () => {};
    window.__ready = true;
  }
  window.CODE_MOTION_COMPOSITION_INTERNALS = {
    sample,
    hash,
    rotate,
    projector,
  };
  boot().catch(e => {
    window.__bootFailed = String(e?.message || e);
  });
})();
