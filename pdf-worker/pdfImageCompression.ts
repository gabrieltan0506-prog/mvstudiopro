/**
 * 打印前在 DOM 内压缩图片（不经 Ghostscript）。
 * - 未带标记的图（其他类型 PDF）：长边 1200、JPEG 0.75，行为与旧版一致。
 * - 带 data-pdf-max-dim / data-pdf-quality 的图（知识手册信息图，2026-11-11）：按标记上限（受 taggedMaxDim 约束）入版；
 *   已在上限内的外链图不重编码——Chromium 会把原 JPEG 字节直接写进 PDF（实测 2048 缩图原样入版，无二次失真，也不占画布内存）。
 * - 带 data-pdf-original="1" 的图（知识手册成品原图，2026-11-21 站长「不要牺牲像素」）：一律不动——不缩放、不重编码；
 *   Chromium 打印时 JPEG 原字节入版、PNG 以无损 Flate 入版，内嵌像素 = 原图像素。优先于 max-dim 标记。
 * - 同一来源同一尺寸只编码一次；重复引用（如跨页两半）在 PDF 中共用同一图片对象。
 * 返回可交给 page.evaluate 的脚本字符串（pdf-worker tsconfig 无 lib.dom）。
 */
export function pdfImageCompressionScript(taggedMaxDim: number): string {
  const cap = Math.min(4096, Math.max(256, Math.floor(Number(taggedMaxDim) || 2048)));
  return `(async function() {
      var images = Array.from(document.images);
      var encoded = {};
      for (var i = 0; i < images.length; i++) {
        var img = images[i];
        if (!img.src || img.src.indexOf('image/svg') !== -1) continue;
        if (img.getAttribute('data-pdf-original') === '1') continue;
        if (img.naturalWidth < 100 && img.naturalHeight < 100) continue;
        try {
          var tagged = Number(img.getAttribute('data-pdf-max-dim')) || 0;
          var MAX_DIM = tagged ? Math.max(256, Math.min(${cap}, tagged)) : 1200; // 限制最大邊長，超過則等比縮小
          var tq = Number(img.getAttribute('data-pdf-quality')) || 0;
          var QUALITY = tagged && tq ? Math.max(0.5, Math.min(0.95, tq)) : 0.75;
          var w = img.naturalWidth;
          var h = img.naturalHeight;
          if (tagged && w <= MAX_DIM && h <= MAX_DIM && !img.src.startsWith('data:')) continue;
          if (w > MAX_DIM || h > MAX_DIM) {
            var ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
            w = Math.round(w * ratio);
            h = Math.round(h * ratio);
          }
          var key = img.src + '|' + w + 'x' + h + '|' + QUALITY;
          var newData = encoded[key];
          if (!newData) {
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            // 填白底，避免透明 PNG 轉 JPEG 變黑底
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            newData = canvas.toDataURL('image/jpeg', QUALITY);
            canvas.width = canvas.height = 0; // 尽早释放画布像素
            encoded[key] = newData;
          }
          // 只有當壓縮後更小，或是原本不是 data URI (外部圖片) 時才替換
          if (newData.length < img.src.length || !img.src.startsWith('data:')) {
            img.src = newData;
            img.srcset = '';
          }
        } catch(e) {}
      }
      // 替换后的图须解码完毕再排版/打印，避免知识书册量到未就绪的图高
      await Promise.all(images.map(function (img) { return img.decode ? img.decode().catch(function () {}) : null; }));
    })()`;
}

/**
 * 等图载入并解码（step3）。成品原图（data-pdf-original="1"，13–18MB 的 4K PNG）单图等待放宽到 originalWaitMs；
 * 等完仍有原图没载入成功即抛错（消息含 timeout，服务端按瞬时故障原地重试），绝不在缺图/未解码时排版打印——
 * 否则会量到 0 高的图、或打出缺图的成品。其余图维持原先「等 perImageWaitMs 后照常继续」。
 */
export function pdfImageLoadScript(perImageWaitMs: number, originalWaitMs: number): string {
  return `Promise.all(Array.from(document.images).map(function (img) {
      return new Promise(function (resolve) {
        function done() { resolve(null); }
        if (img.complete && img.naturalWidth > 0) return done();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        setTimeout(done, img.getAttribute("data-pdf-original") === "1" ? ${Math.max(0, Math.floor(originalWaitMs))} : ${Math.max(0, Math.floor(perImageWaitMs))});
      });
    })).then(function () {
      return Promise.all(Array.from(document.images).map(function (img) {
        return (img.decode && typeof img.decode === "function")
          ? img.decode().catch(function () {})
          : Promise.resolve();
      }));
    }).then(function () {
      var missing = Array.from(document.querySelectorAll('img[data-pdf-original="1"]')).filter(function (img) { return !(img.complete && img.naturalWidth > 0); }).length;
      if (missing) throw new Error("original image load timeout: " + missing + " image(s) not loaded");
    })`;
}
