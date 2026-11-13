(() => {
  if (window.__oshenwave) { window.__oshenwave.box.style.display = 'block'; return; }
  const LOTTERY_URL = 'https://jasminemengting-cpu.github.io/oshenwave/';
  const found = new Map();
  const codes = new Set();
  let author = '';
  const mm = location.pathname.match(/\/post\/([\w-]+)/);
  const mainCode = mm ? mm[1] : '';
  if (!mainCode) { alert('請先打開一則 Threads 貼文頁面，再點這個書籤。'); return; }

  function add(x) {
    const id = String(x.pk);
    const code = x.code || '';
    const u = x.user.username;
    if (code && code === mainCode) { author = u; return; }
    if (found.has(id) || (code && codes.has(code))) return;
    const info = x.text_post_app_info || {};
    const cap = x.caption && typeof x.caption === 'object' ? (x.caption.text || '') : '';
    found.set(id, { u: u, t: cap.trim(), time: x.taken_at || 0, r: (info.reply_to_author || {}).username || '', c: code });
    if (code) codes.add(code);
  }
  function walk(o) {
    const st = [o];
    while (st.length) {
      const x = st.pop();
      if (Array.isArray(x)) { for (const v of x) st.push(v); }
      else if (x && typeof x === 'object') {
        const u = x.user;
        if ('pk' in x && u && typeof u === 'object' && u.username && 'caption' in x) { try { add(x); } catch (e) {} }
        for (const k in x) st.push(x[k]);
      }
    }
  }
  function parse(txt) {
    if (!txt) return;
    txt = txt.replace(/^for \(;;\);/, '');
    try { walk(JSON.parse(txt)); return; } catch (e) {}
    txt.split('\n').forEach(l => { l = l.trim(); if (l[0] === '{' || l[0] === '[') { try { walk(JSON.parse(l)); } catch (e) {} } });
  }
  function scanScripts() { document.querySelectorAll('script[type="application/json"]').forEach(s => parse(s.textContent)); }
  function scanDom() {
    document.querySelectorAll('time[datetime]').forEach(tm => {
      let el = tm;
      while (el.parentElement && el.parentElement !== document.body && el.parentElement.querySelectorAll('time').length === 1) el = el.parentElement;
      const a = el.querySelector('a[href^="/@"]');
      const pl = el.querySelector('a[href*="/post/"]');
      if (!a || !pl) return;
      const u = a.getAttribute('href').split('/')[1].slice(1);
      const cm = pl.getAttribute('href').match(/\/post\/([\w-]+)/);
      const code = cm ? cm[1] : '';
      if (!code) return;
      if (code === mainCode) { if (!author) author = u; return; }
      if (codes.has(code)) return;
      const skip = new Set([u, tm.innerText.trim(), '作者', 'Author', '翻譯', 'Translate']);
      const t = el.innerText.split('\n').map(s => s.trim()).filter(s => s && !skip.has(s) && !/^[\d.,萬KkMm]+$/.test(s)).join(' ');
      found.set('dom:' + code, { u: u, t: t, time: Math.floor(new Date(tm.dateTime).getTime() / 1000) || 0, r: '', c: code });
      codes.add(code);
    });
  }

  const of = window.fetch;
  window.fetch = function () {
    return of.apply(this, arguments).then(r => {
      try { if (/graphql|\/api\//.test(String(r.url))) r.clone().text().then(parse).catch(() => {}); } catch (e) {}
      return r;
    });
  };
  const oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url) {
    this.addEventListener('load', function () {
      try { if (/graphql|\/api\//.test(String(url)) && (this.responseType === '' || this.responseType === 'text')) parse(this.responseText); } catch (e) {}
    });
    return oo.apply(this, arguments);
  };

  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;width:320px;background:#0b1d2e;color:#e8f6f7;font:14px/1.5 -apple-system,"Noto Sans TC",sans-serif;border-radius:14px;padding:16px;box-shadow:0 10px 40px rgba(0,0,0,.4);border:1px solid #1f4a63';
  box.innerHTML = '<div style="font-weight:700;font-size:16px;margin-bottom:6px">🌊 oshenwave 留言收集</div><div id="ow-status">準備中…</div><div id="ow-actions" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"></div>';
  document.body.appendChild(box);
  window.__oshenwave = { box: box };
  const status = box.querySelector('#ow-status');
  const actions = box.querySelector('#ow-actions');
  function btn(label, fn, primary) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'cursor:pointer;border:0;border-radius:8px;padding:7px 12px;font:inherit;font-weight:600;' + (primary ? 'background:#5ce1e6;color:#0b1d2e' : 'background:#1f4a63;color:#e8f6f7');
    b.onclick = fn;
    actions.appendChild(b);
    return b;
  }
  let stopped = false;
  btn('停止並完成', () => { stopped = true; });

  function result() {
    const entries = [...found.entries()];
    const hasReplyInfo = entries.some(([, p]) => p.r);
    const filtered = entries.filter(([id, p]) => !hasReplyInfo || p.r || id.startsWith('dom:')).map(([, p]) => p);
    filtered.sort((a, b) => a.time - b.time);
    return { source: 'oshenwave', url: location.href, author: author, collected_at: Math.floor(Date.now() / 1000), comments: filtered };
  }
  function finish() {
    const data = result();
    const json = JSON.stringify(data);
    status.innerHTML = '✅ 完成！共收集 <b>' + data.comments.length + '</b> 則留言' + (author ? '（作者 @' + author + '）' : '') + '<br>按「複製」後到抽獎網頁貼上。';
    actions.innerHTML = '';
    btn('複製', () => {
      const done = () => { status.innerHTML += '<br>📋 已複製！'; };
      if (navigator.clipboard) navigator.clipboard.writeText(json).then(done, fallback); else fallback();
      function fallback() { const ta = document.createElement('textarea'); ta.value = json; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
    }, true);
    btn('下載檔案', () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = 'threads-comments-' + mainCode + '.json';
      a.click();
    });
    btn('開啟抽獎網頁', () => window.open(LOTTERY_URL, '_blank'));
    btn('關閉', () => { box.style.display = 'none'; });
  }

  (async () => {
    scanScripts(); scanDom();
    let last = -1, idle = 0;
    for (let i = 0; i < 400 && !stopped; i++) {
      window.scrollBy(0, 3000);
      const ts = document.querySelectorAll('time');
      if (ts.length) ts[ts.length - 1].scrollIntoView({ block: 'end' });
      await new Promise(r => setTimeout(r, 1500));
      if (i % 4 === 0) scanScripts();
      scanDom();
      const n = found.size;
      status.innerHTML = '自動捲動中…（第 ' + (i + 1) + ' 次）<br>已收集 <b>' + n + '</b> 則留言';
      if (n === last) { if (++idle >= 6) break; } else { idle = 0; last = n; }
    }
    scanScripts(); scanDom();
    finish();
  })();
})();
