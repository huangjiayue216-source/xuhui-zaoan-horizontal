/* 画布交互：选择 / 拖动 / 缩放 / 旋转 / 就地改字 / 缩放视图 */
window.App = window.App || {};
(function (A) {
  'use strict';

  const state = A.state;
  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');
  const stageWrap = document.querySelector('.stage-wrap');

  let drag = null;
  let inlineEdit = null;
  let spacePan = null;

  /* ------------------------------ 视图 ------------------------------ */
  function fitZoom() {
    const availW = stageWrap.clientWidth - 60;
    const availH = stageWrap.clientHeight - 54 - 44;
    return Math.max(0.05, Math.min(availW / A.DESIGN.w, availH / A.DESIGN.h, 1));
  }

  A.editor = {
    zoom: function () {
      return (!state.zoom || state.zoom === 'fit') ? fitZoom() : state.zoom;
    },
    setZoom: function (z) {
      state.zoom = z;
      A.editor.applyZoom();
    },
    zoomFit: function () {
      state.zoom = 'fit';
      A.editor.applyZoom();
    },
    zoomIn: function () {
      A.editor.setZoom(Math.min(3, A.editor.zoom() * 1.25));
    },
    zoomOut: function () {
      A.editor.setZoom(Math.max(0.05, A.editor.zoom() / 1.25));
    },
    applyZoom: function () {
      const z = A.editor.zoom();
      canvas.style.width = Math.round(A.DESIGN.w * z) + 'px';
      canvas.style.height = Math.round(A.DESIGN.h * z) + 'px';
      const label = document.getElementById('zoomLabel');
      if (label) label.textContent = Math.round(z * 100) + '%';
      A.editor.render();
    },
    render: function () {
      if (!state.project) return;
      A.draw(ctx, { guides: state.guides, zoom: A.editor.zoom() });
      drawSelection();
    },
    init: function () {
      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      canvas.addEventListener('dblclick', onDoubleClick);
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
      window.addEventListener('resize', function () { if (!state.zoom || state.zoom === 'fit') A.editor.applyZoom(); });
      A.on('change', function () { A.editor.render(); });
      A.on('selection', function () { A.editor.render(); });
      A.on('image', function () { A.editor.render(); });
      A.editor.applyZoom();
    }
  };

  /* --------------------------- 坐标换算 --------------------------- */
  function toCanvas(ev) {
    const r = canvas.getBoundingClientRect();
    const z = A.editor.zoom();
    return { x: (ev.clientX - r.left) / z, y: (ev.clientY - r.top) / z };
  }

  function rot(px, py, cx, cy, deg) {
    const rad = deg * Math.PI / 180;
    const dx = px - cx;
    const dy = py - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad)
    };
  }

  /* --------------------------- 选择框绘制 --------------------------- */
  function geoOf(el) {
    if (!el) return null;
    if (el.kind === 'frame') {
      return { x: el.x, y: el.y, w: el.w, h: el.h, rot: 0, el: el, frame: true };
    }
    const b = el.kind === 'text' ? A.bounds(el) : { x: el.x, y: el.y, w: el.w, h: el.h };
    return { x: b.x, y: b.y, w: b.w, h: b.h, rot: el.rotation || 0, el: el };
  }

  function cornerPoint(geo, sx, sy) {
    const cx = geo.x + geo.w / 2;
    const cy = geo.y + geo.h / 2;
    const p = { x: cx + sx * geo.w / 2, y: cy + sy * geo.h / 2 };
    return rot(p.x, p.y, cx, cy, geo.rot);
  }

  function handlePoints(geo) {
    const list = [];
    const corners = [[-1, -1, 'nw'], [1, -1, 'ne'], [1, 1, 'se'], [-1, 1, 'sw']];
    corners.forEach(function (c) {
      list.push({ id: c[2], type: 'scale', sx: c[0], sy: c[1], p: cornerPoint(geo, c[0], c[1]) });
    });
    const isText = geo.el && geo.el.kind === 'text';
    const verticalText = isText && geo.el.vertical;
    const edges = [[0, -1, 'n'], [1, 0, 'e'], [0, 1, 's'], [-1, 0, 'w']];
    edges.forEach(function (e) {
      if (isText && !verticalText && (e[2] === 'n' || e[2] === 's')) return; // 横排文字高度自适应
      list.push({ id: e[2], type: 'edge', sx: e[0], sy: e[1], p: cornerPoint(geo, e[0], e[1]) });
    });
    const cx = geo.x + geo.w / 2;
    const cy = geo.y + geo.h / 2;
    const top = rot(cx, geo.y, cx, cy, geo.rot);
    const len = 30 / A.editor.zoom();
    const rad = (geo.rot - 90) * Math.PI / 180;
    list.push({
      id: 'rot', type: 'rotate', p: { x: top.x + Math.cos(rad) * len, y: top.y + Math.sin(rad) * len },
      from: top
    });
    return list;
  }

  function drawSelection() {
    const el = A.selected();
    if (!el) return;
    const geo = geoOf(el);
    if (!geo) return;
    const z = A.editor.zoom();
    const s = 8 / z;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.lineWidth = 1.5 / z;
    ctx.strokeStyle = '#3d8bff';

    const pts = [cornerPoint(geo, -1, -1), cornerPoint(geo, 1, -1), cornerPoint(geo, 1, 1), cornerPoint(geo, -1, 1)];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.stroke();

    handlePoints(geo).forEach(function (h) {
      if (h.type === 'rotate') {
        ctx.beginPath();
        ctx.moveTo(h.from.x, h.from.y);
        ctx.lineTo(h.p.x, h.p.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.p.x, h.p.y, s * 0.8, 0, Math.PI * 2);
        ctx.fillStyle = '#3d8bff';
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.rect(h.p.x - s / 2, h.p.y - s / 2, s, s);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
      }
    });
    ctx.restore();
  }

  function pickHandle(pt) {
    const el = A.selected();
    if (!el) return null;
    const geo = geoOf(el);
    if (!geo) return null;
    const r = 11 / A.editor.zoom();
    const handles = handlePoints(geo);
    for (let i = 0; i < handles.length; i++) {
      const h = handles[i];
      if (Math.abs(pt.x - h.p.x) <= r && Math.abs(pt.y - h.p.y) <= r) return h;
    }
    return null;
  }

  /* --------------------------- 指针交互 --------------------------- */
  function onPointerDown(ev) {
    if (ev.button !== 0 || !state.project) return;
    finishInlineEdit(true);
    const pt = toCanvas(ev);

    const handle = pickHandle(pt);
    if (handle) {
      startTransform(ev, pt, handle);
      return;
    }

    const hit = A.hitElement(pt.x, pt.y);
    if (!hit || hit.kind === 'frameEmpty') {
      A.select(null);
      return;
    }
    const el = hit.kind === 'template' ? state.project.template : A.findElement(hit);
    if (!el) return;
    A.select(hit.kind, hit.id);

    A.snapshot();
    drag = {
      mode: 'move',
      el: el,
      kind: hit.kind,
      startX: pt.x,
      startY: pt.y,
      orig: { x: el.x, y: el.y }
    };
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* 合成事件没有真实指针 */ }
  }

  function startTransform(ev, pt, handle) {
    const el = A.selected();
    if (!el) return;
    const geo = geoOf(el);
    A.snapshot();
    const base = {
      x: geo.x, y: geo.y, w: geo.w, h: geo.h, rot: geo.rot,
      fontSize: el.fontSize, lineHeight: el.lineHeight
    };
    if (handle.type === 'rotate') {
      const cx = geo.x + geo.w / 2;
      const cy = geo.y + geo.h / 2;
      drag = {
        mode: 'rotate', el: el, base: base,
        cx: cx, cy: cy,
        startAngle: Math.atan2(pt.y - cy, pt.x - cx) * 180 / Math.PI,
        startRot: geo.rot
      };
    } else {
      const fixed = { sx: -handle.sx, sy: -handle.sy };
      const fixedPt = cornerPoint(geo, fixed.sx, fixed.sy);
      drag = {
        mode: handle.type === 'scale' ? 'scale' : 'edge',
        el: el, base: base, fixed: fixed, fixedPt: fixedPt,
        sx: handle.sx, sy: handle.sy
      };
    }
    try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
  }

  function onPointerMove(ev) {
    if (!drag || !state.project) return;
    const pt = toCanvas(ev);

    if (drag.mode === 'move') {
      drag.el.x = drag.orig.x + (pt.x - drag.startX);
      drag.el.y = drag.orig.y + (pt.y - drag.startY);
      A.editor.render();
      return;
    }

    if (drag.mode === 'rotate') {
      const ang = Math.atan2(pt.y - drag.cy, pt.x - drag.cx) * 180 / Math.PI;
      let next = drag.startRot + (ang - drag.startAngle);
      if (ev.shiftKey) next = Math.round(next / 15) * 15;
      drag.el.rotation = Math.round(next * 10) / 10;
      A.editor.render();
      return;
    }

    const b = drag.base;
    const local = rot(pt.x, pt.y, drag.fixedPt.x, drag.fixedPt.y, -b.rot);
    const dx = local.x - drag.fixedPt.x;
    const dy = local.y - drag.fixedPt.y;
    let w = Math.max(6, drag.sx === 0 ? b.w : drag.sx * dx);
    let h = Math.max(6, drag.sy === 0 ? b.h : drag.sy * dy);

    const isPhoto = drag.el.kind === 'photo' || drag.el.kind === 'template';
    let uniform;
    if (drag.el.kind === 'frame') uniform = false;
    else if (isPhoto) uniform = !ev.shiftKey;
    else uniform = true;

    if (drag.mode === 'scale') {
      if (uniform) {
        const s = Math.max(w / b.w, h / b.h);
        w = b.w * s;
        h = b.h * s;
      }
      if (drag.el.kind === 'text') {
        const s = uniform ? Math.max(w / b.w, h / b.h) : Math.max(w / b.w, h / b.h);
        drag.el.fontSize = Math.max(6, Math.round(b.fontSize * s * 10) / 10);
        w = b.w * s;
        h = b.h * s;
        drag.el.w = w;
        drag.el.h = h;
      } else {
        drag.el.w = w;
        drag.el.h = h;
      }
    } else {
      if (drag.sy === 0) {
        drag.el.w = w;
      } else {
        drag.el.h = h;
      }
    }

    // 保持对角的固定点不动
    const newW = drag.el.w;
    const newH = drag.el.h;
    const offset = rot(drag.sx * newW / 2, drag.sy * newH / 2, 0, 0, b.rot);
    const cxNew = drag.fixedPt.x + offset.x;
    const cyNew = drag.fixedPt.y + offset.y;
    drag.el.x = cxNew - newW / 2;
    drag.el.y = cyNew - newH / 2;
    A.editor.render();
  }

  function onPointerUp() {
    if (!drag) return;
    const wasMove = drag.mode;
    drag = null;
    A.touch();
    A.emit('selection', state.selection);
    if (wasMove) A.editor.render();
  }

  /* --------------------------- 就地编辑文字 --------------------------- */
  function onDoubleClick(ev) {
    const pt = toCanvas(ev);
    const hit = A.hitElement(pt.x, pt.y);
    if (!hit || hit.kind !== 'text') return;
    const el = A.findElement(hit);
    if (!el) return;
    A.select('text', el.id);
    if (el.vertical) {
      // 竖排文字（周几）在左侧「日期」里改更顺手
      const box = document.getElementById('f-week');
      if (box) { box.focus(); box.select(); }
      return;
    }
    startInlineEdit(el);
  }

  function startInlineEdit(el) {
    finishInlineEdit(true);
    const z = A.editor.zoom();
    const b = A.bounds(el);
    const stageRect = document.querySelector('.stage').getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const area = document.createElement('textarea');
    area.className = 'inline-edit';
    area.value = el.text;
    const left = canvasRect.left - stageRect.left + b.x * z;
    const top = canvasRect.top - stageRect.top + b.y * z;
    area.style.cssText = [
      'position:absolute',
      'left:' + left + 'px',
      'top:' + top + 'px',
      'width:' + Math.max(40, b.w * z) + 'px',
      'height:' + Math.max(24, b.h * z) + 'px',
      'font:' + (el.italic ? 'italic ' : '') + (el.fontWeight || 400) + ' ' + (el.fontSize * z) + 'px "' + el.fontFamily + '"',
      'line-height:' + (el.lineHeight * el.fontSize * z) + 'px',
      'color:' + el.color,
      'text-align:' + (el.align || 'left'),
      'background:rgba(255,255,255,.78)',
      'border:1px solid #3d8bff',
      'border-radius:4px',
      'padding:0',
      'resize:none',
      'overflow:hidden',
      'outline:none',
      'z-index:9',
      'transform-origin:center center'
    ].join(';');
    if (el.rotation) area.style.transform = 'rotate(' + el.rotation + 'deg)';
    const parent = document.querySelector('.stage');
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    parent.appendChild(area);
    area.focus();
    area.select();
    area.addEventListener('input', function () {
      el.text = area.value;
      A.layoutCacheReset && A.layoutCacheReset();
      A.touch();
    });
    area.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { finishInlineEdit(true); }
      e.stopPropagation();
    });
    area.addEventListener('blur', function () { finishInlineEdit(false); });
    inlineEdit = { el: el, area: area };
  }

  function finishInlineEdit(commit) {
    if (!inlineEdit) return;
    const { area } = inlineEdit;
    inlineEdit = null;
    if (commit) A.layoutCacheReset && A.layoutCacheReset();
    try { area.remove(); } catch (e) { /* ignore */ }
    A.touch();
    A.emit('selection', state.selection);
  }
  A.finishInlineEdit = finishInlineEdit;

})(window.App);
