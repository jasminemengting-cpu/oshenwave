/**
 * oshenwave 後端（Cloudflare Worker）
 *
 * 負責：
 *   GET /login               → 導向 Threads 授權頁
 *   GET /callback            → 用授權碼換取 Access Token，帶回抽獎網頁
 *   GET /api/comments?url=   → 用 Token 讀取該貼文的全部留言
 *
 * 需要設定的環境變數（Cloudflare 後台 → Worker → Settings → Variables and Secrets）：
 *   THREADS_APP_ID      Threads 應用程式編號
 *   THREADS_APP_SECRET  Threads 應用程式密鑰（請選 Secret 類型）
 *   FRONTEND_URL        抽獎網頁網址，例如 https://jasminemengting-cpu.github.io/oshenwave/
 */

const GRAPH = 'https://graph.threads.net';
const SCOPES = 'threads_basic,threads_read_replies';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    try {
      if (url.pathname === '/login') return login(url, env);
      if (url.pathname === '/callback') return await callback(request, url, env);
      if (url.pathname === '/api/comments') return await comments(request, url, env, cors);
      if (url.pathname === '/') return new Response('oshenwave backend OK', { headers: cors });
      return json({ error: '找不到這個路徑' }, 404, cors);
    } catch (e) {
      return json({ error: e.message || String(e) }, 500, cors);
    }
  },
};

function corsHeaders(env) {
  const origin = env.FRONTEND_URL ? new URL(env.FRONTEND_URL).origin : '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function redirectUri(url) {
  return url.origin + '/callback';
}

function backToFrontend(env, params) {
  const target = new URL(env.FRONTEND_URL);
  target.hash = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 302,
    headers: { Location: target.toString(), 'Set-Cookie': 'ow_state=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' },
  });
}

// ---------- 登入 ----------
function login(url, env) {
  const state = crypto.randomUUID();
  const auth = new URL('https://threads.net/oauth/authorize');
  auth.searchParams.set('client_id', env.THREADS_APP_ID);
  auth.searchParams.set('redirect_uri', redirectUri(url));
  auth.searchParams.set('scope', SCOPES);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': `ow_state=${state}; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Lax`,
    },
  });
}

async function callback(request, url, env) {
  const err = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (err) return backToFrontend(env, { error: '授權失敗：' + err });

  const cookie = request.headers.get('Cookie') || '';
  const saved = (cookie.match(/(?:^|;\s*)ow_state=([^;]+)/) || [])[1];
  if (!saved || saved !== url.searchParams.get('state')) {
    return backToFrontend(env, { error: '登入逾時或驗證失敗，請重新登入' });
  }

  const code = (url.searchParams.get('code') || '').replace(/#_$/, '');
  const form = new URLSearchParams({
    client_id: env.THREADS_APP_ID,
    client_secret: env.THREADS_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(url),
    code,
  });
  const short = await graphFetch(`${GRAPH}/oauth/access_token`, { method: 'POST', body: form });

  // 換成 60 天有效的長期 Token
  const ll = new URL(`${GRAPH}/access_token`);
  ll.searchParams.set('grant_type', 'th_exchange_token');
  ll.searchParams.set('client_secret', env.THREADS_APP_SECRET);
  ll.searchParams.set('access_token', short.access_token);
  let token = short.access_token, expires = 3600;
  try {
    const long = await graphFetch(ll.toString());
    token = long.access_token; expires = long.expires_in || expires;
  } catch (e) { /* 換長期 Token 失敗就先用短期的 */ }

  const me = await graphFetch(`${GRAPH}/v1.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
  return backToFrontend(env, { token, expires_in: String(expires), username: me.username || '' });
}

// ---------- 抓留言 ----------
async function comments(request, url, env, cors) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: '請先登入 Threads' }, 401, cors);

  const postUrl = url.searchParams.get('url') || '';
  const m = postUrl.match(/\/post\/([A-Za-z0-9_-]+)/);
  if (!m) return json({ error: '網址格式不對，應該像 https://www.threads.com/@帳號/post/XXXXXX' }, 400, cors);
  const shortcode = m[1];

  let me;
  try {
    me = await graphFetch(`${GRAPH}/v1.0/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
  } catch (e) {
    return json({ error: '登入已過期，請重新登入', detail: e.message }, 401, cors);
  }

  // 在登入者自己的貼文中找出這則貼文的 ID
  let mediaId = null;
  let next = `${GRAPH}/v1.0/me/threads?fields=id,shortcode&limit=100&access_token=${encodeURIComponent(token)}`;
  for (let page = 0; next && page < 50 && !mediaId; page++) {
    const res = await graphFetch(next);
    const hit = (res.data || []).find(p => p.shortcode === shortcode);
    if (hit) mediaId = hit.id;
    next = res.paging && res.paging.next;
  }
  if (!mediaId) {
    return json({ error: `在 @${me.username} 的貼文中找不到這則貼文。Threads 官方只允許讀取「登入帳號自己發的貼文」的留言，請確認登入的帳號是發文者。` }, 404, cors);
  }

  // 讀取全部留言（含樓中樓）
  const fields = 'id,text,username,timestamp,permalink,is_reply,replied_to,hide_status';
  const out = [];
  next = `${GRAPH}/v1.0/${mediaId}/conversation?fields=${fields}&reverse=false&limit=100&access_token=${encodeURIComponent(token)}`;
  for (let page = 0; next && page < 300; page++) {
    const res = await graphFetch(next);
    for (const c of res.data || []) {
      out.push({
        u: c.username || '',
        t: c.text || '',
        time: c.timestamp ? Math.floor(new Date(c.timestamp).getTime() / 1000) : 0,
        top: !c.replied_to || c.replied_to.id === mediaId,
        hidden: !!c.hide_status && !['NOT_HUSHED', 'UNHUSHED', 'NONE'].includes(c.hide_status),
        link: c.permalink || '',
      });
    }
    next = res.paging && res.paging.next;
  }

  return json({ source: 'oshenwave-api', url: postUrl, author: me.username, media_id: mediaId, collected_at: Math.floor(Date.now() / 1000), comments: out }, 200, cors);
}

async function graphFetch(u, init) {
  const r = await fetch(u, init);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`Threads 回應格式錯誤 (${r.status})`); }
  if (!r.ok || data.error) {
    const msg = (data.error && (data.error.message || data.error.error_user_msg)) || `HTTP ${r.status}`;
    throw new Error('Threads API 錯誤：' + msg);
  }
  return data;
}
