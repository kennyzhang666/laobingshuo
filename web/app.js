'use strict';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const YEAR = new Date().getFullYear();
const MODE_E = {coffee:'☕', lunch:'🍜', walk:'🚶', online:'💻'};
const MODE_D = {coffee:'半小时左右', lunch:'一小时左右', walk:'半小时左右', online:'视频会议'};
const STATUS = {pending:'待安排', arranged:'已安排', done:'已完成', cancelled:'已取消'};
const POS = ['开发工程师','测试工程师','骨干','PL','TM','SE','版本经理','技术专家','资深专家','首席专家','副部长','部长'];

let ME = null, V = [], CATS = [], TAGS = [], MODES = {}, WHEN = [], PART = [];

/* ---------- api ---------- */
function goLogin(hash){ location.href = '/login?returnTo=' + encodeURIComponent(location.pathname + (hash || '')); }
async function api(method, url, body){
  const r = await fetch(url, {method, credentials:'same-origin',
    headers: body ? {'Content-Type':'application/json'} : {}, body: body ? JSON.stringify(body) : undefined});
  let data = null; try { data = await r.json(); } catch(e) {}
  if (r.status === 401) { goLogin(location.hash); throw new Error('请先登录'); }
  if (!r.ok) throw new Error((data && data.message) || ('请求失败 ' + r.status));
  return data;
}
async function load(anim){
  const s = await api('GET', '/api/state');
  ME = s.me; V = s.veterans; CATS = s.categories; TAGS = s.tags; MODES = s.modes; WHEN = s.when; PART = s.part;
  renderUser(); refreshAll(anim);
}

/* ---------- helpers ---------- */
const years = v => Math.max(0, YEAR - v.since);
const hueOf = v => (Number(v.hue) || 0) % 360;
const short = v => String(v.title || '').split(' · ')[0] || v.category || '';
const cut = (s, n) => s.length > n ? s.slice(0, n) + '…' : s;
let tt; function toast(s){ const t = $('#toast'); t.textContent = s; t.classList.add('show'); clearTimeout(tt); tt = setTimeout(() => t.classList.remove('show'), 2400); }
function copyText(s){
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(s);
  const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return Promise.resolve();
}

/* ---------- photo ---------- */
let gid = 0;
const SCAN = [...Array(20)].map((_, i) => `<line x1="0" x2="300" y1="${i*20}" y2="${i*20}"/>`).join('');
function portrait(v){
  const h = hueOf(v), a = 'pg' + (++gid), b = 'ps' + gid;
  return `<svg viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs>
    <linearGradient id="${a}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,26%)"/><stop offset="1" stop-color="hsl(${h+40},60%,7%)"/></linearGradient>
    <linearGradient id="${b}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${h},85%,72%)" stop-opacity=".6"/><stop offset="1" stop-color="hsl(${h},85%,50%)" stop-opacity=".05"/></linearGradient></defs>
    <rect width="300" height="400" fill="url(#${a})"/>
    <g stroke="hsl(${h},90%,70%)" stroke-opacity=".07">${SCAN}</g>
    <text x="150" y="230" text-anchor="middle" font-size="230" font-weight="900" fill="hsl(${h},90%,75%)" fill-opacity=".08">${esc(String(v.name || '?')[0])}</text>
    <circle cx="150" cy="165" r="56" fill="url(#${b})"/>
    <path d="M38 400C38 300 88 250 150 250S262 300 262 400Z" fill="url(#${b})"/>
  </svg>`;
}
const photo = v => `<div class="photo">${portrait(v)}${v.photo ? `<img src="/photos/${esc(v.photo)}" alt="${esc(v.name)}" loading="lazy" onerror="this.remove()">` : ''}</div>`;

/* ---------- growth tree ---------- */
function tree(v){
  const cs = [...(v.career || [])].sort((a, b) => a.y - b.y);
  if (!cs.length) return '<p style="color:var(--muted);font-size:13px">暂无</p>';
  const h = hueOf(v), n = cs.length, gap = 82, W = 580, cx = 290, Yt = 56, Yb = Yt + n*gap + 46, id = ++gid;
  const xAt = t => cx - 66*(1-t)*(1-t)*t + 66*(1-t)*t*t;
  let s = `<svg class="tree" viewBox="0 0 ${W} ${Yb+22}"><defs>
    <linearGradient id="tg${id}" x1="0" y1="1" x2="0" y2="0"><stop offset="0" stop-color="hsl(30,35%,30%)"/><stop offset="1" stop-color="hsl(${h},70%,55%)"/></linearGradient>
    <filter id="bl${id}" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="18"/></filter></defs>
    <g filter="url(#bl${id})" opacity=".55"><circle cx="${cx}" cy="${Yt+10}" r="70" fill="hsl(${h},80%,45%)"/><circle cx="${cx-70}" cy="${Yt+46}" r="40" fill="hsl(${h+30},80%,45%)"/><circle cx="${cx+70}" cy="${Yt+36}" r="44" fill="hsl(${h-30},80%,45%)"/></g>
    <ellipse cx="${cx}" cy="${Yb+4}" rx="140" ry="10" fill="hsl(${h},80%,50%)" opacity=".14"/>
    <path class="root" d="M${cx} ${Yb} q-20 8 -46 12 M${cx} ${Yb} q22 7 50 10 M${cx} ${Yb} q-4 10 -12 16"/>
    <path class="trunk" pathLength="1" stroke="url(#tg${id})" d="M${cx} ${Yb} C${cx-22} ${Yb-(Yb-Yt)/3} ${cx+22} ${Yb-2*(Yb-Yt)/3} ${cx} ${Yt}"/>`;
  cs.forEach((c, i) => {
    const y = Yb - 52 - i*gap, ay = y + 26, t = (Yb - ay)/(Yb - Yt), xt = xAt(t), sd = i % 2 ? 1 : -1, ex = cx + sd*96, now = i === n - 1;
    const lx = cx + sd*114, anc = sd < 0 ? 'end' : 'start', l1 = (xt + sd*42).toFixed(1), l2 = (xt + sd*66).toFixed(1);
    s += `<g class="br${now ? ' now' : ''}" style="--d:${.5 + i*.28}s">
      <path class="bp" d="M${xt.toFixed(1)} ${ay} Q${(xt + sd*46).toFixed(1)} ${ay-2} ${ex} ${y}"/>
      <ellipse class="leaf" cx="${l1}" cy="${ay-8}" rx="10" ry="4" transform="rotate(${sd*-35} ${l1} ${ay-8})"/>
      <ellipse class="leaf" cx="${l2}" cy="${ay+2}" rx="8" ry="3.5" transform="rotate(${sd*25} ${l2} ${ay+2})"/>
      ${now ? `<circle class="pulse" cx="${ex}" cy="${y}" r="9"/>` : ''}
      <circle class="nd" cx="${ex}" cy="${y}" r="${now ? 9 : 7}"/>
      <text class="tp" x="${lx}" y="${y+1}" text-anchor="${anc}">${esc(c.pos)}</text>
      <text class="tn" x="${lx}" y="${y+21}" text-anchor="${anc}"><tspan class="ty">${c.y}</tspan>${c.note ? ' · ' + esc(cut(c.note, 14)) : ''}<title>${c.y} ${esc(c.pos)} ${esc(c.note)}</title></text>
    </g>`;
  });
  return s + '</svg>';
}

/* ---------- network background ---------- */
(function(){
  const cv = $('#net'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1; let W, H, nodes = [], packets = [], mouse = {x:-999, y:-999};
  const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  function size(){ W = cv.width = innerWidth*dpr; H = cv.height = innerHeight*dpr; cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
    const n = Math.min(90, Math.floor(innerWidth*innerHeight/16000));
    nodes = [...Array(n)].map(() => ({x:Math.random()*W, y:Math.random()*H, vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3, r:Math.random()*1.6+.8})); }
  addEventListener('resize', size); addEventListener('mousemove', e => { mouse.x = e.clientX*dpr; mouse.y = e.clientY*dpr; });
  size();
  const D = 150*dpr;
  function frame(){
    ctx.clearRect(0, 0, W, H);
    for (const n of nodes){ n.x += n.vx; n.y += n.vy; if (n.x < 0 || n.x > W) n.vx *= -1; if (n.y < 0 || n.y > H) n.vy *= -1;
      const dx = mouse.x - n.x, dy = mouse.y - n.y; if (Math.hypot(dx, dy) < 200*dpr){ n.x += dx*.003; n.y += dy*.003; } }
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++){
      const a = nodes[i], b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < D){ ctx.strokeStyle = `rgba(34,211,238,${(1-d/D)*.22})`; ctx.lineWidth = dpr*.6; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        if (!reduce && Math.random() < .0009) packets.push({a, b, t:0, c: Math.random() < .5 ? '251,191,36' : '244,114,182'}); } }
    for (const n of nodes){ ctx.fillStyle = 'rgba(180,230,255,.7)'; ctx.beginPath(); ctx.arc(n.x, n.y, n.r*dpr, 0, 7); ctx.fill(); }
    packets = packets.filter(p => p.t <= 1);
    for (const p of packets){ p.t += .012; const x = p.a.x + (p.b.x - p.a.x)*p.t, y = p.a.y + (p.b.y - p.a.y)*p.t;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 8*dpr); g.addColorStop(0, `rgba(${p.c},1)`); g.addColorStop(1, `rgba(${p.c},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 8*dpr, 0, 7); ctx.fill(); }
    if (!reduce) requestAnimationFrame(frame);
  }
  frame();
})();

/* ---------- 3D sphere ----------
   照片按斐波那契球面均匀分布；照片始终正对屏幕，随球体转动，背面的变暗变小。 */
const Ring = (function(){
  const stage = $('#stage'), ring = $('#ring'), reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
  const baseY = reduce ? 0 : .15, restX = -12, D2R = Math.PI/180;
  let pcs = [], pts = [], core = null, R = 0, ay = 0, ax = restX, vy = baseY, vx = 0, drag = false, lx = 0, ly = 0, moved = 0;
  function build(){
    const n = V.length, golden = Math.PI*(3 - Math.sqrt(5));
    pts = V.map((_, i) => { const y = n === 1 ? 0 : 1 - 2*(i + .5)/n, r = Math.sqrt(1 - y*y), t = i*golden; return [Math.cos(t)*r, y, Math.sin(t)*r]; });
    const mer = [0, 30, 60, 90, 120, 150].map(d => `<div class="gl" data-m="${d}"></div>`).join('');
    const par = [-60, -30, 0, 30, 60].map(d => `<div class="gl${d === 0 ? ' eq' : ''}" data-p="${d}"></div>`).join('');
    ring.innerHTML = mer + par + V.map(v => `<div class="pc" data-id="${v.id}" style="--h:${hueOf(v)}">${photo(v)}<div class="pc-n"><b>${esc(v.name)}</b><small>${esc(short(v))}</small></div></div>`).join('')
      + `<div class="core"><div><b>老兵说</b><small>${n} 位老兵</small></div></div>`;
    pcs = [...ring.querySelectorAll('.pc')]; core = ring.querySelector('.core');
  }
  function layout(){
    const cap = innerWidth < 860 ? innerWidth*.36 : 270;
    R = Math.max(130, Math.min(cap, 150 + V.length*10));
    ring.querySelectorAll('.gl').forEach(g => {
      if (g.dataset.m !== undefined){ Object.assign(g.style, {width: 2*R + 'px', height: 2*R + 'px', left: -R + 'px', top: -R + 'px', transform: `rotateY(${g.dataset.m}deg)`}); }
      else { const lat = +g.dataset.p*D2R, r = R*Math.cos(lat);
        Object.assign(g.style, {width: 2*r + 'px', height: 2*r + 'px', left: -r + 'px', top: -r + 'px', transform: `translateY(${R*Math.sin(lat)}px) rotateX(90deg)`}); }
    });
  }
  addEventListener('resize', layout);
  stage.addEventListener('pointerdown', e => { drag = true; lx = e.clientX; ly = e.clientY; moved = 0; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - lx, dy = e.clientY - ly; lx = e.clientX; ly = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy); vy = dx*.3; vx = -dy*.3; ay += vy; ax = Math.max(-80, Math.min(80, ax + vx)); });
  stage.addEventListener('pointerup', e => { if (!drag) return; drag = false;
    if (moved < 6){ const p = document.elementFromPoint(e.clientX, e.clientY)?.closest('.pc'); if (p) openProfile(+p.dataset.id); } });
  stage.addEventListener('pointercancel', () => drag = false);
  (function f(){
    if (!drag){ vy += (baseY - vy)*.03; vx *= .92; ay += vy; ax = Math.max(-80, Math.min(80, ax + vx)); ax += (restX - ax)*.004; }
    ring.style.transform = `rotateX(${ax}deg) rotateY(${ay}deg)`;
    const face = `rotateY(${-ay}deg) rotateX(${-ax}deg)`, sy = Math.sin(ay*D2R), cy = Math.cos(ay*D2R), sx = Math.sin(ax*D2R), cx = Math.cos(ax*D2R);
    if (core) core.style.transform = face;
    pcs.forEach((p, i) => {
      const [x, y, z] = pts[i], z1 = -x*sy + z*cy, depth = y*sx + z1*cx;   // depth: 1 = 正对屏幕，-1 = 背面
      p.style.transform = `translate3d(${x*R}px,${y*R}px,${z*R}px) ${face}`;
      p.style.filter = `brightness(${.3 + .7*(depth + 1)/2})`;
      p.style.opacity = .45 + .55*(depth + 1)/2;
    });
    requestAnimationFrame(f);
  })();
  return {build(){ build(); layout(); }};
})();

/* ---------- stats ---------- */
function countUp(el, to){ let s = null; const f = t => { s ??= t; const p = Math.min(1, (t - s)/1400); el.textContent = Math.round(to*(1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(f); }; requestAnimationFrame(f); }
function renderStats(anim){
  const vals = [V.length, V.reduce((a, v) => a + years(v), 0), V.reduce((a, v) => a + v.metTotal, 0)];
  ['#s1','#s2','#s3'].forEach((s, i) => anim ? countUp($(s), vals[i]) : ($(s).textContent = vals[i]));
}

/* ---------- user area ---------- */
async function refreshMineCount(){
  if (!ME) return;
  try { const list = await api('GET', '/api/my/applications'); const n = list.filter(a => a.status === 'pending' || a.status === 'arranged').length;
    const c = $('#mineCnt'); if (c){ c.textContent = n; c.hidden = !n; } } catch(e) {}
}
function renderUser(){
  const el = $('#userArea');
  if (!ME){ el.innerHTML = '<button id="loginBtn">登录</button>'; $('#loginBtn').onclick = () => goLogin(location.hash); return; }
  el.innerHTML = `<button id="openMine">我的申请<span class="cnt" id="mineCnt" hidden></span></button>
    ${ME.isAssistant ? '<button class="admin-btn" id="openAdmin">助理入口</button>' : ''}
    <span class="who" title="${esc(ME.employeeNo)} ${esc(ME.department)}">${esc(ME.name)}</span><button id="logoutBtn">退出</button>`;
  $('#openMine').onclick = openDrawer;
  $('#logoutBtn').onclick = () => { location.href = '/logout'; };
  if (ME.isAssistant) $('#openAdmin').onclick = () => openAdmin();
  refreshMineCount();
}

/* ---------- filters + cards ---------- */
let cat = '全部', tag = '', kw = '';
function renderFilters(){
  if (cat !== '全部' && !CATS.includes(cat)) cat = '全部';
  $('#cats').innerHTML = ['全部', ...CATS].map(r => `<button class="chip${r === cat ? ' on' : ''}" data-c="${esc(r)}">${esc(r)}</button>`).join('');
  const used = new Set(V.flatMap(v => v.tags));
  const tags = TAGS.filter(t => used.has(t));
  if (tag && !tags.includes(tag)) tag = '';
  $('#tagbar').innerHTML = tags.map(t => `<button class="chip sm${t === tag ? ' on' : ''}" data-t="${esc(t)}">${esc(t)}</button>`).join('');
}
$('#cats').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; cat = b.dataset.c; renderFilters(); render(); };
$('#tagbar').onclick = e => { const b = e.target.closest('[data-t]'); if (!b) return; tag = tag === b.dataset.t ? '' : b.dataset.t; renderFilters(); render(); };
$('#q').oninput = e => { kw = e.target.value.trim().toLowerCase(); render(); };

function card(v){
  const full = v.remaining <= 0;
  return `<article class="card" data-id="${v.id}" style="--h:${hueOf(v)}">
    <div class="spot"></div>
    <div class="ph">${photo(v)}<div class="holo"></div><div class="badge">司龄 <b>${years(v)}</b> 年</div>
      ${v.awards.length ? `<div class="aw">★ ${v.awards.length} 项奖项</div>` : ''}</div>
    <div class="body">
      <h3>${esc(v.name)}${v.category ? `<span class="role">${esc(v.category)}</span>` : ''}</h3>
      <div class="ttl">${esc(v.title)}</div>
      <p class="q">${esc(v.quote)}</p>
      <div class="tags">${v.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>
      <div class="card-foot"><span class="slot${full ? ' full' : ''}"><i></i>${full ? '本月已约满' : `本月还可约 ${v.remaining} 次`}</span>
        <button class="btn-mini" data-book="${v.id}"${full ? ' disabled' : ''}>申请交流</button></div>
    </div>
  </article>`;
}
function render(){
  const list = V.filter(v => (cat === '全部' || v.category === cat) && (!tag || v.tags.includes(tag)) &&
    (!kw || [v.name, v.title, ...v.tags, ...v.topics, ...v.career.map(c => c.pos), ...v.awards.map(a => a.name)].join(' ').toLowerCase().includes(kw)));
  $('#grid').innerHTML = list.length ? list.map(card).join('') : `<div class="empty">${V.length ? '没有找到' : '还没有老兵信息'}</div>`;
}
const grid = $('#grid');
grid.addEventListener('mousemove', e => { const c = e.target.closest('.card'); if (!c) return; const r = c.getBoundingClientRect(), x = (e.clientX - r.left)/r.width, y = (e.clientY - r.top)/r.height;
  c.style.transform = `rotateY(${(x-.5)*14}deg) rotateX(${(.5-y)*14}deg)`; c.style.setProperty('--mx', x*100 + '%'); c.style.setProperty('--my', y*100 + '%'); });
grid.addEventListener('mouseout', e => { const c = e.target.closest('.card'); if (c && !c.contains(e.relatedTarget)) c.style.transform = ''; });
grid.addEventListener('click', e => { const b = e.target.closest('[data-book]'); if (b){ e.stopPropagation(); if (!b.disabled) openApply(+b.dataset.book); return; }
  const c = e.target.closest('.card'); if (c) openProfile(+c.dataset.id); });
$('#randomBtn').onclick = () => V.length && openProfile(V[Math.floor(Math.random()*V.length)].id);

/* ---------- quotes ---------- */
function renderQuotes(){
  let qs = V.filter(v => v.quote).map(v => [v.quote, v.name, short(v)]);
  $('#quotes').hidden = !qs.length;
  while (qs.length && qs.length < 8) qs = qs.concat(qs);
  const html = arr => arr.map(([q, n, t]) => `<div class="qc"><p>${esc(q)}</p><span><b>${esc(n)}</b> · ${esc(t)}</span></div>`).join('');
  const a = qs.filter((_, i) => i % 2 === 0), b = qs.filter((_, i) => i % 2 === 1);
  $('#t1').innerHTML = html(a) + html(a); $('#t2').innerHTML = html(b) + html(b);
}
function refreshAll(anim){ Ring.build(); renderFilters(); render(); renderQuotes(); renderStats(anim); }

/* ---------- modal ---------- */
const modal = $('#modal'), panel = $('#panel');
function show(html, hue, wide){ panel.classList.toggle('wide', !!wide); panel.style.setProperty('--h', hue); panel.innerHTML = '<button class="x" data-close>×</button>' + html; modal.classList.add('open'); panel.scrollTop = 0; }
function hide(){ modal.classList.remove('open'); }
modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('[data-close]')) hide(); });
addEventListener('keydown', e => { if (e.key === 'Escape'){ hide(); closeDrawer(); } });

function openProfile(id){
  const v = V.find(x => x.id === id); if (!v) return;
  show(`<div class="prof">
    <div class="prof-l" id="pl"><div class="holo-card" id="hc">${photo(v)}<div class="holo"></div></div>
      <h3>${esc(v.name)}${v.category ? `<span class="role">${esc(v.category)}</span>` : ''}</h3><div class="ttl">${esc(v.title)}</div>
      <div class="meta"><b>${v.since}</b> 年入职，司龄 <b>${years(v)}</b> 年<br>和 <b>${v.metTotal}</b> 位新员工交流过</div>
      ${v.remaining > 0 ? `<button class="btn btn-p" id="pApply">申请交流</button>` : `<button class="btn btn-g" disabled>本月已约满</button>`}
    </div>
    <div class="prof-r">
      ${v.quote ? `<h5>TA 的话</h5><p class="bigq">${esc(v.quote)}</p>` : ''}
      <h5>成长路径</h5>${tree(v)}
      ${v.awards.length ? `<h5>获得奖项</h5><ul class="awards">${v.awards.map(a => `<li><i>★</i><div><b>${a.y}</b><span>${esc(a.name)}</span></div></li>`).join('')}</ul>` : ''}
      ${v.topics.length ? `<h5>可以聊</h5><div class="topics">${v.topics.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
    </div></div>`, hueOf(v));
  const pa = $('#pApply'); if (pa) pa.onclick = () => openApply(v.id);
  const pl = $('#pl'), hc = $('#hc');
  pl.onmousemove = e => { const r = hc.getBoundingClientRect(), x = (e.clientX - r.left)/r.width, y = (e.clientY - r.top)/r.height, cl = n => Math.max(-1, Math.min(1, n));
    hc.style.animation = 'none'; hc.style.transform = `rotateY(${cl(x-.5)*30}deg) rotateX(${cl(.5-y)*30}deg)`;
    hc.style.setProperty('--mx', x*100 + '%'); hc.style.setProperty('--my', y*100 + '%'); };
  pl.onmouseleave = () => { hc.style.transform = ''; };
}

/* ---------- application ---------- */
let A = {};
function openApply(id){
  if (!ME) return goLogin('#apply-' + id);
  const v = V.find(x => x.id === id); if (!v) return;
  A = {veteranId:id, mode:null, when:null, part:'不限', topics:new Set()};
  const opts = (arr, key, sel) => arr.map(o => `<button class="opt${o === sel ? ' on' : ''}" data-${key}="${esc(o)}">${esc(o)}</button>`).join('');
  show(`<div class="book">
    <div class="book-h"><div class="thumb">${photo(v)}</div><div><h3>申请与${esc(v.name)}交流</h3><div class="who">${esc(v.title)}</div></div></div>
    <div class="bstep"><h6>交流方式</h6><div class="modes">${Object.entries(MODES).map(([k, n]) => `<button class="mode" data-mode="${k}"><span class="e">${MODE_E[k] || ''}</span>${esc(n)}<small>${MODE_D[k] || ''}</small></button>`).join('')}</div></div>
    <div class="bstep"><h6>希望时间<i>具体时间由部门确认</i></h6>
      <div class="opts"><span class="opt-lbl">大致</span>${opts(WHEN, 'when')}</div>
      <div class="opts"><span class="opt-lbl">时段</span>${opts(PART, 'part', '不限')}</div></div>
    <div class="bstep pick"><h6>想聊的话题<i>可多选，选填</i></h6><div class="topics">${v.topics.map(t => `<span data-t="${esc(t)}">${esc(t)}</span>`).join('')}</div>
      <textarea id="note" maxlength="500" placeholder="其他想问的"></textarea></div>
    <div class="bstep"><h6>申请人</h6><div class="applicant"><b>${esc(ME.name)}</b>　${esc(ME.employeeNo)}　${esc(ME.department)}</div></div>
    <div class="book-foot"><span></span><button class="btn btn-p" id="submitA">提交</button></div>
  </div>`, hueOf(v));
  const single = (sel, key) => panel.querySelectorAll(sel).forEach(b => b.onclick = () => { A[key] = b.dataset[key]; panel.querySelectorAll(sel).forEach(x => x.classList.toggle('on', x === b)); });
  single('[data-mode]', 'mode'); single('[data-when]', 'when'); single('[data-part]', 'part');
  panel.querySelectorAll('[data-t]').forEach(s => s.onclick = () => { const t = s.dataset.t; A.topics.has(t) ? A.topics.delete(t) : A.topics.add(t); s.classList.toggle('on'); });
  $('#submitA').onclick = submitApply;
}
async function submitApply(){
  if (!A.mode) return toast('请选择交流方式');
  if (!A.when) return toast('请选择希望时间');
  const btn = $('#submitA'); btn.disabled = true;
  const v = V.find(x => x.id === A.veteranId);
  try {
    const r = await api('POST', '/api/applications', {veteranId:A.veteranId, mode:A.mode, when:A.when, part:A.part, topics:[...A.topics], note:$('#note').value.trim()});
    show(`<div class="ticket-wrap">
      <h3>已提交</h3><p class="m">部门安排好时间地点后会邮件通知你。</p>
      <div class="flow"><div class="fs done"><i>✓</i>提交申请</div><div class="fs cur"><i></i>部门安排</div><div class="fs"><i></i>邮件通知</div><div class="fs"><i></i>见面</div></div>
      <div class="ticket">
        <div class="t-h">交流申请<span>No.${r.id}</span></div>
        <div class="route"><div><small>申请人</small><b>${esc(ME.name)}</b></div><div class="ln" data-e="${MODE_E[A.mode] || ''}"></div><div style="text-align:right"><small>老兵</small><b>${esc(v.name)}</b></div></div>
        <div class="t-grid"><div><small>方式</small><b>${esc(MODES[A.mode])}</b></div><div><small>希望时间</small><b>${esc(A.when)}</b></div><div><small>时段</small><b>${esc(A.part)}</b></div>
          <div style="grid-column:1/-1"><small>时间地点</small><b class="pend">待部门安排</b></div></div>
      </div>
      <div class="cta"><button class="btn btn-g" data-close>关闭</button><button class="btn btn-p" id="toMine">我的申请</button></div>
    </div>`, hueOf(v));
    $('#toMine').onclick = () => { hide(); openDrawer(); };
    load(false);
  } catch(e){ toast(e.message); btn.disabled = false; }
}

/* ---------- my applications ---------- */
const drawer = $('#drawer'), shade = $('#shade');
async function openDrawer(){
  drawer.innerHTML = '<button class="x" id="dClose">×</button><h3>我的申请</h3><p style="color:var(--muted)">加载中…</p>';
  drawer.classList.add('open'); shade.classList.add('open'); $('#dClose').onclick = closeDrawer;
  let list = [];
  try { list = await api('GET', '/api/my/applications'); } catch(e){ return toast(e.message); }
  drawer.innerHTML = '<button class="x" id="dClose">×</button><h3>我的申请</h3>' + (list.length ? list.map(a => `<div class="bk">
      <div class="bk-h"><b>${esc(a.veteranName)}</b><span class="st ${a.status}">${STATUS[a.status]}</span></div>
      <p>${esc(MODES[a.mode] || a.mode)} · ${esc(a.when)} · ${esc(a.part)}</p>
      ${a.arrange ? `<p class="arr">${esc(a.arrange)}</p>` : ''}
      ${a.topics.length ? `<p>话题：${a.topics.map(esc).join('、')}</p>` : ''}${a.note ? `<p>${esc(a.note)}</p>` : ''}
      <p style="font-size:11px">${esc(a.createdAt)}</p>
      ${a.status === 'pending' ? `<button data-cancel="${a.id}">撤回</button>` : ''}</div>`).join('') : '<p style="color:var(--muted)">暂无申请</p>');
  $('#dClose').onclick = closeDrawer;
  drawer.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    try { await api('POST', `/api/my/applications/${b.dataset.cancel}/cancel`); toast('已撤回'); openDrawer(); load(false); } catch(e){ toast(e.message); } });
}
function closeDrawer(){ drawer.classList.remove('open'); shade.classList.remove('open'); }
shade.onclick = closeDrawer;

/* ==================================================================== admin */
const ADM = {tab:'apps', filter:'pending', apps:[]};
const TABS = [['apps','交流申请'],['vets','老兵信息'],['meta','类别与标签'],['team','助理']];
function openAdmin(tab){ if (tab) ADM.tab = tab; showAdmin(); }
async function showAdmin(){
  show(`<div class="adm"><div class="adm-h"><h3>助理入口</h3></div>
    <div class="tabs">${TABS.map(([k, n]) => `<button class="tab${ADM.tab === k ? ' on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="admBody"><p class="adm-note">加载中…</p></div></div>`, 190, true);
  panel.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ADM.tab = b.dataset.tab; showAdmin(); });
  try { await ({apps:tabApps, vets:tabVets, meta:tabMeta, team:tabTeam})[ADM.tab](); } catch(e){ toast(e.message); }
}

/* ---- applications */
async function tabApps(){ ADM.apps = await api('GET', '/api/admin/applications'); renderApps(); }
function mailText(a, arrange){
  const v = V.find(x => x.id === a.veteranId);
  const to = `${a.applicantName}（${a.applicantNo}）；${a.veteranName}${v && v.employeeNo ? `（${v.employeeNo}）` : ''}`;
  return [`收件人：${to}`, `主题：老兵说交流安排｜${a.applicantName} 与 ${a.veteranName}`, '',
    `${a.applicantName}、${a.veteranName}：`, '', '你们好！已为二位安排了一次交流：', '',
    `时间地点：${arrange || '待定'}`, `交流方式：${MODES[a.mode] || a.mode}`,
    `申请人：${a.applicantName}（${a.applicantNo}${a.applicantDept ? '，' + a.applicantDept : ''}）`,
    `想聊的话题：${a.topics.length ? a.topics.join('、') : '无'}`, ...(a.note ? [`留言：${a.note}`] : []), '',
    '时间如有冲突，请直接回复本邮件。'].join('\n');
}
function renderApps(){
  const F = [['pending','待安排'],['arranged','已安排'],['done','已完成'],['cancelled','已取消'],['all','全部']];
  const cnt = k => ADM.apps.filter(a => k === 'all' || a.status === k).length;
  const list = ADM.apps.filter(a => ADM.filter === 'all' || a.status === ADM.filter);
  $('#admBody').innerHTML = `<div class="chips" style="margin-bottom:16px">${F.map(([k, n]) => `<button class="chip sm${ADM.filter === k ? ' on' : ''}" data-f="${k}">${n} ${cnt(k)}</button>`).join('')}</div>`
    + (list.length ? list.map(a => `<div class="ap" data-id="${a.id}">
      <div class="ap-h"><div><b>${esc(a.applicantName)}</b> <small>${esc(a.applicantNo)}　${esc(a.applicantDept)}</small>　→　<b>${esc(a.veteranName)}</b></div>
        <small>${esc(a.createdAt)}　<span class="st ${a.status}">${STATUS[a.status]}</span></small></div>
      <p>${MODE_E[a.mode] || ''} ${esc(MODES[a.mode] || a.mode)} · 希望${esc(a.when)} · ${esc(a.part)}</p>
      ${a.topics.length ? `<p>话题：${a.topics.map(esc).join('、')}</p>` : ''}${a.note ? `<p>留言：${esc(a.note)}</p>` : ''}
      <div class="ap-ops"><select class="inp" data-k="status">${Object.entries(STATUS).map(([k, n]) => `<option value="${k}"${k === a.status ? ' selected' : ''}>${n}</option>`).join('')}</select>
        <input class="inp" data-k="arrange" maxlength="200" value="${esc(a.arrange)}" placeholder="时间地点，如 10月28日 15:00 F1 咖啡角">
        <button class="btn-s pri" data-save>保存</button><button class="btn-s" data-mail>复制邮件</button></div>
    </div>`).join('') : '<p class="adm-note">没有记录</p>');
  $('#admBody').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { ADM.filter = b.dataset.f; renderApps(); });
  $('#admBody').querySelectorAll('.ap').forEach(el => {
    const a = ADM.apps.find(x => x.id === +el.dataset.id), st = el.querySelector('[data-k=status]'), ar = el.querySelector('[data-k=arrange]');
    el.querySelector('[data-save]').onclick = async () => {
      let status = st.value; if (status === 'pending' && ar.value.trim()) status = 'arranged';
      try { await api('PUT', `/api/admin/applications/${a.id}`, {status, arrange:ar.value.trim()}); a.status = status; a.arrange = ar.value.trim(); toast('已保存'); renderApps(); load(false); }
      catch(e){ toast(e.message); }
    };
    el.querySelector('[data-mail]').onclick = () => copyText(mailText(a, ar.value.trim())).then(() => toast('邮件内容已复制，粘贴到 Outlook 发送即可'));
  });
}

/* ---- veterans */
function tabVets(){
  $('#admBody').innerHTML = `<div class="adm-act" style="justify-content:space-between;margin-bottom:12px"><span class="adm-note" style="margin:0">共 ${V.length} 位，按“排序”从小到大显示</span><button class="btn-s pri" id="aNew">新增老兵</button></div>
    <div class="tbl"><table><thead><tr><th></th><th>姓名</th><th>类别</th><th>职务</th><th>入职</th><th>当前岗位</th><th>奖项</th><th>本月剩余/上限</th><th>排序</th><th></th></tr></thead><tbody>
    ${V.map(v => `<tr><td><div class="thumb sm">${photo(v)}</div></td><td><b>${esc(v.name)}</b><br><small>${esc(v.employeeNo)}</small></td><td>${esc(v.category)}</td><td>${esc(v.title)}</td><td>${v.since}</td>
      <td>${esc((v.career[v.career.length - 1] || {}).pos || '')}</td><td>${v.awards.length}</td><td>${v.remaining} / ${v.quota}</td><td>${v.sort}</td>
      <td class="ops"><button class="btn-s" data-edit="${v.id}">编辑</button><button class="btn-s dan" data-del="${v.id}">删除</button></td></tr>`).join('') || '<tr><td colspan="10" style="color:var(--muted)">暂无，点右上角新增</td></tr>'}
    </tbody></table></div>`;
  $('#aNew').onclick = () => openEdit(0);
  panel.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEdit(+b.dataset.edit));
  panel.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const v = V.find(x => x.id === +b.dataset.del);
    if (!confirm(`删除「${v.name}」？已有的交流申请记录会保留。`)) return;
    try { await api('DELETE', `/api/admin/veterans/${v.id}`); await load(false); toast('已删除'); tabVets(); } catch(e){ toast(e.message); }
  });
}

function readPhoto(file){
  return new Promise((res, rej) => { const r = new FileReader(); r.onerror = rej; r.onload = () => { const img = new Image(); img.onerror = rej; img.onload = () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 800; const s = Math.max(600/img.width, 800/img.height), w = img.width*s, h = img.height*s;
    c.getContext('2d').drawImage(img, (600 - w)/2, (800 - h)/2, w, h); res(c.toDataURL('image/jpeg', .85)); }; img.src = r.result; }; r.readAsDataURL(file); });
}

function openEdit(id){
  const src = id ? V.find(x => x.id === id) : {name:'', employeeNo:'', category:CATS[0] || '', title:'', since:YEAR - 8, hue:Math.floor(Math.random()*360),
    quota:2, met:0, sort:100, photo:'', quote:'', tags:[], topics:[], career:[{y:YEAR - 8, pos:'开发工程师', note:''}], awards:[]};
  const E = JSON.parse(JSON.stringify(src));
  const selTags = new Set(E.tags);
  const cats = CATS.includes(E.category) || !E.category ? CATS : [E.category, ...CATS];
  const tagPool = [...TAGS, ...E.tags.filter(t => !TAGS.includes(t))];
  const crow = c => `<div class="row c3"><input class="inp" type="number" data-k="y" value="${esc(c.y)}" placeholder="年份"><input class="inp" data-k="pos" list="posList" value="${esc(c.pos)}" placeholder="岗位，如 PL"><input class="inp" data-k="note" maxlength="40" value="${esc(c.note)}" placeholder="简述，15 字以内"><button class="btn-s dan" data-rm title="删除">×</button></div>`;
  const arow = a => `<div class="row c2"><input class="inp" type="number" data-k="y" value="${esc(a.y)}" placeholder="年份"><input class="inp" data-k="name" maxlength="60" value="${esc(a.name)}" placeholder="奖项名称，如 公司金牌个人"><button class="btn-s dan" data-rm title="删除">×</button></div>`;
  $('#admBody').innerHTML = `
    <div class="adm-h" style="padding-right:0"><h3 style="font-size:18px">${id ? '编辑' : '新增'}：${esc(E.name) || '新老兵'}</h3><button class="btn-s" id="eBack">返回列表</button></div>
    <div class="fg">
      <div class="f full"><label>照片</label><div class="ph-edit"><div class="thumb big" id="ePh">${photo(E)}</div>
        <div><button class="btn-s" id="eUp">上传照片</button> <button class="btn-s" id="eClr">移除</button>
        <p class="adm-note" style="margin:8px 0 0">竖版照片，自动裁成 3:4</p></div><input type="file" id="eFile" accept="image/*" hidden></div></div>
      <div class="f"><label>姓名</label><input class="inp" id="eName" maxlength="20" value="${esc(E.name)}"></div>
      <div class="f"><label>工号（选填，用于邮件）</label><input class="inp" id="eNo" maxlength="64" value="${esc(E.employeeNo)}"></div>
      <div class="f"><label>入职年份</label><input class="inp" type="number" id="eSince" value="${E.since}"></div>
      <div class="f"><label>类别</label><select class="inp" id="eCat">${cats.map(c => `<option${c === E.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="f two"><label>职务</label><input class="inp" id="eTitle" maxlength="60" value="${esc(E.title)}" placeholder="如：技术专家 · 性能与可靠性"></div>
      <div class="f"><label>主题色</label><div class="hue"><input type="range" min="0" max="359" id="eHue" value="${hueOf(E)}"><span class="sw" id="eSw"></span></div></div>
      <div class="f"><label>每月可约次数</label><input class="inp" type="number" min="0" id="eQuota" value="${E.quota}"></div>
      <div class="f"><label>历史交流次数（上线前）</label><input class="inp" type="number" min="0" id="eMet" value="${E.met}"></div>
      <div class="f"><label>排序（越小越靠前）</label><input class="inp" type="number" min="0" id="eSort" value="${E.sort}"></div>
      <div class="f full"><label>一句话</label><input class="inp" id="eQuote" maxlength="120" value="${esc(E.quote)}"></div>
      <div class="f full"><label>标签（点击选择，标签库在“类别与标签”里维护）</label><div class="tagpick" id="eTags">${tagPool.map(t => `<button class="chip sm${selTags.has(t) ? ' on' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`).join('') || '<span class="adm-note" style="margin:0">标签库为空</span>'}</div></div>
      <div class="f full"><label>可以聊的话题（逗号分隔）</label><input class="inp" id="eTopics" value="${esc(E.topics.join('，'))}"></div>
      <div class="f full"><label>成长路径（按年份自动排序，最晚的一条显示为当前岗位）</label>
        <div class="rows-h c3"><span>年份</span><span>岗位</span><span>简述</span><span></span></div>
        <div id="eCareer">${E.career.map(crow).join('')}</div><button class="btn-s" id="eAddC">+ 添加节点</button></div>
      <div class="f full"><label>获得奖项</label>
        <div class="rows-h c2"><span>年份</span><span>奖项</span><span></span></div>
        <div id="eAwards">${E.awards.map(arow).join('')}</div><button class="btn-s" id="eAddA">+ 添加奖项</button></div>
    </div>
    <datalist id="posList">${POS.map(p => `<option value="${p}">`).join('')}</datalist>
    <div class="book-foot"><span></span><button class="btn btn-p" id="eSave">保存</button></div>`;
  panel.scrollTop = 0;
  const sw = () => { E.hue = +$('#eHue').value; $('#eSw').style.background = `hsl(${E.hue},80%,55%)`; };
  $('#eHue').oninput = () => { sw(); $('#ePh').innerHTML = photo(E); }; sw();
  $('#eBack').onclick = tabVets;
  $('#eUp').onclick = () => $('#eFile').click();
  $('#eFile').onchange = async e => { const f = e.target.files[0]; if (!f) return;
    try { const data = await readPhoto(f); const r = await api('POST', '/api/admin/photo', {data}); E.photo = r.photo; $('#ePh').innerHTML = photo(E); }
    catch(err){ toast(err.message || '图片读取失败'); } };
  $('#eClr').onclick = () => { E.photo = ''; $('#ePh').innerHTML = photo(E); };
  $('#eTags').onclick = e => { const b = e.target.closest('[data-tag]'); if (!b) return; const t = b.dataset.tag; selTags.has(t) ? selTags.delete(t) : selTags.add(t); b.classList.toggle('on'); };
  $('#eAddC').onclick = () => $('#eCareer').insertAdjacentHTML('beforeend', crow({y:'', pos:'', note:''}));
  $('#eAddA').onclick = () => $('#eAwards').insertAdjacentHTML('beforeend', arow({y:YEAR, name:''}));
  $('#eCareer').onclick = $('#eAwards').onclick = e => { if (e.target.closest('[data-rm]')) e.target.closest('.row').remove(); };
  $('#eSave').onclick = async () => {
    const val = s => $(s).value.trim(), split = s => s.split(/[,，、;；\n]/).map(x => x.trim()).filter(Boolean);
    const rows = (sel, keys) => [...panel.querySelectorAll(sel + ' .row')].map(r => Object.fromEntries(keys.map(k => [k, r.querySelector(`[data-k=${k}]`).value.trim()])));
    const body = {name:val('#eName'), employeeNo:val('#eNo'), since:val('#eSince'), category:$('#eCat').value, title:val('#eTitle'), hue:E.hue,
      quota:val('#eQuota'), met:val('#eMet'), sort:val('#eSort'), photo:E.photo, quote:val('#eQuote'),
      tags:tagPool.filter(t => selTags.has(t)), topics:split(val('#eTopics')),
      career:rows('#eCareer', ['y','pos','note']), awards:rows('#eAwards', ['y','name'])};
    const btn = $('#eSave'); btn.disabled = true;
    try { await api(id ? 'PUT' : 'POST', id ? `/api/admin/veterans/${id}` : '/api/admin/veterans', body); await load(false); toast('已保存'); tabVets(); }
    catch(e){ toast(e.message); btn.disabled = false; }
  };
}

/* ---- categories & tags */
function tabMeta(){
  const S = {categories: CATS.map(c => ({old:c, new:c})), tags: TAGS.map(t => ({old:t, new:t}))};
  const usage = (k, name) => k === 'categories' ? V.filter(v => v.category === name).length : V.filter(v => v.tags.includes(name)).length;
  const col = (k, title, tip) => `<div><h4>${title}</h4><p class="adm-note" style="margin:0 0 12px">${tip}</p><div id="L-${k}">
    ${S[k].map((it, i) => it.removed ? '' : `<div class="row" style="grid-template-columns:1fr 54px 38px"><input class="inp" data-k="${k}" data-i="${i}" maxlength="20" value="${esc(it.new)}"><small style="align-self:center;color:var(--muted)">${usage(k, it.old)} 人</small><button class="btn-s dan" data-rm="${k}" data-i="${i}">×</button></div>`).join('')}
    </div><div class="row" style="grid-template-columns:1fr 76px;margin-top:10px"><input class="inp" id="N-${k}" maxlength="20" placeholder="新增${title}"><button class="btn-s" data-add="${k}">添加</button></div></div>`;
  const draw = () => {
    $('#admBody').innerHTML = `<div class="lists">${col('categories', '类别', '首页筛选用。改名会同步到老兵；还有老兵的类别不能删除。')}${col('tags', '标签', '编辑老兵时从这里选。改名或删除会同步到所有老兵。')}</div>
      <div class="book-foot"><span class="adm-note" style="margin:0">修改后点保存才会生效</span><button class="btn btn-p" id="mSave">保存</button></div>`;
    $('#admBody').querySelectorAll('input[data-i]').forEach(inp => inp.oninput = () => { S[inp.dataset.k][+inp.dataset.i].new = inp.value.trim(); });
    $('#admBody').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { S[b.dataset.rm][+b.dataset.i].new = ''; S[b.dataset.rm][+b.dataset.i].removed = true; b.closest('.row').remove(); });
    $('#admBody').querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const k = b.dataset.add, inp = $('#N-' + k), v = inp.value.trim(); if (!v) return;
      if (S[k].some(x => x.new === v)) return toast('已存在'); S[k].push({old:'', new:v}); draw(); });
    $('#mSave').onclick = async () => {
      try { await api('PUT', '/api/admin/settings', {categories:S.categories, tags:S.tags}); await load(false); toast('已保存'); tabMeta(); } catch(e){ toast(e.message); }
    };
  };
  draw();
}

/* ---- assistants */
async function tabTeam(){
  const list = await api('GET', '/api/admin/assistants');
  $('#admBody').innerHTML = `<p class="adm-note" style="margin-top:0">助理可以处理交流申请、编辑老兵信息、维护类别标签。第一个登录系统的人自动成为助理；添加工号后，对方登录即可看到“助理入口”。</p>
    <div class="row" style="grid-template-columns:240px 76px;margin-bottom:16px"><input class="inp" id="tNo" placeholder="输入工号"><button class="btn-s pri" id="tAdd">添加</button></div>
    <div class="tbl"><table><thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>添加时间</th><th></th></tr></thead><tbody>
    ${list.map(a => `<tr><td>${esc(a.employeeNo)}</td><td>${esc(a.name) || '<small>尚未登录</small>'}</td><td>${esc(a.department)}</td><td><small>${esc(a.addedAt)}</small></td>
      <td class="ops"><button class="btn-s dan" data-no="${esc(a.employeeNo)}">移除</button></td></tr>`).join('')}
    </tbody></table></div>`;
  $('#tAdd').onclick = async () => { const no = $('#tNo').value.trim(); if (!no) return;
    try { await api('POST', '/api/admin/assistants', {employeeNo:no}); toast('已添加'); tabTeam(); } catch(e){ toast(e.message); } };
  $('#admBody').querySelectorAll('[data-no]').forEach(b => b.onclick = async () => {
    const no = b.dataset.no, self = no === ME.employeeNo;
    if (!confirm(self ? '移除自己后将不能再进入助理入口，确定？' : `移除助理 ${no}？`)) return;
    try { await api('DELETE', `/api/admin/assistants/${encodeURIComponent(no)}`); toast('已移除');
      if (self){ hide(); load(false); } else tabTeam(); } catch(e){ toast(e.message); }
  });
}

/* ---------- start ---------- */
const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('in')), {threshold:.08});
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
load(true).then(() => {
  const m = location.hash.match(/^#apply-(\d+)$/);
  if (m){ history.replaceState(null, '', location.pathname); openApply(+m[1]); }
}).catch(e => toast(e.message));
