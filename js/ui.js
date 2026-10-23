/* 界面层：日期 / 图片 / 配文 三个板块 + 导出 + 画布交互辅助 */
window.App = window.App || {};
(function (A) {
  'use strict';

  const state = A.state;
  const $ = function (id) { return document.getElementById(id); };

  /* ---------------------------- 提示条 ---------------------------- */
  A.toast = function (msg, kind) {
    const wrap = $('toasts');
    const node = document.createElement('div');
    node.className = 'toast ' + (kind || '');
    node.textContent = msg;
    wrap.appendChild(node);
    setTimeout(function () {
      node.style.transition = 'opacity .3s';
      node.style.opacity = '0';
      setTimeout(function () { node.remove(); }, 320);
    }, 3000);
  };

  /* ---------------------------- 常用查询 ---------------------------- */
  function textEl(id) {
    const p = state.project;
    if (!p) return null;
    return p.texts.find(function (t) { return t.id === id; }) || null;
  }

  function currentPhoto() {
    const p = state.project;
    if (!p || !p.photos.length) return null;
    const sel = A.selected();
    if (sel && sel.kind === 'photo') return sel;
    return p.photos[p.photos.length - 1];
  }

  /* ------------------------- 输入控件绑定 ------------------------- */
  function bindControl(node, read, apply, opts) {
    opts = opts || {};
    const fire = function () {
      apply(read());
      A.layoutCacheReset();
      A.touch();
    };
    if (opts.discrete) {
      node.addEventListener('change', function () { A.snapshot(); fire(); });
    } else {
      let focused = false;
      node.addEventListener('focus', function () { if (!focused) { focused = true; A.snapshot(); } });
      node.addEventListener('blur', function () { focused = false; });
      node.addEventListener('input', fire);
    }
  }

  /* ---------------------------- 日期板块 ---------------------------- */
  const DATE_FIELDS = [
    ['f-month', 't-month'],
    ['f-date', 't-date'],
    ['f-week', 't-weekday'],
    ['f-lunar-year', 't-lunar-year'],
    ['f-lunar-month', 't-lunar-month']
  ];

  const CN_MONTH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
  const CN_WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const CN_DAY = ['初一', '初二', '初三', '初四', '初五', '初六', '初七', '初八', '初九', '初十',
    '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
    '廿一', '廿二', '廿三', '廿四', '廿五', '廿六', '廿七', '廿八', '廿九', '三十'];
  const ZODIAC = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

  /* 公历 → 农历（用浏览器内置的中国农历 ICU 数据，含闰月）
     返回 { year: '丙午马年', monthDay: '九月初三' }，不支持时返回 null */
  function lunarInfo(date) {
    try {
      const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
        year: 'numeric', month: 'long', day: 'numeric'
      }).formatToParts(date);
      const get = function (type) {
        const hit = parts.find(function (p) { return p.type === type; });
        return hit ? hit.value : '';
      };
      const yearName = get('yearName');
      const monthName = get('month');
      const dayNum = parseInt(get('day'), 10);
      const relatedYear = parseInt(get('relatedYear'), 10) || date.getFullYear();
      if (!yearName || !monthName || !dayNum) return null;
      const zodiac = ZODIAC[(((relatedYear - 4) % 12) + 12) % 12];
      return {
        year: yearName + zodiac + '年',
        monthDay: monthName + (CN_DAY[dayNum - 1] || '')
      };
    } catch (e) {
      return null;
    }
  }

  function todayString(offsetDays) {
    const d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fillGregorian(value) {
    if (!value) return;
    const parts = value.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(d.getTime())) return;
    const monthText = CN_MONTH[d.getMonth()];
    const dayText = String(d.getDate());
    const weekText = CN_WEEK[d.getDay()];
    const lunar = lunarInfo(d);
    A.commit(function (p) {
      const set = function (id, text) {
        const t = p.texts.find(function (x) { return x.id === id; });
        if (t) t.text = text;
      };
      set('t-month', monthText);
      set('t-date', dayText);
      set('t-weekday', weekText);
      if (lunar) {
        set('t-lunar-year', lunar.year);
        set('t-lunar-month', lunar.monthDay);
      }
    });
    A.layoutCacheReset();
    syncFields();
    A.toast('已填入 ' + monthText + ' / ' + dayText + ' / ' + weekText +
      '，农历 ' + (lunar ? lunar.year + ' ' + lunar.monthDay : '未识别（浏览器不支持农历转换）'));
  }

  /* ---------------------------- 图片板块 ---------------------------- */
  function deletePhoto() {
    const ph = currentPhoto();
    if (!ph) { A.toast('还没有照片，先点「上传 / 替换照片」'); return; }
    A.commit(function (p) {
      p.photos = p.photos.filter(function (x) { return x.id !== ph.id; });
    });
    A.select(null);
    A.toast('照片已删除，可用「撤销」找回');
  }

  function fillFrame() {
    const ph = currentPhoto();
    if (!ph) { A.toast('还没有照片，先点「上传 / 替换照片」'); return; }
    const img = A.readyImage(ph);
    if (!img) return;
    A.commit(function () { A.fitPhoto(state.project.frame, ph, img, 'cover'); });
    A.select('photo', ph.id);
  }

  function targetForUpload() {
    const p = state.project;
    if (!p || !p.photos.length) return null;
    const sel = A.selected();
    if (sel && sel.kind === 'photo') return sel;
    if (p.photos.length === 1) return p.photos[0];
    return null;
  }

  let pendingReplaceId = null;

  function addOrReplacePhoto(dataUrl, name) {
    const img = new Image();
    img.onload = function () {
      const assetId = A.addAsset(dataUrl);
      const existing = pendingReplaceId ? state.project.photos.find(function (x) { return x.id === pendingReplaceId; }) : null;
      if (existing) {
        A.snapshot();
        existing.assetId = assetId;
        existing.src = null;
        existing.name = name || existing.name;
        A.fitPhoto(state.project.frame, existing, img, 'cover');
        A.touch();
        A.select('photo', existing.id);
        A.toast('照片已替换');
      } else {
        const el = {
          id: A.uid('photo'), kind: 'photo', name: name || '照片',
          assetId: assetId, src: null,
          x: 0, y: 0, w: 100, h: 100, rotation: 0, opacity: 1, visible: true, flipX: false, flipY: false
        };
        A.fitPhoto(state.project.frame, el, img, 'cover');
        A.commit(function (p) { p.photos.push(el); });
        A.select('photo', el.id);
        A.toast('照片已放入照片区，可以直接在画面里拖动 / 缩放 / 旋转');
      }
      pendingReplaceId = null;
    };
    img.onerror = function () {
      pendingReplaceId = null;
      A.toast('这张图片读不出来，换一张试试', 'err');
    };
    img.src = dataUrl;
  }

  function readImageFile(file, done) {
    const reader = new FileReader();
    reader.onload = function () { done(String(reader.result), file.name.replace(/\.[^.]+$/, '')); };
    reader.readAsDataURL(file);
  }

  /* ---------------------------- 配文板块 ---------------------------- */
  function caption() { return textEl('t-caption'); }

  function syncFields() {
    const p = state.project;
    if (!p) return;
    DATE_FIELDS.forEach(function (pair) {
      const input = $(pair[0]);
      if (!input || document.activeElement === input) return;
      const t = textEl(pair[1]);
      input.value = t ? t.text : '';
    });
    const cap = caption();
    const area = $('captionText');
    if (area && document.activeElement !== area && cap) area.value = cap.text;
    if (cap) {
      const size = $('captionSize');
      if (size && document.activeElement !== size) size.value = Math.round(cap.fontSize);
    }
    const name = $('docName');
    if (name) name.textContent = p.name || '徐汇你早';
  }

  /* ------------------------------ 导出 ------------------------------ */
  function downloadPng() {
    const canvas = A.exportCanvas(1);
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = '徐汇你早-横版-' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') +
      String(d.getDate()).padStart(2, '0') + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    A.toast('已导出图片（PNG）');
  }

  /* ---------------------------- 事件绑定 ---------------------------- */
  function bindDate() {
    DATE_FIELDS.forEach(function (pair) {
      const input = $(pair[0]);
      if (!input) return;
      bindControl(input, function () { return input.value; }, function (v) {
        const t = textEl(pair[1]);
        if (t) t.text = v;
      });
    });
    const dateInput = $('dateHelper');
    dateInput.value = todayString(0);
    $('btnToday').onclick = function () {
      dateInput.value = todayString(0);
      fillGregorian(dateInput.value);
    };
    $('btnFillDate').onclick = function () { fillGregorian(dateInput.value); };
  }

  function bindPhoto() {
    $('fileImage').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) { pendingReplaceId = null; return; }
      readImageFile(file, addOrReplacePhoto);
    });

    $('btnPhotoUpload').onclick = function () {
      const target = targetForUpload();
      pendingReplaceId = target ? target.id : null;
      $('fileImage').click();
    };
    $('btnPhotoDelete').onclick = deletePhoto;
    $('btnPhotoCenter').onclick = fillFrame;

    $('fileTemplate').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      readImageFile(file, function (dataUrl) {
        const img = new Image();
        img.onload = function () {
          const assetId = A.addAsset(dataUrl);
          A.commit(function (p) {
            p.template.assetId = assetId;
            p.template.src = null;
            p.template.visible = true;
            const s = Math.min(A.DESIGN.w / img.width, A.DESIGN.h / img.height) || 1;
            p.template.w = img.width * s;
            p.template.h = img.height * s;
            p.template.x = (A.DESIGN.w - p.template.w) / 2;
            p.template.y = (A.DESIGN.h - p.template.h) / 2;
            p.template.rotation = 0;
          });
          A.select('template');
          A.toast('模板已替换');
        };
        img.src = dataUrl;
      });
    });

    $('btnTemplateUpload').onclick = function () { $('fileTemplate').click(); };
    $('btnTemplateReset').onclick = function () {
      A.commit(function (p) {
        p.template.src = 'assets/template.png';
        p.template.assetId = null;
        p.template.x = 0; p.template.y = 0;
        p.template.w = A.DESIGN.w; p.template.h = A.DESIGN.h;
        p.template.rotation = 0; p.template.opacity = 1; p.template.visible = true;
      });
      A.toast('已恢复默认模板');
    };
    $('btnTemplateDelete').onclick = function () {
      A.commit(function (p) { p.template.visible = false; });
      A.toast('模板已删除，可用「撤销」找回');
    };

    $('btnUndo').onclick = function () { if (!A.undo()) A.toast('没有可撤销的操作'); };
    $('btnRedo').onclick = function () { if (!A.redo()) A.toast('没有可重做的操作'); };
  }

  function bindCaption() {
    const area = $('captionText');
    bindControl(area, function () { return area.value; }, function (v) {
      const cap = caption();
      if (cap) cap.text = v;
    });
    bindControl($('captionSize'), function () { return parseFloat($('captionSize').value) || 50; }, function (v) {
      const cap = caption();
      if (cap) cap.fontSize = Math.max(12, Math.min(200, v));
    });
    $('captionCopy').onclick = function () {
      const cap = caption();
      if (!cap) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(cap.text).then(function () {
          A.toast('配文已复制到剪贴板');
        }).catch(function () { A.toast('复制失败，可以手动选中文字复制', 'err'); });
      } else {
        A.toast('浏览器不支持自动复制，请手动选中文字复制', 'err');
      }
    };
    $('captionPaste').onclick = function () {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        A.toast('浏览器不支持读取剪贴板，请用 Ctrl+V 粘贴到文本框里', 'err');
        return;
      }
      navigator.clipboard.readText().then(function (text) {
        if (!text) { A.toast('剪贴板里没有文字', 'err'); return; }
        A.snapshot();
        const cap = caption();
        if (cap) cap.text = text;
        A.layoutCacheReset();
        A.touch();
        syncFields();
        A.toast('已粘贴到配文');
      }).catch(function () { A.toast('读取剪贴板失败，请用 Ctrl+V 粘到文本框里', 'err'); });
    };
  }

  function bindCommon() {
    $('btnExportPng').onclick = downloadPng;
    $('btnZoomIn').onclick = function () { A.editor.zoomIn(); };
    $('btnZoomOut').onclick = function () { A.editor.zoomOut(); };
    $('btnZoomFit').onclick = function () { A.editor.zoomFit(); };

    // 直接把图片拖进网页 = 上传照片
    ['dragenter', 'dragover'].forEach(function (type) {
      document.addEventListener(type, function (e) {
        if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      });
    });
    document.addEventListener('drop', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!/^image\//.test(file.type)) { A.toast('只能拖入图片文件', 'err'); return; }
      const target = targetForUpload();
      pendingReplaceId = target ? target.id : null;
      readImageFile(file, addOrReplacePhoto);
    });
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      const tag = (e.target.tagName || '').toLowerCase();
      const editing = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (e.key === 'Escape') { if (!editing) A.select(null); return; }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) A.redo(); else A.undo(); return; }
      if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); A.redo(); return; }
      if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); A.saveNow(); return; }
      if (editing) return;
      if (ctrl && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        const sel = A.selected();
        const text = sel && sel.kind === 'text' ? sel.text : (caption() ? caption().text : '');
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
        A.toast('已复制文字');
        return;
      }
      if (ctrl && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        if (navigator.clipboard && navigator.clipboard.read) {
          navigator.clipboard.read().then(function (items) {
            for (let i = 0; i < items.length; i++) {
              const type = items[i].types.filter(function (t) { return t.indexOf('image/') === 0; })[0];
              if (!type) continue;
              items[i].getType(type).then(function (blob) {
                const reader = new FileReader();
                reader.onload = function () { addOrReplacePhoto(String(reader.result), '剪贴板图片'); };
                reader.readAsDataURL(blob);
              });
              return;
            }
            navigator.clipboard.readText().then(function (text) {
              if (!text) return;
              A.snapshot();
              const sel2 = A.selected();
              if (sel2 && sel2.kind === 'text') { sel2.text = text; } else if (caption()) { caption().text = text; }
              A.layoutCacheReset();
              A.touch();
              syncFields();
              A.toast('已粘贴文字');
            }).catch(function () { /* ignore */ });
          }).catch(function () { A.toast('读取剪贴板失败，试试直接拖图片进来', 'err'); });
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = A.selected();
        if (!sel) return;
        e.preventDefault();
        if (sel.kind === 'photo') deletePhoto();
        else if (sel.kind === 'template') { A.commit(function (p) { p.template.visible = false; }); A.toast('模板已删除，可用「撤销」找回'); }
        else if (sel.kind === 'text') A.commit(function (p) { p.texts = p.texts.filter(function (x) { return x.id !== sel.id; }); });
        return;
      }
      if (e.key.indexOf('Arrow') === 0) {
        const sel = A.selected();
        if (!sel) return;
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        if (!dx && !dy) return;
        e.preventDefault();
        A.snapshot();
        sel.x += dx;
        sel.y += dy;
        A.touch();
      }
    });
  }

  A.ui = {
    init: function () {
      state.guides = true;
      bindDate();
      bindPhoto();
      bindCaption();
      bindCommon();
      bindKeys();
      A.on('change', function () {
        syncFields();
        $('btnUndo').disabled = !state.past.length;
        $('btnRedo').disabled = !state.future.length;
      });
      A.on('selection', function () { syncFields(); });
      A.on('status', function (info) {
        const node = $('saveState');
        node.textContent = info.text;
        node.className = 'pill ' + (info.cls || '');
      });
      A.on('remote-change', function () {
        A.toast('另一个窗口也在修改，本窗口保存时会覆盖为当前内容', 'err');
      });
      syncFields();
    }
  };

})(window.App);
