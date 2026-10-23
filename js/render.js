/* 渲染层：画布绘制 + 文字排版 + 命中测试 */
window.App = window.App || {};
(function (A) {
  'use strict';

  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  const layoutCache = new Map();
  A.layoutCacheReset = function () { layoutCache.clear(); };

  function fontString(el) {
    const style = el.italic ? 'italic ' : '';
    const weight = el.fontWeight || 400;
    return style + weight + ' ' + el.fontSize + 'px "' + el.fontFamily +
      '", "Source Han Serif CN", "Noto Serif SC", "Microsoft YaHei", SimSun, serif';
  }

  function applyFont(ctx, el) {
    ctx.font = fontString(el);
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = (el.letterSpacing || 0) + 'px';
    }
  }

  function lineMetrics(ctx, text, fontSize) {
    const m = ctx.measureText(text);
    let ascent = m.actualBoundingBoxAscent;
    let descent = m.actualBoundingBoxDescent;
    if (typeof ascent !== 'number' || !isFinite(ascent)) ascent = fontSize * 0.88;
    if (typeof descent !== 'number' || !isFinite(descent)) descent = fontSize * 0.12;
    if (!text) { ascent = fontSize * 0.88; descent = fontSize * 0.12; }
    return { width: m.width, ascent: ascent, descent: descent };
  }

  /* ------------------------- 排版（含缓存） ------------------------- */
  A.layout = function (el) {
    if (layoutCache.size > 600) layoutCache.clear();
    const key = JSON.stringify([el.text, el.fontFamily, el.fontSize, el.fontWeight, el.italic,
      el.letterSpacing, el.lineHeight, el.vertical, el.nowrap, el.oneCol, el.w, el.h]);
    const hit = layoutCache.get(el.id + '|' + key);
    if (hit) return hit;

    mctx.save();
    mctx.font = fontString(el);
    if ('letterSpacing' in mctx) mctx.letterSpacing = (el.letterSpacing || 0) + 'px';
    mctx.textBaseline = 'alphabetic';

    const lineH = el.fontSize * (el.lineHeight || 1);
    const lines = [];

    if (el.vertical) {
      // 竖排：每个字符占一行，超出高度自动分列
      const chars = Array.from(String(el.text || '').replace(/\s+/g, ''));
      const boxH = Math.max(el.h || lineH, lineH);
      // oneCol：竖排只走一列（「周几」用），否则按高度自动分列
      const perCol = el.oneCol ? Math.max(1, chars.length) : Math.max(1, Math.floor(boxH / lineH));
      const colGap = el.fontSize * 1.12;
      for (let i = 0; i < chars.length; i++) {
        const col = Math.floor(i / perCol);
        const row = i % perCol;
        const met = lineMetrics(mctx, chars[i], el.fontSize);
        lines.push({
          text: chars[i], width: met.width, ascent: met.ascent, descent: met.descent,
          slot: row, col: col, x: col * colGap
        });
      }
    } else {
      const maxW = Math.max(20, el.w || 100);
      String(el.text == null ? '' : el.text).split('\n').forEach(function (para) {
        const chars = Array.from(para);
        let cur = '';
        let slot = lines.length;
        if (!chars.length || el.nowrap) {
          const met = lineMetrics(mctx, para, el.fontSize);
          lines.push({ text: para, width: met.width, ascent: met.ascent, descent: met.descent, slot: slot, col: 0, x: 0 });
          return;
        }
        for (let i = 0; i < chars.length; i++) {
          const test = cur + chars[i];
          const w = lineMetrics(mctx, test, el.fontSize).width;
          if (cur && w > maxW) {
            const met = lineMetrics(mctx, cur, el.fontSize);
            lines.push({ text: cur, width: met.width, ascent: met.ascent, descent: met.descent, slot: slot, col: 0, x: 0 });
            slot += 1;
            cur = chars[i];
          } else {
            cur = test;
          }
        }
        if (cur) {
          const met = lineMetrics(mctx, cur, el.fontSize);
          lines.push({ text: cur, width: met.width, ascent: met.ascent, descent: met.descent, slot: slot, col: 0, x: 0 });
        }
      });
    }

    const maxSlot = lines.reduce(function (m, l) { return Math.max(m, l.slot); }, 0);
    const cols = lines.reduce(function (m, l) { return Math.max(m, l.col); }, 0) + 1;
    const result = {
      lines: lines,
      lineH: lineH,
      cols: cols,
      height: (maxSlot + 1) * lineH,
      width: el.vertical ? cols * (el.fontSize * 1.12) : (el.w || 100)
    };
    mctx.restore();
    layoutCache.set(el.id + '|' + key, result);
    return result;
  };

  /* --------------------------- 文字绘制 --------------------------- */
  function drawText(ctx, el) {
    if (!el.visible) return;
    const lay = A.layout(el);
    const spacing = el.letterSpacing || 0;
    const boxW = el.w || lay.width;

    ctx.save();
    ctx.globalAlpha = el.opacity == null ? 1 : el.opacity;
    applyFont(ctx, el);
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = el.color || '#000';

    const boxH = el.vertical ? Math.max(el.h || 0, lay.height) : lay.height;
    const cx = el.x + boxW / 2;
    const cy = el.y + boxH / 2;
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
    ctx.translate(-cx, -cy);

    // 括号（竖排周几用）：原版是「（周一）」转 90°，即上方一个向上的弧形、下方一个向下的弧形
    if (el.parens && el.vertical && lay.lines.length) {
      let first = lay.lines[0];
      let last = lay.lines[0];
      lay.lines.forEach(function (l) {
        if (l.slot < first.slot) first = l;
        if (l.slot > last.slot) last = l;
      });
      const rx = Math.max(10, boxW * 0.37);
      const ry = Math.max(8, el.fontSize * 0.3);
      const midX = el.x + boxW / 2;
      const firstInkTop = el.y + first.slot * lay.lineH + (lay.lineH - (first.ascent + first.descent)) / 2;
      const lastInkBottom = el.y + last.slot * lay.lineH + (lay.lineH + (last.ascent + last.descent)) / 2;
      ctx.lineWidth = Math.max(1.5, el.fontSize * 0.075);
      ctx.strokeStyle = el.color || '#000';
      ctx.beginPath();
      ctx.ellipse(midX, firstInkTop - ry * 0.3, rx, ry, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(midX, lastInkBottom + ry * 1.5, rx, ry, 0, 0, Math.PI);
      ctx.stroke();
    }

    ctx.textAlign = 'left';
    lay.lines.forEach(function (line) {
      const visualW = Math.max(0, line.width - spacing);
      let x = el.x + (el.vertical ? line.x + (el.fontSize * 1.12) / 2 : 0);
      if (el.vertical) {
        ctx.textAlign = 'center';
      } else if (el.align === 'center') {
        x = el.x + (boxW - visualW) / 2;
      } else if (el.align === 'right') {
        x = el.x + boxW - visualW;
      }
      const slotTop = el.y + line.slot * lay.lineH;
      const baseline = slotTop + (lay.lineH - (line.ascent + line.descent)) / 2 + line.ascent;
      ctx.fillText(line.text, x, baseline);
      if (el.vertical) ctx.textAlign = 'left';
    });

    ctx.restore();
  }

  /* --------------------------- 通用变换 --------------------------- */
  function withTransform(ctx, el, draw) {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (el.rotation) ctx.rotate(el.rotation * Math.PI / 180);
    if (el.flipX || el.flipY) ctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
    ctx.translate(-cx, -cy);
    draw();
    ctx.restore();
  }
  A.withTransform = withTransform;

  function drawImageLayer(ctx, el, img) {
    if (!img) return;
    withTransform(ctx, el, function () {
      ctx.globalAlpha = el.opacity == null ? 1 : el.opacity;
      ctx.drawImage(img, el.x, el.y, el.w, el.h);
    });
  }

  /* ---------------------------- 主绘制 ---------------------------- */
  A.draw = function (ctx, opts) {
    opts = opts || {};
    const p = A.state.project;
    const ctxZoom = opts.zoom || 1;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, A.DESIGN.w, A.DESIGN.h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, p.width || A.DESIGN.w, p.height || A.DESIGN.h);

    // 1. 模板
    if (p.template && p.template.visible) {
      const img = A.readyImage(p.template);
      if (img) {
        const el = p.template;
        ctx.save();
        ctx.globalAlpha = el.opacity == null ? 1 : el.opacity;
        withTransform(ctx, el, function () { ctx.drawImage(img, el.x, el.y, el.w, el.h); });
        ctx.restore();
      }
    }

    // 2. 照片（可限制在取景框内）
    const frame = p.frame || { x: 0, y: 0, w: p.width, h: p.height };
    p.photos.forEach(function (el) {
      if (!el.visible) return;
      const img = A.readyImage(el);
      if (!img) return;
      ctx.save();
      if (frame.clip !== false) {
        ctx.beginPath();
        ctx.rect(frame.x, frame.y, frame.w, frame.h);
        ctx.clip();
      }
      drawImageLayer(ctx, el, img);
      ctx.restore();
    });

    // 3. 文字
    p.texts.forEach(function (el) { drawText(ctx, el); });

    // 4. 辅助线
    if (opts.guides) {
      ctx.save();
      ctx.lineWidth = 1 / ctxZoom;
      ctx.setLineDash([8 / ctxZoom, 6 / ctxZoom]);
      ctx.strokeStyle = 'rgba(86,140,255,.95)';
      ctx.strokeRect(frame.x, frame.y, frame.w, frame.h);
      ctx.setLineDash([]);
      if (!p.photos.length) {
        ctx.fillStyle = 'rgba(86,140,255,.55)';
        ctx.font = '28px "Microsoft YaHei"';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('点「添加图片」把照片放到这里', frame.x + frame.w / 2, frame.y + frame.h / 2);
        ctx.textAlign = 'left';
      }
      ctx.restore();
    }
    ctx.restore();
  };

  /* ---------------------------- 导出画布 ---------------------------- */
  A.exportCanvas = function (scale) {
    scale = scale || 1;
    const p = A.state.project;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((p.width || A.DESIGN.w) * scale);
    canvas.height = Math.round((p.height || A.DESIGN.h) * scale);
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    A.draw(ctx, { guides: false, zoom: 1 });
    return canvas;
  };

  /* --------------------------- 几何 / 命中 --------------------------- */
  A.bounds = function (el) {
    if (el.kind === 'text') {
      const lay = A.layout(el);
      const h = el.vertical ? Math.max(el.h, lay.height) : Math.max(lay.height, el.fontSize);
      return { x: el.x, y: el.y, w: el.w, h: h };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  };

  function toLocal(el, px, py) {
    const b = A.bounds(el);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const rad = -(el.rotation || 0) * Math.PI / 180;
    const dx = px - cx;
    const dy = py - cy;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, b: b };
  }
  A.toLocal = toLocal;

  A.hitElement = function (px, py) {
    const p = A.state.project;
    if (!p) return null;
    const pad = 6;
    for (let i = p.texts.length - 1; i >= 0; i--) {
      const el = p.texts[i];
      if (!el.visible) continue;
      const l = toLocal(el, px, py);
      if (px >= l.b.x - pad && px <= l.b.x + l.b.w + pad && py >= l.b.y - pad && py <= l.b.y + l.b.h + pad) {
        // 旋转后再判断
        const lx = l.x, ly = l.y;
        if (lx >= l.b.x - pad && lx <= l.b.x + l.b.w + pad && ly >= l.b.y - pad && ly <= l.b.y + l.b.h + pad) {
          return { kind: 'text', id: el.id, el: el };
        }
      }
    }
    for (let i = p.photos.length - 1; i >= 0; i--) {
      const el = p.photos[i];
      if (!el.visible) continue;
      const l = toLocal(el, px, py);
      if (l.x >= l.b.x && l.x <= l.b.x + l.b.w && l.y >= l.b.y && l.y <= l.b.y + l.b.h) {
        return { kind: 'photo', id: el.id, el: el };
      }
    }
    const f = p.frame;
    if (f && f.visible) {
      const near = 10;
      const onEdge = (Math.abs(px - f.x) < near || Math.abs(px - (f.x + f.w)) < near ||
        Math.abs(py - f.y) < near || Math.abs(py - (f.y + f.h)) < near) &&
        px >= f.x - near && px <= f.x + f.w + near && py >= f.y - near && py <= f.y + f.h + near;
      if (onEdge) return { kind: 'frame', id: null, el: f };
      if (px >= f.x && px <= f.x + f.w && py >= f.y && py <= f.y + f.h) return { kind: 'frameEmpty', id: null, el: f };
    }
    if (p.template && p.template.visible) return { kind: 'template', id: p.template.id, el: p.template };
    return null;
  };

  /* ------------------------- 照片自适应摆放 ------------------------- */
  A.fitPhoto = function (frame, el, img, mode) {
    const ir = img.width / img.height;
    const fr = frame.w / frame.h;
    let w, h;
    if (mode === 'contain') {
      if (ir > fr) { w = frame.w; h = frame.w / ir; } else { h = frame.h; w = frame.h * ir; }
    } else {
      if (ir > fr) { h = frame.h; w = frame.h * ir; } else { w = frame.w; h = frame.w / ir; }
    }
    el.w = w;
    el.h = h;
    el.x = frame.x + (frame.w - w) / 2;
    el.y = frame.y + (frame.h - h) / 2;
    el.rotation = 0;
  };

})(window.App);
