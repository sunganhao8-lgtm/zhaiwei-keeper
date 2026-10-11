/* 核心逻辑测试 — node test-logic.js */
'use strict';
let store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: k => { delete store[k]; },
};
global.confirm = () => true;
const m = require('./app.js');

let pass = 0, fail = 0;
function T(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name}`); }
}

const tk = m.todayKey();

/* 日期工具 */
console.log('[1] 日期工具');
T('addDays 跨月', m.daysBetween('2026-01-31', m.addDays('2026-01-31', 1)) === 1);
T('addDays 跨年', m.addDays('2026-12-31', 1) === '2027-01-01');
T('nowStamp 格式', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(m.nowStamp()));

/* 巡检周期：下次 = 最近巡检 + 周期；从未巡检 = 建档日 + 周期 */
console.log('[2] 巡检周期');
m.state.houses.push({
  id: 'hA', name: '测试房A', scene: 'bird', freq: 'm2',
  itemIds: m.SCENE_ITEMS.bird.slice(), createdAt: m.addDays(tk, -90),
});
const hA = m.state.houses[0];
T('从未巡检→下次=建档日+15天', m.nextDueDate(hA, tk) === m.addDays(tk, -75));
T('90天前建档未巡→超期75天', m.dueStatus(hA, tk).state === 'overdue' && m.dueStatus(hA, tk).text === '已超期 75 天');
m.commitVisit('hA', {
  geoNote: '测试打卡',
  entries: m.SCENE_ITEMS.bird.map(id => ({ itemId: id, result: 'ok', note: '' })),
  dateKey: m.addDays(tk, -10), stamp: `${m.addDays(tk, -10)} 10:00`,
});
T('10天前巡过→下次还剩5天', m.dueStatus(hA, tk).text === '还剩 5 天');
T('到期日=巡检日+15天', m.nextDueDate(hA, tk) === m.addDays(tk, 5));

/* 报告状态机：任一异常 → 整单 abnormal */
console.log('[3] 报告状态机');
m.commitVisit('hA', {
  geoNote: '',
  entries: [{ itemId: 'leak', result: 'bad', note: '龙头渗水' }, { itemId: 'vent', result: 'ok', note: '' }],
  dateKey: tk,
});
const visits = m.visitsOf('hA');
const last = visits[visits.length - 1];
T('有异常→整单 abnormal', last.status === 'abnormal');
T('异常项数=1', m.abnormalEntries(last).length === 1);
T('房源异常次数=1', m.houseAbnormalCount('hA') === 1);
T('leak 有处置建议', m.adviceFor('leak').includes('总阀'));
T('未知项给默认建议', m.adviceFor('nope').includes('维修'));
T('全部正常→done', m.commitVisit('hA', {
  entries: [{ itemId: 'vent', result: 'ok', note: '' }], dateKey: tk,
}).status === 'done');

/* 场景检查项模板 */
console.log('[4] 场景模板');
T('候鸟含防台风+除湿机', m.SCENE_ITEMS.bird.includes('typhoon') && m.SCENE_ITEMS.bird.includes('humidify'));
T('海外含视频巡检', m.SCENE_ITEMS.overseas.includes('video'));
T('异地含空调试机', m.SCENE_ITEMS.away.includes('air'));
T('基础库 10 项', m.SCENE_ITEMS.away.length === 11 && m.SCENE_ITEMS.bird.length === 12);
hA.itemIds.push('ghost_id');
T('无效检查项被过滤', m.houseItems(hA).length === m.SCENE_ITEMS.bird.length);

/* 演示数据一致性 */
console.log('[5] 演示模式数据');
if (typeof location !== 'undefined' && false) { /* 浏览器分支不跑 */ }
{
  /* 手动按 seedDemo 的构造方式验证周期设定（不污染当前 state，先存档） */
  const saved = m.state.houses.slice();
  m.state.houses.length = 0; m.state.visits.length = 0;
  m.state.houses.push({ id: 'hB', name: 'B', scene: 'away', freq: 'm1', itemIds: [], createdAt: m.addDays(tk, -45) });
  m.commitVisit('hB', { entries: [{ itemId: 'vent', result: 'ok', note: '' }], dateKey: m.addDays(tk, -40) });
  T('40天前巡过/月1次→超期10天', m.dueStatus(m.state.houses[0], tk).text === '已超期 10 天');
  m.state.houses.length = 0; m.state.visits.length = 0;
  saved.forEach(h => m.state.houses.push(h));
}

/* 数据兜底 normalizeState */
console.log('[6] normalizeState 数据兜底');
T('null→拒绝', m.normalizeState(null) === null);
T('缺visits数组→拒绝', m.normalizeState({ houses: [], visits: 'x' }) === null);
const bad = m.normalizeState({
  role: 'hacker',
  houses: [
    { id: 'h1', name: '超长房源名字超过二十个字会被截断的哦嘻嘻嘻嘻嘻嘻', scene: 'castle', freq: 'hourly', itemIds: ['ghost'], createdAt: 'nope' },
    { id: '', name: '无id被丢弃' },
  ],
  visits: [
    { id: 'v1', houseId: 'h1', date: 'bad', status: 'weird', entries: [{ itemId: 'ghost', result: 'bad' }, null, { itemId: 'leak' }], photos: [42, 'data:image/jpeg;base64,xx'] },
    { id: 'v2', houseId: 'h_deleted' },
  ],
});
T('非法role→owner', bad.role === 'owner');
T('无id房源被丢弃', bad.houses.length === 1);
T('非法场景→away', bad.houses[0].scene === 'away');
T('非法频率→m1', bad.houses[0].freq === 'm1');
T('无效检查项→场景默认模板', bad.houses[0].itemIds.length === m.SCENE_ITEMS.away.length);
T('非法建档日→今天', bad.houses[0].createdAt === tk);
T('指向已删房源的巡检被丢弃', bad.visits.length === 1);
T('非法日期→今天', bad.visits[0].date === tk);
T('非法状态→done', bad.visits[0].status === 'done');
T('无效检查项被过滤且result归一', bad.visits[0].entries.length === 1 && bad.visits[0].entries[0].result === 'ok');
T('非法照片被过滤', bad.visits[0].photos.length === 1);
T('名字截断到20字', bad.houses[0].name.length === 20);

console.log(`\n结果: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
