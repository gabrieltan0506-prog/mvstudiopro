/**
 * 打印前在 DOM 内压缩图片（不经 Ghostscript）。
 * - 未带标记的图（其他类型 PDF）：长边 1200、JPEG 0.75，行为与旧版一致。
 * - 带 data-pdf-max-dim / data-pdf-quality 的图（知识手册信息图，2026-11-11）：按标记上限（受 taggedMaxDim 约束）入版；
 *   已在上限内的外链图不重编码——Chromium 会把原 JPEG 字节直接写进 PDF（实测 2048 缩图原样入版，无二次失真，也不占画布内存）。
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
