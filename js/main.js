/* 启动 */
(function (A) {
  'use strict';

  function boot() {
    try {
      A.editor.init();
      A.ui.init();
    } catch (err) {
      console.error('[boot]', err);
    }

    const offline = /[?&]offline=1/.test(location.search);
    A.init({ offline: offline }).then(function () {
      A.editor.applyZoom();
      ensureFont();
      if (A.state.project && !A.state.project.photos.length) {
        A.toast('提示：先点「添加图片」把照片放进中间的照片区', 'ok');
      }
    }).catch(function (err) {
      console.error('[init]', err);
    });

    // 关闭页面前把未保存的改动写回服务端
    window.addEventListener('beforeunload', function () {
      if (!A.state.dirty) return;
      if (A.state.remote === false) { A.saveNow(); return; }
      try {
        const payload = JSON.stringify({ baseRev: A.state.rev, assets: A.state.assets, project: A.state.project });
        navigator.sendBeacon('api/state', new Blob([payload], { type: 'application/json' }));
      } catch (e) { /* ignore */ }
    });
  }

  /* 内置字体（思源宋体 Bold）较大，加载完成后重绘一次，避免首帧用后备字体 */
  function ensureFont() {
    if (!document.fonts || !document.fonts.load) return;
    const sizes = [180, 148, 50, 44, 36];
    const jobs = sizes.map(function (s) {
      return document.fonts.load('700 ' + s + 'px "XHSerif"').catch(function () { return null; });
    });
    Promise.all(jobs).then(function () {
      A.layoutCacheReset();
      A.editor.render();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

})(window.App);
