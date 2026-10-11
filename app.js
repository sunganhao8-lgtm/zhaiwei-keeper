/* 宅卫 · 空置房管家 — MVP (纯前端, localStorage)
 * 核心循环: 定期巡检 → 到店打卡留痕 → 电子报告卡(社交信任) → 异常处置 → 订阅续费
 * 同门产品: 宅咪打卡(宅域 Zhaiyu 旗下)
 */
'use strict';

/* ---------- 配置 ---------- */
const FREQ_META = {
  w1: { days: 7,  label: '每周 1 次' },
  m2: { days: 15, label: '每月 2 次' },
  m1: { days: 30, label: '每月 1 次' },
};
const SCENE_META = {
  bird:     { icon: '🏝️', label: '候鸟旅居' },
  away:     { icon: '🏙️', label: '异地多房' },
  overseas: { icon: '✈️', label: '海外华侨' },
};

/* 检查项标准库（通用内核 + 场景附加项） */
const ITEM_LIB = {
  vent:     { icon: '🪟', label: '通风换气',     tip: '开窗通风 30 分钟' },
  leak:     { icon: '🚰', label: '水路渗漏',     tip: '水表走字、龙头角阀渗水' },
  toilet:   { icon: '🚽', label: '马桶补水',     tip: '存水弯补水，防干涸返臭' },
  meter:    { icon: '⚡', label: '水电表读数',   tip: '记录读数，异常走字上报' },
  mold:     { icon: '🦠', label: '霉斑检查',     tip: '墙角、柜背、卫生间' },
  window:   { icon: '🚪', label: '门窗关闭',     tip: '锁扣逐一确认' },
  mail:     { icon: '📮', label: '信箱门口',     tip: '清理传单快递，不留"无人"痕迹' },
  humid:    { icon: '🌡️', label: '温湿度记录',  tip: '记录室温湿度' },
  plant:    { icon: '🪴', label: '绿植浇灌',     tip: '' },
  security: { icon: '🔒', label: '防盗检查',     tip: '门锁窗锁、可疑痕迹' },
  typhoon:  { icon: '🌀', label: '防台风检查',   tip: '阳台物品、地漏排水', scene: 'bird' },
  humidify: { icon: '💧', label: '除湿机运行',   tip: '倒水箱、设除湿模式', scene: 'bird' },
  air:      { icon: '❄️', label: '空调试机',     tip: '制冷制热各试 5 分钟', scene: 'away' },
  video:    { icon: '📹', label: '视频连线巡检', tip: '按业主时区预约连线', scene: 'overseas' },
};
const BASE_ITEMS = ['vent', 'leak', 'toilet', 'meter', 'mold', 'window', 'mail', 'humid', 'plant', 'security'];
const SCENE_ITEMS = {
  bird:     [...BASE_ITEMS, 'typhoon', 'humidify'],
  away:     [...BASE_ITEMS, 'air'],
  overseas: [...BASE_ITEMS, 'video'],
};

/* 异常处置建议 */
const ADVICE = {
  leak:     '先关闭总阀止水，联系物业检修，留存照片作证据',
  mold:     '除湿通风 48 小时后复查，霉斑扩散需报修处理',
  security: '检查门锁有无撬痕，必要时联系物业调取监控',
  toilet:   '补水后仍返臭多为地漏干涸，对地漏补一次水',
  meter:    '无人居住时水电表不应走字，异常走字立即上报',
  typhoon:  '收回阳台悬挂物，检查排水口，台风后 24h 内复查',
  humidify: '除湿机停机需倒水箱并重启，连续异常建议更换',
  air:      '试机异常记录故障代码，联系售后检修',
  window:   '未关严的门窗重新锁闭，渗风处贴密封条',
  plant:    '枯萎绿植拍照给业主决定处置',
  vent:     '',
  mail:     '',
  humid:    '',
  video:    '',
};

/* ---------- 存储 ---------- */
const KEY = 'zhaiwei_keeper_v1';
let state = load();

/* 导入/读取兜底: 缺字段补默认、脏字段清洗, 防坏数据打崩渲染 */
function normalizeState(s) {
  if (!s || !Array.isArray(s.houses) || !Array.isArray(s.visits)) return null;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const out = { role: s.role === 'keeper' ? 'keeper' : 'owner', houses: [], visits: [] };
  s.houses.forEach(h => {
    if (!h || !h.id || !h.name) return;
    const scene = SCENE_META[h.scene] ? h.scene : 'away';
    let items = Array.isArray(h.itemIds) ? h.itemIds.filter(id => ITEM_LIB[id]) : [];
    if (!items.length) items = SCENE_ITEMS[scene].slice(); /* 过滤后为空 → 回退场景默认, 空清单没法巡检 */
    out.houses.push({
      id: String(h.id),
      name: String(h.name).slice(0, 20),
      address: typeof h.address === 'string' ? h.address.slice(0, 40) : '',
      scene,
      freq: FREQ_META[h.freq] ? h.freq : 'm1',
      itemIds: items,
      keyNote: typeof h.keyNote === 'string' ? h.keyNote : '',
      createdAt: dateRe.test(h.createdAt || '') ? h.createdAt : todayKey(),
    });
  });
  const ids = new Set(out.houses.map(h => h.id));
  s.visits.forEach(v => {
    if (!v || !v.id || !v.houseId || !ids.has(String(v.houseId))) return;
    out.visits.push({
      id: String(v.id),
      houseId: String(v.houseId),
      date: dateRe.test(v.date || '') ? v.date : todayKey(),
      time: typeof v.time === 'string' ? v.time : nowStamp(),
      status: v.status === 'abnormal' ? 'abnormal' : 'done',
      geoNote: typeof v.geoNote === 'string' ? v.geoNote : '',
      entries: Array.isArray(v.entries)
        ? v.entries.filter(e => e && ITEM_LIB[e.itemId]).map(e => ({
            itemId: e.itemId, result: e.result === 'bad' ? 'bad' : 'ok',
            note: typeof e.note === 'string' ? e.note : '',
          }))
        : [],
      photos: Array.isArray(v.photos) ? v.photos.filter(p => typeof p === 'string') : [],
    });
  });
  return out;
}
function load() {
  try {
    const s = normalizeState(JSON.parse(localStorage.getItem(KEY)));
    if (s) return s;
  } catch (e) { /* 损坏则重建 */ }
  return { role: 'owner', houses: [], visits: [] };
}
function save() { localStorage.setItem(KEY, JSON.stringify(state)); }

/* ---------- 日期工具 ---------- */
function fmtKey(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function keyToDate(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(k, n) { const d = keyToDate(k); d.setDate(d.getDate() + n); return fmtKey(d); }
function todayKey() { return fmtKey(new Date()); }
function daysBetween(a, b) { return Math.round((keyToDate(b) - keyToDate(a)) / 86400000); }
function nowStamp() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return `${todayKey()} ${hh}:${mm}`;
}

/* ---------- 核心逻辑 ---------- */
function houseItems(h) { return (h.itemIds || []).filter(id => ITEM_LIB[id]); }
function visitsOf(houseId) { return state.visits.filter(v => v.houseId === houseId); }
function lastVisitOf(houseId) {
  let last = null;
  for (const v of state.visits) if (v.houseId === houseId && (!last || v.date > last.date)) last = v;
  return last;
}
/* 下次巡检日 = 最近一次巡检 + 周期；从未巡检则建档日 + 周期 */
function nextDueDate(h, today) {
  const last = lastVisitOf(h.id);
  const start = (last && last.date) || h.createdAt || today;
  return addDays(start, FREQ_META[h.freq].days);
}
function dueStatus(h, today) {
  const due = nextDueDate(h, today || todayKey());
  const diff = daysBetween(todayKey(), due);
  if (diff < 0) return { state: 'overdue', due, diff, text: `已超期 ${-diff} 天` };
  if (diff === 0) return { state: 'due', due, diff, text: '今天到期' };
  return { state: 'ok', due, diff, text: `还剩 ${diff} 天` };
}
/* 提交巡检 → 生成报告；任一异常则整单标记 abnormal */
function commitVisit(houseId, { geoNote, entries, photos, dateKey, stamp }) {
  const bad = entries.some(e => e.result === 'bad');
  const v = {
    id: 'v' + Date.now() + Math.floor(Math.random() * 100),
    houseId,
    date: dateKey || todayKey(),
    time: stamp || nowStamp(),
    status: bad ? 'abnormal' : 'done',
    geoNote: geoNote || '',
    entries,
    photos: photos || [],
  };
  state.visits.push(v);
  save();
  return v;
}
function abnormalEntries(v) { return v.entries.filter(e => e.result === 'bad'); }
function adviceFor(itemId) { return ADVICE[itemId] || '建议尽快安排维修处理'; }
function houseAbnormalCount(houseId) {
  return visitsOf(houseId).filter(v => v.status === 'abnormal').length;
}

/* ---------- 渲染 ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function render() {
  document.querySelectorAll('#roleSeg button').forEach(b =>
    b.classList.toggle('active', b.dataset.v === state.role));
  const main = document.getElementById('mainView');
  main.innerHTML = '';
  if (state.role === 'keeper') renderKeeper(main); else renderOwner(main);
}

/* ---- 业主端 ---- */
function renderOwner(main) {
  const tk = todayKey();

  /* 告警横幅 */
  const banner = document.createElement('div');
  if (!state.houses.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.style.cssText = 'background:var(--card);border-radius:18px';
    empty.innerHTML = `
      <div class="e-icon">🏡</div>
      <h2>你的空房子，有人替你看着</h2>
      <p>定期上门 · 通风防霉 · 拍照报告 · 异常即报<br>美国 Home Watch、日本空き家管理的中国版</p>
      <button class="btn-primary" onclick="openHouseModal()">添加我的第一套房源</button>`;
    main.appendChild(empty);
    return;
  }
  const worst = { overdue: [], due: [] };
  state.houses.forEach(h => { const s = dueStatus(h, tk); if (s.state === 'overdue') worst.overdue.push({ h, s }); if (s.state === 'due') worst.due.push(h); });
  if (worst.overdue.length) {
    banner.className = 'banner alert';
    banner.innerHTML = `⚠️ <b>${esc(worst.overdue[0].h.name)}</b> ${worst.overdue[0].s.text}没巡检了${worst.overdue.length > 1 ? `（还有 ${worst.overdue.length - 1} 套超期）` : ''}<br>长期无人照看的房子，漏水和霉变正在发生`;
  } else if (worst.due.length) {
    banner.className = 'banner due';
    banner.innerHTML = `📅 <b>${esc(worst.due[0].name)}</b> 今天该巡检了${worst.due.length > 1 ? `（共 ${worst.due.length} 套到期）` : ''}`;
  } else {
    banner.className = 'banner';
    banner.innerHTML = `🏡 <b>一切安好</b> · ${state.houses.length} 套房都在守护中，放心忙你的`;
  }
  main.appendChild(banner);

  /* 房源列表 */
  const sec = document.createElement('section');
  sec.className = 'section';
  sec.innerHTML = `<div class="section-title">我的房源 <button class="btn-sm" id="btnAddHouse">＋ 添加房源</button></div><div id="houseList"></div>`;
  main.appendChild(sec);
  const list = sec.querySelector('#houseList');
  state.houses.forEach(h => list.appendChild(houseCard(h, tk)));

  /* 最近报告 */
  const rsec = document.createElement('section');
  rsec.className = 'section';
  const recent = [...state.visits].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8);
  rsec.innerHTML = `<div class="section-title">巡检报告 <span class="sub">每次上门都有留痕</span></div><div id="reportList"></div>`;
  main.appendChild(rsec);
  const rlist = rsec.querySelector('#reportList');
  if (!recent.length) {
    rlist.innerHTML = `<div class="empty">还没有巡检记录<br>切换到管家端跑一次，或在地址加 <b>?demo=1</b> 看演示</div>`;
  }
  recent.forEach(v => {
    const h = state.houses.find(x => x.id === v.houseId) || { name: '(已删除房源)' };
    const row = document.createElement('div');
    row.className = 'report-row';
    row.innerHTML = `
      <div class="r-date">${v.date.slice(5)}</div>
      <div class="r-body">${esc(h.name)} · ${v.status === 'abnormal' ? `⚠️ ${abnormalEntries(v).length} 项异常` : '✓ 全部正常'}</div>
      <span class="badge ${v.status === 'abnormal' ? 'warn' : ''}">${v.status === 'abnormal' ? '异常' : '正常'}</span>
      <button class="btn-sm">报告</button>`;
    row.querySelector('button').onclick = () => openReportDetail(v);
    rlist.appendChild(row);
  });
}

function houseCard(h, tk) {
  const st = dueStatus(h, tk);
  const abn = houseAbnormalCount(h.id);
  const card = document.createElement('div');
  card.className = 'house-card';
  card.innerHTML = `
    <div class="house-head">
      <div class="house-ico">${SCENE_META[h.scene].icon}</div>
      <div class="house-meta">
        <div class="house-name">${esc(h.name)}</div>
        <div class="house-sub">${SCENE_META[h.scene].label} · ${FREQ_META[h.freq].label} · ${houseItems(h).length} 项检查${h.address ? ' · ' + esc(h.address) : ''}</div>
      </div>
      <span class="badge ${st.state === 'overdue' ? 'warn' : st.state === 'due' ? 'due' : ''}">${st.state === 'overdue' ? '超期' : st.state === 'due' ? '今日' : '守护中'}</span>
    </div>
    <div class="house-status">
      <span>下次巡检 <span class="${st.state === 'overdue' ? 'overdue' : st.state === 'due' ? 'due' : 'ok'}">${st.text}</span><span style="color:var(--ink-2)">（${st.due}）</span></span>
      <span style="color:var(--ink-2)">已巡 ${visitsOf(h.id).length} 次${abn ? ` · <span style="color:var(--warn)">异常 ${abn} 次</span>` : ''}</span>
    </div>
    <div class="house-actions">
      <button class="btn-sm" data-act="report">查看报告</button>
      <button class="btn-sm" data-act="edit">编辑</button>
    </div>`;
  card.querySelector('[data-act="report"]').onclick = () => {
    const vs = visitsOf(h.id).sort((a, b) => (a.date < b.date ? 1 : -1));
    if (vs.length) openReportDetail(vs[0]); else alert('这套房还没有巡检报告');
  };
  card.querySelector('[data-act="edit"]').onclick = () => openHouseModal(h);
  return card;
}

/* ---- 管家端 ---- */
function renderKeeper(main) {
  const tk = todayKey();
  const sec = document.createElement('section');
  sec.className = 'section';
  sec.innerHTML = `<div class="section-title">巡检任务 <span class="sub">超期优先，就近排线</span></div><div id="taskList"></div><div id="taskEmpty"></div>`;
  main.appendChild(sec);
  const list = sec.querySelector('#taskList');
  const tasks = state.houses
    .map(h => ({ h, s: dueStatus(h, tk) }))
    .sort((a, b) => a.s.diff - b.s.diff); /* 超期最久的排最前 */
  tasks.forEach(({ h, s }) => {
    const card = document.createElement('div');
    card.className = 'house-card';
    card.innerHTML = `
      <div class="house-head">
        <div class="house-ico">${SCENE_META[h.scene].icon}</div>
        <div class="house-meta">
          <div class="house-name">${esc(h.name)}</div>
          <div class="house-sub">${esc(h.address || '')} · ${FREQ_META[h.freq].label} · ${houseItems(h).length} 项检查</div>
        </div>
        <span class="badge ${s.state === 'overdue' ? 'warn' : s.state === 'due' ? 'due' : 'plain'}">${s.state === 'overdue' ? '超期' : s.state === 'due' ? '今日' : '未到期'}</span>
      </div>
      <div class="house-status">
        <span>${s.state === 'overdue' ? `<span class="overdue">${s.text}</span>` : s.state === 'due' ? `<span class="due">${s.text}</span>` : `下次巡检 ${s.text}`}</span>
        <span style="color:var(--ink-2)">上次：${lastVisitOf(h.id) ? lastVisitOf(h.id).date : '还没巡过'}</span>
      </div>
      <div class="house-actions"><button class="btn-primary" style="padding:10px">开始巡检</button></div>`;
    card.querySelector('button.btn-primary').onclick = () => openPatrol(h);
    list.appendChild(card);
  });
  if (!state.houses.length) {
    sec.querySelector('#taskEmpty').innerHTML = `<div class="empty">暂无任务<br>请业主端添加房源，或地址加 <b>?demo=1</b></div>`;
  }

  /* 今日已完成 */
  const doneToday = state.visits.filter(v => v.date === tk);
  if (doneToday.length) {
    const dsec = document.createElement('section');
    dsec.className = 'section';
    dsec.innerHTML = `<div class="section-title">今日已完成</div>`;
    doneToday.forEach(v => {
      const h = state.houses.find(x => x.id === v.houseId) || { name: '?' };
      const row = document.createElement('div');
      row.className = 'report-row';
      row.innerHTML = `<div class="r-date">${v.time.slice(11)}</div>
        <div class="r-body">${esc(h.name)} · ${v.status === 'abnormal' ? '⚠️ 有异常' : '✓ 正常'}</div>
        <button class="btn-sm">报告</button>`;
      row.querySelector('button').onclick = () => openReportDetail(v);
      dsec.appendChild(row);
    });
    main.appendChild(dsec);
  }
}

/* ---------- 弹层 ---------- */
function openModal(html) {
  document.getElementById('modal').innerHTML = html;
  document.getElementById('mask').classList.add('show');
}
function closeModal() { document.getElementById('mask').classList.remove('show'); }

/* ---- 添加/编辑房源 ---- */
function openHouseModal(existing) {
  const h = existing || { name: '', address: '', scene: 'bird', freq: 'm2', itemIds: SCENE_ITEMS.bird.slice(), keyNote: '' };
  openModal(`
    <h3>${existing ? '编辑' : '添加'}房源</h3>
    <div class="field"><label>房源名称</label>
      <input type="text" id="h_name" value="${esc(h.name)}" maxlength="20" placeholder="比如：海棠湾·候鸟小屋"></div>
    <div class="field"><label>地址（可选）</label>
      <input type="text" id="h_addr" value="${esc(h.address || '')}" maxlength="40" placeholder="小区 + 楼栋房号"></div>
    <div class="field"><label>场景（决定默认检查项）</label>
      <div class="seg" id="h_scene">
        ${Object.keys(SCENE_META).map(k => `<button data-v="${k}" class="${h.scene === k ? 'active' : ''}">${SCENE_META[k].icon} ${SCENE_META[k].label}</button>`).join('')}
      </div></div>
    <div class="field"><label>巡检频率（对标美日：300-500元/月）</label>
      <div class="seg" id="h_freq">
        ${Object.keys(FREQ_META).map(k => `<button data-v="${k}" class="${h.freq === k ? 'active' : ''}">${FREQ_META[k].label}</button>`).join('')}
      </div></div>
    <div class="field"><label>检查项（点选增删）</label>
      <div class="chips" id="h_items">
        ${Object.keys(ITEM_LIB).map(id => `<button data-v="${id}" class="${h.itemIds.includes(id) ? 'active' : ''}">${ITEM_LIB[id].icon} ${ITEM_LIB[id].label}</button>`).join('')}
      </div></div>
    <div class="field"><label>门锁/进入方式（仅本机保存）</label>
      <input type="text" id="h_key" value="${esc(h.keyNote || '')}" maxlength="40" placeholder="比如：智能锁临时密码 / 物业代开"></div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="h_save">保存</button>
    </div>
    ${existing ? `<button class="danger" id="h_del">删除房源（含巡检记录）</button>` : ''}
  `);

  let scene = h.scene, freq = h.freq;
  const itemIds = new Set(h.itemIds);
  document.querySelectorAll('#h_scene button').forEach(b => b.onclick = () => {
    scene = b.dataset.v;
    document.querySelectorAll('#h_scene button').forEach(x => x.classList.toggle('active', x === b));
    /* 换场景 → 重置为该场景默认检查项 */
    itemIds.clear(); SCENE_ITEMS[scene].forEach(i => itemIds.add(i));
    document.querySelectorAll('#h_items button').forEach(x =>
      x.classList.toggle('active', itemIds.has(x.dataset.v)));
  });
  document.querySelectorAll('#h_freq button').forEach(b => b.onclick = () => {
    freq = b.dataset.v;
    document.querySelectorAll('#h_freq button').forEach(x => x.classList.toggle('active', x === b));
  });
  document.querySelectorAll('#h_items button').forEach(b => b.onclick = () => {
    const id = b.dataset.v;
    if (itemIds.has(id)) itemIds.delete(id); else itemIds.add(id);
    b.classList.toggle('active', itemIds.has(id));
  });
  document.getElementById('h_save').onclick = () => {
    const name = document.getElementById('h_name').value.trim();
    if (!name) { document.getElementById('h_name').focus(); return; }
    const data = {
      name,
      address: document.getElementById('h_addr').value.trim(),
      scene, freq,
      itemIds: Object.keys(ITEM_LIB).filter(id => itemIds.has(id)),
      keyNote: document.getElementById('h_key').value.trim(),
    };
    if (existing) Object.assign(existing, data);
    else state.houses.push({ id: 'h' + Date.now(), createdAt: todayKey(), ...data });
    save(); closeModal(); render();
  };
  const del = document.getElementById('h_del');
  if (del) del.onclick = () => {
    if (!confirm(`确定删除「${existing.name}」和全部巡检记录？不可恢复`)) return;
    state.houses = state.houses.filter(x => x.id !== existing.id);
    state.visits = state.visits.filter(v => v.houseId !== existing.id);
    save(); closeModal(); render();
  };
}

/* ---- 报告详情 ---- */
function openReportDetail(v) {
  const h = state.houses.find(x => x.id === v.houseId) || { name: '(已删除房源)' };
  const rows = v.entries.map(e => {
    const m = ITEM_LIB[e.itemId] || { icon: '•', label: e.itemId };
    const bad = e.result === 'bad';
    return `<div class="check-row" style="margin-bottom:6px">
      <div class="check-ico">${m.icon}</div>
      <div class="check-body">
        <div class="check-name" style="${bad ? 'color:var(--warn)' : ''}">${m.label} ${bad ? '⚠️ 异常' : '✓'}</div>
        ${bad && e.note ? `<div class="check-tip" style="color:var(--warn)">${esc(e.note)}</div>` : ''}
        ${bad ? `<div class="check-tip">建议：${adviceFor(e.itemId)}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  openModal(`
    <h3>巡检报告 · ${esc(h.name)}</h3>
    <div class="field" style="font-size:13px;color:var(--ink-2);line-height:1.8">
      时间：${v.time}<br>到店打卡：${v.geoNote ? esc(v.geoNote) : '（未记录定位）'}<br>
      结果：<b style="color:${v.status === 'abnormal' ? 'var(--warn)' : 'var(--green)'}">${v.status === 'abnormal' ? `异常 ${abnormalEntries(v).length} 项` : '全部正常'}</b>
      · 检查 ${v.entries.length} 项
    </div>
    ${v.photos.length ? `<div class="photo-grid">${v.photos.map(p => `<img src="${p}" alt="">`).join('')}</div>` : ''}
    <div style="margin-top:14px">${rows}</div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeModal()">关闭</button>
      <button class="btn-primary" id="rd_share">生成分享卡 · 发给家人</button>
    </div>`);
  document.getElementById('rd_share').onclick = () => showReportCard(v);
}

/* ---- 执行巡检（管家） ---- */
function openPatrol(h) {
  const items = houseItems(h);
  const pat = { geoNote: '', results: {}, photos: [] };
  openModal(`
    <h3>开始巡检 · ${esc(h.name)}</h3>
    <div class="field">
      <label>到店打卡 <button class="btn-sm" id="p_geo" style="margin-left:6px">📍 获取定位</button></label>
      <input type="text" id="p_geonote" maxlength="60" placeholder="定位失败就手动备注：小区 / 楼栋 / 门口">
    </div>
    <div class="field"><label>检查项（逐项 ✓ 正常 / ⚠ 异常）</label>
      ${items.map(id => {
        const m = ITEM_LIB[id];
        return `<div class="check-row">
          <div class="check-ico">${m.icon}</div>
          <div class="check-body"><div class="check-name">${m.label}</div>${m.tip ? `<div class="check-tip">${m.tip}</div>` : ''}</div>
          <div class="check-toggle">
            <button data-id="${id}" data-r="ok">✓</button>
            <button data-id="${id}" data-r="bad">⚠</button>
          </div>
        </div>
        <div class="bad-note" id="note_${id}" style="display:none">
          <input type="text" maxlength="60" placeholder="异常说明（拍下照片更好）">
        </div>
        <div class="bad-advice" id="adv_${id}" style="display:none">建议：${adviceFor(id)}</div>`;
      }).join('')}
    </div>
    <div class="field"><label>现场照片（最多 4 张，自动压缩）</label>
      <div class="chips" id="p_photos"></div>
      <input type="file" accept="image/*" id="p_file" multiple style="display:none">
      <button class="btn-sm" id="p_addphoto" style="margin-top:8px">📷 添加照片</button>
    </div>
    <div class="modal-actions">
      <button class="btn-ghost" onclick="closeModal()">取消</button>
      <button class="btn-primary" id="p_submit">提交巡检报告</button>
    </div>`);

  const noteEls = {};
  items.forEach(id => { noteEls[id] = document.querySelector(`#note_${id} input`); });

  /* 定位（http://局域网IP 属非安全上下文会失败 → 引导手动备注） */
  document.getElementById('p_geo').onclick = () => {
    const btn = document.getElementById('p_geo');
    btn.textContent = '定位中…';
    if (!navigator.geolocation) { btn.textContent = '📍 不支持，请手动备注'; return; }
    navigator.geolocation.getCurrentPosition(
      p => {
        pat.geoNote = `${p.coords.latitude.toFixed(5)},${p.coords.longitude.toFixed(5)}`;
        document.getElementById('p_geonote').value = pat.geoNote;
        btn.textContent = '📍 已定位';
      },
      () => { btn.textContent = '📍 失败，请手动备注'; },
      { timeout: 5000, maximumAge: 60000 });
  };
  document.getElementById('p_geonote').oninput = e => { pat.geoNote = e.target.value; };

  /* 检查项 ✓/⚠ */
  document.querySelectorAll('.check-toggle button').forEach(b => b.onclick = () => {
    const id = b.dataset.id, r = b.dataset.r;
    pat.results[id] = r;
    b.parentElement.querySelectorAll('button').forEach(x => x.classList.remove('on-ok', 'on-bad'));
    b.classList.add(r === 'ok' ? 'on-ok' : 'on-bad');
    document.getElementById(`note_${id}`).style.display = r === 'bad' ? '' : 'none';
    document.getElementById(`adv_${id}`).style.display = r === 'bad' ? '' : 'none';
  });

  /* 照片 */
  const renderPhotos = () => {
    document.getElementById('p_photos').innerHTML =
      pat.photos.map((_, i) => `<span class="badge plain">📷 照片${i + 1}</span>`).join('') +
      (pat.photos.length ? `<button class="btn-sm" id="p_clearphoto">清空</button>` : '');
    const c = document.getElementById('p_clearphoto');
    if (c) c.onclick = () => { pat.photos = []; renderPhotos(); };
  };
  renderPhotos();
  document.getElementById('p_addphoto').onclick = () => document.getElementById('p_file').click();
  document.getElementById('p_file').onchange = e => {
    const files = [...e.target.files].slice(0, 4 - pat.photos.length);
    let pending = files.length;
    if (!pending) return;
    files.forEach(f => compressImage(f, 480, dataURL => {
      if (dataURL && pat.photos.length < 4) pat.photos.push(dataURL);
      if (--pending === 0) renderPhotos();
    }));
    e.target.value = '';
  };

  /* 提交 */
  document.getElementById('p_submit').onclick = () => {
    const missed = items.filter(id => !pat.results[id]);
    if (missed.length) { alert(`还有 ${missed.length} 项没检查完（${missed.map(i => ITEM_LIB[i].label).join('、')}）`); return; }
    const entries = items.map(id => ({
      itemId: id,
      result: pat.results[id],
      note: pat.results[id] === 'bad' ? (noteEls[id] ? noteEls[id].value.trim() : '') : '',
    }));
    const v = commitVisit(h.id, {
      geoNote: document.getElementById('p_geonote').value.trim() || pat.geoNote,
      entries,
      photos: pat.photos,
    });
    closeModal(); render();
    showReportCard(v); /* 立即出分享卡 —— 演示时刻 */
  };
}

/* 照片压缩到 maxSide 内，JPEG */
function compressImage(file, maxSide, cb) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    cb(cv.toDataURL('image/jpeg', 0.6));
  };
  img.onerror = () => cb(null);
  img.src = URL.createObjectURL(file);
}

/* ---------- 报告分享卡 (Canvas 3:4) ---------- */
/* canvas 文本超宽加省略号 */
function fitText(g, text, maxWidth) {
  if (g.measureText(text).width <= maxWidth) return text;
  while (text.length > 1 && g.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
  return text + '…';
}
function loadImg(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
async function drawReportCard(v) {
  const h = state.houses.find(x => x.id === v.houseId) || { name: '房源', scene: 'away', freq: 'm1', address: '' };
  const abn = abnormalEntries(v);
  const photos = (await Promise.all((v.photos || []).slice(0, 2).map(loadImg))).filter(Boolean);

  const W = 1080, H = 1440;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');

  /* 米白底 + 房子水印 */
  g.fillStyle = '#F5F3EE'; g.fillRect(0, 0, W, H);
  g.save();
  g.globalAlpha = 0.045; g.font = '110px sans-serif';
  for (let i = 0; i < 8; i++) {
    g.save();
    g.translate(110 + (i % 3) * 400, 220 + Math.floor(i / 3) * 400);
    g.rotate(i % 2 ? -0.3 : 0.25);
    g.fillText('🏡', 0, 0);
    g.restore();
  }
  g.restore();

  /* 头部 */
  g.textAlign = 'center';
  g.fillStyle = '#B08A4F'; g.font = '600 34px sans-serif';
  g.fillText(v.time, W / 2, 110);
  g.fillStyle = '#26332B'; g.font = '800 88px sans-serif';
  g.fillText('宅卫巡检报告', W / 2, 220);
  g.fillStyle = '#2F6B4F'; g.font = '600 36px sans-serif';
  g.fillText('空置房定期巡查 · 让房子替你安心', W / 2, 285);

  /* 房源块 */
  const hy = 360, blockH = 150;
  roundRect(g, 90, hy, W - 180, blockH, 28);
  g.fillStyle = '#FFFFFF'; g.fill();
  g.textAlign = 'left';
  g.fillStyle = '#26332B'; g.font = '800 52px sans-serif';
  g.fillText(fitText(g, h.name || '房源', W - 280), 140, hy + 66);
  g.fillStyle = '#8B948C'; g.font = '400 30px sans-serif';
  const scene = SCENE_META[h.scene] || SCENE_META.away;
  const sub = `${scene.icon} ${scene.label} · ${FREQ_META[h.freq] ? FREQ_META[h.freq].label : ''}${h.address ? ' · ' + h.address : ''}`;
  g.fillText(fitText(g, sub, W - 280), 140, hy + 120);

  /* 结果统计条 */
  const sy = hy + 260;
  const stats = [
    { n: String(v.entries.length), l: '检查项' },
    { n: String(v.entries.length - abn.length), l: '正常', hot: !abn.length },
    { n: String(abn.length), l: '异常', hot: !!abn.length },
  ];
  g.textAlign = 'center';
  stats.forEach((it, i) => {
    const x = W / 6 + (W / 3) * i;
    g.fillStyle = it.hot ? (it.l === '异常' ? '#C94040' : '#2F6B4F') : '#26332B';
    g.font = '800 80px sans-serif';
    g.fillText(it.n, x, sy);
    g.fillStyle = '#8B948C'; g.font = '400 30px sans-serif';
    g.fillText(it.l, x, sy + 52);
    if (i < 2) { g.fillStyle = '#E4E1D8'; g.fillRect(W / 3 * (i + 1), sy - 66, 2, 100); }
  });

  /* 照片区（最多 2 张，无图画占位） */
  const py = sy + 100, ph = 210, pw = (W - 200 - 20) / 2;
  for (let i = 0; i < 2; i++) {
    const x = 100 + (pw + 20) * i;
    roundRect(g, x, py, pw, ph, 24);
    g.fillStyle = '#EDEAE2'; g.fill();
    const img = photos[i];
    if (img) {
      g.save(); roundRect(g, x, py, pw, ph, 24); g.clip();
      const s = Math.max(pw / img.width, ph / img.height);
      g.drawImage(img, x + (pw - img.width * s) / 2, py + (ph - img.height * s) / 2, img.width * s, img.height * s);
      g.restore();
    } else {
      g.fillStyle = '#D8D4C8'; g.font = '64px sans-serif';
      g.fillText(i === 0 ? '🏠' : '📷', x + pw / 2, py + ph / 2 + 22);
    }
  }

  /* 检查清单（两列） */
  const ly = py + ph + 50;
  const colW = (W - 200) / 2;
  const rowH = 40, perCol = Math.ceil(v.entries.length / 2);
  g.font = '400 28px sans-serif';
  v.entries.forEach((e, i) => {
    const col = Math.floor(i / perCol), row = i % perCol;
    const x = 100 + col * (colW + 0), y = ly + row * rowH;
    const m = ITEM_LIB[e.itemId] || { label: e.itemId };
    const bad = e.result === 'bad';
    g.textAlign = 'left';
    g.fillStyle = bad ? '#C94040' : '#26332B';
    g.fillText(`${bad ? '⚠' : '✓'} ${m.label}`, x, y);
  });

  /* 结论 */
  const vy = ly + perCol * rowH + 55;
  g.textAlign = 'center';
  if (abn.length) {
    g.fillStyle = '#C94040'; g.font = '700 44px sans-serif';
    g.fillText(`发现 ${abn.length} 项异常 · 已附处理建议`, W / 2, vy);
  } else {
    g.fillStyle = '#2F6B4F'; g.font = '700 44px sans-serif';
    g.fillText('今日一切安好 🏡', W / 2, vy);
  }
  if (v.geoNote) {
    g.fillStyle = '#8B948C'; g.font = '400 26px sans-serif';
    g.fillText(`打卡位置：${v.geoNote.slice(0, 30)}`, W / 2, vy + 50);
  }

  /* 底部品牌 */
  g.fillStyle = '#8B948C'; g.font = '600 30px sans-serif';
  g.fillText('宅卫 · 空置房管家 — 定期巡查 · 电子报告 · 异常处置', W / 2, 1398);

  return cv.toDataURL('image/jpeg', 0.92);
}
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

async function showReportCard(v) {
  const url = await drawReportCard(v);
  document.getElementById('shareImg').src = url;
  document.getElementById('shareMask').classList.add('show');
}

/* ---------- 导入导出 ---------- */
function openExport() {
  openModal(`
    <h3>导出数据</h3>
    <div class="field"><label>复制以下内容备份（含全部房源与巡检记录）</label>
      <textarea id="ex_ta" rows="8" readonly>${esc(JSON.stringify(state))}</textarea>
    </div>
    <div class="modal-actions"><button class="btn-primary" id="ex_copy">复制</button><button class="btn-ghost" onclick="closeModal()">关闭</button></div>`);
  document.getElementById('ex_copy').onclick = () => {
    const ta = document.getElementById('ex_ta');
    ta.select();
    if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(() => {});
    document.execCommand('copy');
    document.getElementById('ex_copy').textContent = '已复制 ✓';
  };
}
function openImport() {
  openModal(`
    <h3>导入数据</h3>
    <div class="field"><label>粘贴之前导出的 JSON（会覆盖当前数据）</label>
      <textarea id="im_ta" rows="8" placeholder='{"houses":[...]}'></textarea>
    </div>
    <div class="modal-actions"><button class="btn-primary" id="im_go">导入</button><button class="btn-ghost" onclick="closeModal()">取消</button></div>`);
  document.getElementById('im_go').onclick = () => {
    try {
      const s = normalizeState(JSON.parse(document.getElementById('im_ta').value));
      if (!s) throw new Error('bad');
      state = s; save(); closeModal(); render();
    } catch (e) { alert('格式不对，导入失败'); }
  };
}

/* ---------- 演示模式 (?demo=1) ---------- */
function seedDemo() {
  const h1 = {
    id: 'h_demo1', name: '海棠湾·候鸟小屋', address: '三亚海棠区某小区 3-2-801',
    scene: 'bird', freq: 'm2', itemIds: SCENE_ITEMS.bird.slice(),
    keyNote: '物业代开（提前1天预约）', createdAt: addDays(todayKey(), -90),
  };
  const h2 = {
    id: 'h_demo2', name: '御景华庭·城东', address: '成都锦江区某小区 6-1-2202',
    scene: 'away', freq: 'm1', itemIds: SCENE_ITEMS.away.slice(),
    keyNote: '智能锁临时密码', createdAt: addDays(todayKey(), -45),
  };
  state.houses.push(h1, h2);

  const mk = (hid, off, status, extra) => ({
    id: 'v_d' + off + hid, houseId: hid,
    date: addDays(todayKey(), -off), time: `${addDays(todayKey(), -off)} 14:${String(10 + off % 40).padStart(2, '0')}`,
    status, geoNote: '已到小区门口 · 物业陪同', entries: [], photos: [],
    ...extra,
  });
  const std = hid => SCENE_ITEMS[hid === 'h_demo1' ? 'bird' : 'away'].map(id => ({ itemId: id, result: 'ok', note: '' }));
  state.visits.push(
    mk('h_demo1', 75, 'done', { entries: std('h_demo1') }),
    mk('h_demo1', 60, 'done', { entries: std('h_demo1') }),
    mk('h_demo1', 45, 'abnormal', {
      entries: std('h_demo1').map(e => e.itemId === 'mold' ? { ...e, result: 'bad', note: '主卫墙角霉斑约巴掌大，正在扩散' } : e),
    }),
    mk('h_demo1', 30, 'done', { entries: std('h_demo1') }),
    mk('h_demo1', 15, 'done', { entries: std('h_demo1') }),   /* 周期15天 → 今天到期 */
    mk('h_demo2', 40, 'done', { entries: std('h_demo2') }),   /* 周期30天 → 超期10天 */
  );
  save();
}

/* ---------- 启动 ---------- */
if (typeof document !== 'undefined') {
  if (typeof location !== 'undefined' && /[?&]demo=1/.test(location.search) && !state.houses.length) seedDemo();
  document.querySelectorAll('#roleSeg button').forEach(b => b.onclick = () => {
    state.role = b.dataset.v; save(); render();
  });
  document.getElementById('btnExport').onclick = openExport;
  document.getElementById('btnImport').onclick = openImport;
  document.getElementById('btnCloseShare').onclick = () => document.getElementById('shareMask').classList.remove('show');
  document.getElementById('mask').addEventListener('click', e => { if (e.target.id === 'mask') closeModal(); });
  render();
  /* PWA: 仅安全上下文可注册 (https / localhost), 局域网 http 打开时静默跳过 */
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
/* Node 环境导出纯逻辑供测试 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    addDays, daysBetween, todayKey, nowStamp,
    dueStatus, nextDueDate, commitVisit, abnormalEntries, adviceFor,
    houseItems, visitsOf, lastVisitOf, houseAbnormalCount,
    normalizeState,
    SCENE_ITEMS, ITEM_LIB, FREQ_META, state,
  };
}
