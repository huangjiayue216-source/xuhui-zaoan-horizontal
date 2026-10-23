/* 数据层：模型 / 历史 / 资源 / 自动保存 / 多窗口同步 */
window.App = window.App || {};
(function (A) {
  'use strict';

  A.DESIGN = { w: 1970, h: 2773 };

  /* ---- 默认底图设置（换底图时由「换底图.bat」自动修改下面 3 行）---- */
  A.TEMPLATE_VERSION = 1;
  A.TEMPLATE_SRC = 'assets/template.png';
  A.FRAME_DEFAULT = { x: 90, y: 852, w: 1784, h: 1190 };
  A.LAYOUT_VERSION = 2;

  let seed = 0;
  A.uid = function (prefix) {
    seed += 1;
    return (prefix || 'el') + '-' + Date.now().toString(36) + '-' + seed.toString(36) + Math.random().toString(36).slice(2, 6);
  };

  /* ---------------------------- 事件总线 ---------------------------- */
  const listeners = {};
  A.on = function (name, fn) {
    (listeners[name] || (listeners[name] = [])).push(fn);
  };
  A.emit = function (name, payload) {
    (listeners[name] || []).forEach(function (fn) {
      try { fn(payload); } catch (err) { console.error(err); }
    });
  };

  /* ---------------------------- 默认项目 ---------------------------- */
  A.defaultProject = function () {
    const D = A.DESIGN;
    return {
      name: '徐汇你早（横版）',
      width: D.w,
      height: D.h,
      template: {
        id: 'template-1', kind: 'template', src: A.TEMPLATE_SRC, assetId: null,
        x: 0, y: 0, w: D.w, h: D.h, rotation: 0, opacity: 1, visible: true, locked: false
      },
      frame: {
        x: A.FRAME_DEFAULT.x, y: A.FRAME_DEFAULT.y,
        w: A.FRAME_DEFAULT.w, h: A.FRAME_DEFAULT.h,
        clip: true, visible: true
      },
      templateVersion: A.TEMPLATE_VERSION,
      photos: [],
      texts: [
        {
          id: 't-month', kind: 'text', name: '月份', text: '十月',
          x: 222, y: 91, w: 444, h: 245, rotation: 0, opacity: 1, visible: true,
          fontFamily: 'XHSerif', fontSize: 245, fontWeight: 700, italic: false,
          color: '#ffffff', align: 'center', lineHeight: 1, letterSpacing: 0,
          vertical: false, parens: false, nowrap: true
        },
        {
          id: 't-date', kind: 'text', name: '阳历日期', text: '12',
          x: 222, y: 376, w: 444, h: 220, rotation: 0, opacity: 1, visible: true,
          fontFamily: 'XHSerif', fontSize: 220, fontWeight: 700, italic: false,
          color: '#ffffff', align: 'right', lineHeight: 1, letterSpacing: 0,
          vertical: false, parens: false, nowrap: true
        },
        {
          id: 't-weekday', kind: 'text', name: '周几（竖排）', text: '周一',
          x: 330, y: 436, w: 74, h: 109, rotation: 0, opacity: 1, visible: true,
          fontFamily: 'XHSerif', fontSize: 58, fontWeight: 700, italic: false,
          color: '#ffffff', align: 'center', lineHeight: 0.94, letterSpacing: 0,
          vertical: true, parens: true, oneCol: true
        },
        {
          id: 't-lunar-year', kind: 'text', name: '农历年份', text: '丙午马年',
          x: 222, y: 658, w: 444, h: 49, rotation: 0, opacity: 1, visible: true,
          fontFamily: 'XHSerif', fontSize: 49, fontWeight: 700, italic: false,
          color: '#ffffff', align: 'left', lineHeight: 1, letterSpacing: 0,
          vertical: false, parens: false, nowrap: true
        },
        {
          id: 't-lunar-month', kind: 'text', name: '农历月份', text: '九月初三',
          x: 222, y: 658, w: 444, h: 49, rotation: 0, opacity: 1, visible: true,
          fontFamily: 'XHSerif', fontSize: 49, fontWeight: 700, italic: false,
          color: '#ffffff', align: 'right', lineHeight: 1, letterSpacing: 0,
          vertical: false, parens: false, nowrap: true
        },
        {
          id: 't-caption', kind: 'text', name: '标题文字', text: '香“疯”了!每天一万多人来徐汇人气公园，本地居民还有一个私藏赏桂地。',
          x: 86, y: 2087, w: 1600, h: 186, rotation: 0, opacity: 1, visible: true,
          fontFamily: 'XHSerif', fontSize: 67, fontWeight: 700, italic: false,
          color: '#1b1b1b', align: 'left', lineHeight: 1.39, letterSpacing: 0,
          vertical: false, parens: false
        }
      ]
    };
  };

  /* ------------------------------ 状态 ------------------------------ */
  const state = A.state = {
    project: null,
    assets: {},
    rev: -1,
    remote: null,
    dirty: false,
    saving: false,
    offline: false,
    lastSaved: null,
    selection: null,
    zoom: 0,
    guides: true,
    past: [],
    future: [],
    clipboard: null,
    preview: null
  };

  const HISTORY_LIMIT = 60;

  A.clone = function (obj) { return JSON.parse(JSON.stringify(obj)); };

  /* 旧数据修正：早期版本「周几」的竖排行距偏大，这里按原版样式纠正一次 */
  function migrate(project) {
    if (!project) return project;

    // 画布尺寸始终与当前设计一致（旧存档/导入项目也会被纠正）
    project.width = A.DESIGN.w;
    project.height = A.DESIGN.h;

    /* 底图（模板）换版本时：默认底图与照片区跟着更新。
       注意：这里只改「背景模板」，用户上传的照片、照片位置和文字都不动。*/
    const tpl = project.template;
    if (tpl && !tpl.assetId) {
      tpl.src = A.TEMPLATE_SRC;
      if (tpl.visible === undefined) tpl.visible = true;
      if (project.templateVersion !== A.TEMPLATE_VERSION) {
        tpl.x = 0; tpl.y = 0;
        tpl.w = A.DESIGN.w; tpl.h = A.DESIGN.h;
        tpl.rotation = 0; tpl.opacity = 1; tpl.visible = true;
        if (project.frame) {
          project.frame.x = A.FRAME_DEFAULT.x;
          project.frame.y = A.FRAME_DEFAULT.y;
          project.frame.w = A.FRAME_DEFAULT.w;
          project.frame.h = A.FRAME_DEFAULT.h;
          project.frame.clip = true;
          project.frame.visible = true;
        }
      }
    }
    project.templateVersion = A.TEMPLATE_VERSION;

    /* 日历区域 5 段文字以设计稿为准：位置/字号一旦偏离就自动纠正（保留文字内容） */
    {
      const defs = A.defaultProject();
      ['t-month', 't-date', 't-weekday', 't-lunar-year', 't-lunar-month'].forEach(function (id) {
        const t = (project.texts || []).find(function (x) { return x.id === id; });
        const d = defs.texts.find(function (x) { return x.id === id; });
        if (!t || !d) return;
        const bad = Math.abs((t.x || 0) - d.x) > 6 ||
          Math.abs((t.y || 0) - d.y) > 6 ||
          Math.abs((t.w || 0) - d.w) > 8 ||
          Math.abs((t.fontSize || 0) - d.fontSize) > 3 ||
          (t.align || '') !== d.align ||
          (!!t.vertical) !== (!!d.vertical);
        if (!bad) return;
        ['x', 'y', 'w', 'h', 'fontSize', 'lineHeight', 'align', 'vertical', 'parens',
          'nowrap', 'oneCol', 'rotation', 'letterSpacing', 'fontFamily', 'fontWeight'
        ].forEach(function (k) {
          if (d[k] !== undefined) t[k] = d[k];
        });
      });
      project.layoutVersion = A.LAYOUT_VERSION;
    }

    // 产品改名：旧存档里的项目名同步为「徐汇你早」
    if (project.name === '早安徐汇' || project.name === '你好徐汇' || !project.name) project.name = '徐汇你早';

    if (!project.texts) return project;
    const wk = project.texts.find(function (t) { return t.id === 't-weekday'; });
    if (wk) {
      if (Math.abs((wk.lineHeight || 0) - 1.23) < 0.02) {
        wk.lineHeight = 0.86;
        wk.y = 326;
        wk.h = 80;
      }
      wk.vertical = true;
      wk.parens = true;
      wk.oneCol = true;
      // 横版「周几」：固定为原版尺寸（在数字左侧、与数字等高），一次性修正旧项目
      // 若仍停在竖版旧坐标（206/326/44px），无论标记如何都自动纠正一次
      const legacyWk = Math.abs(wk.x - 206) < 2 && Math.abs(wk.y - 326) < 2 && Math.abs(wk.fontSize - 44) < 1;
      if (!project.fixWeekdayH || legacyWk) {
        wk.x = 330;
        wk.y = 436;
        wk.w = 74;
        wk.h = 109;
        wk.fontSize = 58;
        wk.lineHeight = 0.94;
        wk.rotation = 0;
        project.fixWeekdayH = true;
      }
    }
    // 统一改用内置的思源宋体 Bold
    if (!project.fixFont) {
      ['t-month', 't-date', 't-weekday', 't-lunar-year', 't-lunar-month', 't-caption'].forEach(function (id) {
        const t = project.texts.find(function (x) { return x.id === id; });
        if (t) { t.fontFamily = 'XHSerif'; t.fontWeight = 700; }
      });
      project.fixFont = true;
    }
    return project;
  }
  A.migrate = migrate;

  A.getProject = function () { return state.project; };

  A.findElement = function (sel) {
    if (!sel || !state.project) return null;
    const p = state.project;
    if (sel.kind === 'template') return p.template;
    if (sel.kind === 'frame') return p.frame;
    if (sel.kind === 'photo') return p.photos.find(function (x) { return x.id === sel.id; }) || null;
    if (sel.kind === 'text') return p.texts.find(function (x) { return x.id === sel.id; }) || null;
    return null;
  };

  A.selected = function () { return A.findElement(state.selection); };

  A.select = function (kind, id) {
    const next = kind ? { kind: kind, id: id || null } : null;
    const same = (!next && !state.selection) ||
      (next && state.selection && next.kind === state.selection.kind && next.id === state.selection.id);
    if (same) return;
    state.selection = next;
    A.emit('selection', next);
  };

  /* ------------------------------ 历史 ------------------------------ */
  function snapshot() {
    if (!state.project) return;
    state.past.push(JSON.stringify(state.project));
    if (state.past.length > HISTORY_LIMIT) state.past.shift();
    state.future.length = 0;
  }
  A.snapshot = snapshot;

  A.commit = function (fn) {
    snapshot();
    if (fn) fn(state.project);
    A.touch();
  };

  A.touch = function () {
    state.dirty = true;
    A.emit('change');
    scheduleSave();
  };

  A.undo = function () {
    if (!state.past.length) return false;
    state.future.push(JSON.stringify(state.project));
    state.project = JSON.parse(state.past.pop());
    afterHistoryChange();
    return true;
  };

  A.redo = function () {
    if (!state.future.length) return false;
    state.past.push(JSON.stringify(state.project));
    state.project = JSON.parse(state.future.pop());
    afterHistoryChange();
    return true;
  };

  function afterHistoryChange() {
    if (state.selection && !A.findElement(state.selection)) state.selection = null;
    state.dirty = true;
    A.emit('change');
    A.emit('selection', state.selection);
    scheduleSave();
  }

  /* ------------------------------ 图片 ------------------------------ */
  const imageCache = new Map();

  A.srcOf = function (layer) {
    if (!layer) return null;
    if (layer.assetId && state.assets[layer.assetId]) return state.assets[layer.assetId];
    return layer.src || null;
  };

  A.image = function (src) {
    if (!src) return null;
    let entry = imageCache.get(src);
    if (!entry) {
      const img = new Image();
      entry = { img: img, ready: false, failed: false };
      imageCache.set(src, entry);
      img.onload = function () {
        entry.ready = true;
        A.emit('image', src);
      };
      img.onerror = function () {
        // 兜底：底图用的是带版本号的文件但它已不存在时（例如浏览器还缓存着旧代码），
        // 自动回退到当前默认底图，避免出现「看不到底图」。
        const fallbackSrc = A.TEMPLATE_SRC;
        if (/^assets\/template-v\d+\.png$/.test(src) && fallbackSrc && fallbackSrc !== src) {
          const fb = A.image(fallbackSrc);
          const adopt = function () {
            if (fb && fb.ready) {
              entry.img = fb.img;
              entry.ready = true;
              entry.failed = false;
              A.emit('image', src);
            } else if (fb && fb.failed) {
              entry.failed = true;
              A.emit('image', src);
            } else {
              setTimeout(adopt, 200);
            }
          };
          adopt();
          return;
        }
        // 网络慢/抖动：自动重试几次
        if (!/^data:/.test(src) && (entry.attempts || 0) < 3) {
          entry.attempts = (entry.attempts || 0) + 1;
          entry.failed = true;
          A.emit('image', src);
          setTimeout(function () {
            entry.failed = false;
            img.src = src + (src.indexOf('?') >= 0 ? '&' : '?') + 'r=' + entry.attempts;
          }, 800 * entry.attempts);
          return;
        }
        entry.failed = true;
        A.emit('image', src);
        A.toast && A.toast('有图片加载失败（可能是网络较慢），稍后刷新页面再试', 'err');
      };
      img.src = src;
    }
    return entry;
  };

  A.readyImage = function (layer) {
    const entry = A.image(A.srcOf(layer));
    return entry && entry.ready ? entry.img : null;
  };

  A.addAsset = function (dataUrl) {
    const id = A.uid('asset');
    state.assets[id] = dataUrl;
    return id;
  };

  /* ---------------------------- 服务端交互 --------------------------- */
  /* --------- 本地模式：没有服务端时（例如 GitHub Pages）存在本机浏览器里 --------- */
  const DRAFT_KEY = 'xuhui-draft-v2';
  let localRev = 0;
  let channel = null;
  try { channel = new BroadcastChannel('xuhui-editor'); } catch (e) { channel = null; }

  const idb = {
    db: null,
    open: function () {
      if (idb.db) return Promise.resolve(idb.db);
      return new Promise(function (resolve, reject) {
        if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
        const req = window.indexedDB.open('xuhui-editor', 1);
        req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
        req.onsuccess = function () { idb.db = req.result; resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    },
    get: function () {
      return idb.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          const req = db.transaction('kv', 'readonly').objectStore('kv').get('draft');
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      });
    },
    put: function (value) {
      return idb.open().then(function (db) {
        return new Promise(function (resolve, reject) {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(value, 'draft');
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      });
    }
  };

  function readLocalDraft() {
    return idb.get().catch(function () { return null; }).then(function (draft) {
      if (draft) return draft;
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    });
  }

  function writeLocalDraft(payload) {
    idb.put(payload).catch(function () {
      try { localStorage.setItem(DRAFT_KEY, JSON.stringify(payload)); } catch (e) { /* 图片太大就放弃 */ }
    });
  }

  function saveLocal() {
    localRev += 1;
    state.rev = localRev;
    state.dirty = false;
    state.saving = false;
    state.lastSaved = new Date();
    writeLocalDraft({
      rev: localRev,
      updatedAt: state.lastSaved.toISOString(),
      assets: state.assets,
      project: state.project
    });
    setStatus('已保存到本机浏览器 ' + timeText(state.lastSaved), 'ok');
    if (channel) { try { channel.postMessage({ rev: localRev }); } catch (e) { /* ignore */ } }
  }

  function startLocalSync() {
    const pull = function () {
      readLocalDraft().then(function (draft) {
        if (!draft || !draft.project || draft.rev === state.rev) return;
        if (state.dirty || state.saving) { A.emit('remote-change', { rev: draft.rev }); return; }
        state.project = migrate(draft.project);
        state.assets = draft.assets || {};
        state.rev = draft.rev;
        localRev = draft.rev;
        state.dirty = false;
        A.layoutCacheReset();
        A.emit('change');
        A.emit('selection', state.selection);
        setStatus('已同步其它窗口的修改 ' + timeText(new Date()), 'ok');
      });
    };
    if (channel) channel.onmessage = pull;
    window.addEventListener('storage', function (e) { if (e.key === DRAFT_KEY) pull(); });
  }

  function finishLocalInit() {
    return readLocalDraft().then(function (draft) {
      if (draft && draft.project) {
        state.project = migrate(draft.project);
        state.assets = draft.assets || {};
        localRev = draft.rev || 0;
        state.rev = localRev;
      } else {
        state.project = A.defaultProject();
        state.assets = {};
      }
      state.dirty = false;
      setStatus('已保存到本机浏览器', 'ok');
      A.emit('change');
      A.emit('selection', state.selection);
      startLocalSync();
    });
  }

  function setStatus(text, cls) {
    A.emit('status', { text: text, cls: cls || '' });
  }
  A.setStatus = setStatus;

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveTimer = null; save(); }, 700);
  }
  A.scheduleSave = scheduleSave;

  let saving = false;
  let again = false;

  function save() {
    if (!state.project) return;
    if (state.remote === false) { saveLocal(); return; }
    if (saving) { again = true; return; }
    saving = true;
    state.saving = true;
    setStatus('保存中…', 'busy');
    fetch('api/state', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseRev: state.rev, assets: state.assets, project: state.project })
    }).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; });
    }).then(function (out) {
      saving = false;
      state.saving = false;
      if (out.status === 200) {
        state.rev = out.data.rev;
        state.dirty = false;
        state.offline = false;
        state.lastSaved = new Date();
        setStatus('已保存 ' + timeText(state.lastSaved), 'ok');
        if (again) { again = false; scheduleSave(); }
        return;
      }
      if (out.status === 409) {
        // 其他窗口也改过：本窗口有未保存内容则覆盖保存，否则载入远端
        state.rev = out.data.rev;
        if (state.dirty) {
          setStatus('另一窗口有改动，正在覆盖保存…', 'busy');
          A.toast && A.toast('检测到其他窗口的修改，当前窗口内容已保存并覆盖。', 'err');
          scheduleSave();
        } else {
          setStatus('检测到其他窗口的修改，正在同步…', 'busy');
          loadFromServer(true);
        }
        return;
      }
      throw new Error(out.data && out.data.error ? out.data.error : '保存失败');
    }).catch(function (err) {
      saving = false;
      state.saving = false;
      console.error('[save]', err);
      if (state.remote === null) {
        // 连不上服务端（例如放在 GitHub Pages 上）：改用本机浏览器保存
        state.remote = false;
        A.toast && A.toast('没有检测到本地服务，已改为保存在这台电脑的浏览器里');
        saveLocal();
        return;
      }
      state.offline = true;
      setStatus('保存失败，稍后重试', 'err');
      setTimeout(scheduleSave, 4000);
    });
  }
  A.saveNow = function () { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } save(); };

  function timeText(d) {
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') +
      ':' + String(d.getSeconds()).padStart(2, '0');
  }

  A.loadFromServer = function (silent) {
    return fetch('api/state', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (data) {
      applyServerState(data, silent);
      return data;
    });
  };

  function applyServerState(data, silent) {
    const project = data.project;
    const changed = data.rev !== state.rev;
    state.rev = data.rev;
    state.assets = data.assets || {};
    state.dirty = false;
    if (project) {
      state.project = migrate(project);
      if (state.selection && !A.findElement(state.selection)) state.selection = null;
    }
    state.past.length = 0;
    state.future.length = 0;
    if (changed && silent) {
      setStatus('已同步其他窗口的修改 ' + timeText(new Date()), 'ok');
      A.toast && A.toast('已同步其他窗口的修改', 'ok');
    } else if (!silent) {
      setStatus('已载入 ' + timeText(new Date()), 'ok');
    }
    A.emit('change');
    A.emit('selection', state.selection);
  }

  A.init = function (opts) {
    state.remote = null;
    if (opts && opts.offline) {
      // 显式要求纯本地模式（例如静态托管）
      state.remote = false;
      return finishLocalInit();
    }
    return A.loadFromServer(false).then(function (data) {
      state.remote = true;
      if (!data.project) {
        state.project = A.defaultProject();
        state.assets = {};
        A.emit('change');
        A.saveNow();
      }
      startSync();
    }).catch(function (err) {
      console.warn('[init] 没有本地服务，改用本机浏览器保存', err && err.message);
      state.remote = false;
      return finishLocalInit();
    });
  };

  /* ---------------------------- 多窗口同步 --------------------------- */
  function startSync() {
    let busy = false;
    let noticeRev = -1;
    const tick = function () {
      if (busy || state.saving) return;
      busy = true;
      fetch('api/rev', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (info) {
          busy = false;
          if (!info || typeof info.rev !== 'number') return;
          if (info.rev === state.rev) return;
          if (state.dirty || state.saving) {
            if (info.rev !== noticeRev) {
              noticeRev = info.rev;
              A.emit('remote-change', info);
            }
            return;
          }
          A.loadFromServer(true);
        })
        .catch(function () {
          busy = false;
          if (!state.offline) {
            state.offline = true;
            setStatus('与本地服务的连接中断', 'err');
          }
        });
    };
    setInterval(tick, 1500);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) tick();
    });
  }

  /* ---------------------------- 项目导入导出 -------------------------- */
  A.exportProjectFile = function () {
    const payload = {
      format: 'xuhui-editor-project',
      version: 1,
      exportedAt: new Date().toISOString(),
      project: state.project,
      assets: state.assets
    };
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = (state.project.name || '徐汇你早') + '-' +
      d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  };

  A.importProjectFile = function (file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const data = JSON.parse(String(reader.result));
          const project = data.project || (data.texts || data.template ? data : null);
          if (!project) throw new Error('文件里没有找到项目数据');
          snapshot();
          state.project = migrate(project);
          if (data.assets) {
            Object.keys(data.assets).forEach(function (k) { state.assets[k] = data.assets[k]; });
          }
          state.selection = null;
          A.emit('change');
          A.emit('selection', null);
          A.touch();
          resolve(project);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function () { reject(new Error('读取文件失败')); };
      reader.readAsText(file, 'utf-8');
    });
  };

  A.resetAll = function () {
    snapshot();
    state.project = A.defaultProject();
    state.assets = {};
    state.selection = null;
    A.emit('change');
    A.emit('selection', null);
    A.touch();
  };

})(window.App);