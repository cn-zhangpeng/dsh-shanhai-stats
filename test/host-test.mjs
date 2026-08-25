// dsh-shanhai-stats host 半端到端验证：模拟 DSH 注入环境，跑通 baseline 扫描 + 事件折叠 + snapshot
import { name, inject, apply } from '../lib/index.js'

let failures = 0
function check(label, cond, detail) {
  if (cond) {
    console.log('  ✅ ' + label)
  } else {
    failures += 1
    console.log('  ❌ ' + label + (detail !== undefined ? ' — ' + detail : ''))
  }
}

// ---------- 模拟事件 ----------
let seq = 0
function mkMsg(usage, provider, model, dayOffset) {
  seq += 1
  return {
    seq,
    time: Date.now() - (dayOffset || 0) * 86400000,
    type: 'assistant/message',
    data: {
      turn: 1,
      step: 1,
      message: { id: 'm' + seq, role: 'assistant', source: { kind: 'model', provider, model } },
      usage,
    },
  }
}
function mkTurn(dayOffset) {
  seq += 1
  return { seq, time: Date.now() - (dayOffset || 0) * 86400000, type: 'turn/end', data: { turn: 1, reason: 'stop' } }
}

const eventsA = [
  mkTurn(0),
  mkMsg({ inputTokens: 100, outputTokens: 50, cacheReadTokens: 900, cacheWriteTokens: 10, reasoningTokens: 20 }, 'deepseek', 'deepseek-chat', 0),
  mkMsg({ inputTokens: 200, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 200, reasoningTokens: 0 }, 'deepseek', 'deepseek-reasoner', 1),
  mkMsg({ inputTokens: 300, outputTokens: 90, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 40 }, 'openai', 'gpt-4o', 2),
]
const eventsB = [
  mkTurn(0),
  mkMsg({ inputTokens: 50, outputTokens: 30, cacheReadTokens: 450, cacheWriteTokens: 5, reasoningTokens: 0 }, 'deepseek', 'deepseek-chat', 0),
]
const oldEvents = [
  mkTurn(400),
  mkMsg({ inputTokens: 999, outputTokens: 999, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, 'dead', 'old-model', 400),
]

// ---------- 模拟 ctx ----------
const registeredRoutes = []
const eventHandlers = []
const reads = new Map()
reads.set('sA', { events: eventsA.concat(oldEvents) })
reads.set('sB', { events: eventsB })

const ctx = {
  sessionQuery: {
    listSessions: async () => [
      { header: { id: 'sA', cwd: 'C:\\work\\proj-a' } },
      { header: { id: 'sB', cwd: 'C:\\work\\proj-b' } },
      { header: { id: 'sOrphan', cwd: '' } }, // 无工作区 → 跳过
    ],
    readSession: async (sid) => (reads.get(sid) !== undefined ? reads.get(sid) : { events: [] }),
  },
  workspaceRegistry: {
    list: () => [
      { id: 'wA', title: '项目A', path: 'C:\\work\\proj-a', sessionIds: ['sA'] },
      { id: 'wB', title: '项目B', path: 'C:\\work\\proj-b', sessionIds: ['sB'] },
    ],
  },
  timeout: async () => {},
  on: (evt, handler) => { if (evt === 'session/event') eventHandlers.push(handler) },
  effect: (fn) => { fn(); return () => {} },
  get: (svc) => {
    if (svc === 'webServer') {
      return {
        register: (route) => { registeredRoutes.push(route) },
      }
    }
    return undefined
  },
}

// ---------- 运行 ----------
console.log('导出检查:')
check('name = dsh-shanhai-stats', name === 'dsh-shanhai-stats', name)
check('inject 含 sessionQuery/workspaceRegistry/timer', ['sessionQuery', 'workspaceRegistry', 'timer'].every((x) => inject.includes(x)))
check('apply 是函数', typeof apply === 'function')
check('默认导出一致', typeof (await import('../lib/index.js')).default === 'object')

console.log('apply(ctx):')
const dispose = apply(ctx)
await new Promise((r) => setTimeout(r, 50)) // 等 baseline 完成（enqueue + timeout(0) 链）

console.log('路由注册:')
check('注册了 /api/shanhai-stats', registeredRoutes.some((r) => r.path === '/api/shanhai-stats' && r.kind === 'exact'))
check('路由 handler 是函数', registeredRoutes.every((r) => typeof r.handler === 'function'))

// ---------- 取快照 ----------
function mockRes() {
  return {
    statusCode: 0,
    setHeader() {},
    end(body) { this.body = body },
    body: undefined,
  }
}
function callRoute() {
  const res = mockRes()
  route.handler({}, res)
  return JSON.parse(res.body)
}
const route = registeredRoutes.find((r) => r.path === '/api/shanhai-stats')
const data = callRoute()

console.log('snapshot 结构:')
check('scan.done', data.scan.done === true)
check('workspaces 数量 = 2', data.workspaces.length === 2)
check('totals.turns = 3', data.totals.turns === 3, 'got ' + data.totals.turns)
const ti = data.totals
check('totals.input = 1649', ti.input === 1649, 'got ' + ti.input) // 650 + 窗口外 999（全量包含窗口外，符合设计）
check('totals.msgs = 5（5 条带 model 的消息，含窗口外）', ti.msgs === 5, 'got ' + ti.msgs)
check('totals.cacheRead = 1350', ti.cacheRead === 1350, 'got ' + ti.cacheRead)
check('totals.cacheWrite = 215', ti.cacheWrite === 215, 'got ' + ti.cacheWrite)
check('totals.reasoning = 60', ti.reasoning === 60, 'got ' + ti.reasoning)
check('totals.sessions = 2', ti.sessions === 2, 'got ' + ti.sessions)
check('perWorkspace 数量 = 2', data.perWorkspace.length === 2)

console.log('perModel 聚合:')
check('perModel 数量 = 4（含窗口外 old-model，全量永不清零）', data.perModel.length === 4, 'got ' + data.perModel.length)
const dc = data.perModel.find((m) => m.provider === 'deepseek' && m.model === 'deepseek-chat')
check('deepseek-chat 存在', dc !== undefined)
if (dc) {
  check('deepseek-chat input = 150', dc.input === 150, 'got ' + dc.input) // 100+50
  check('deepseek-chat cacheRead = 1350', dc.cacheRead === 1350, 'got ' + dc.cacheRead)
  check('deepseek-chat msgs = 2', dc.msgs === 2, 'got ' + dc.msgs)
}
const dr = data.perModel.find((m) => m.provider === 'deepseek' && m.model === 'deepseek-reasoner')
check('deepseek-reasoner 存在', dr !== undefined)
if (dr) {
  check('deepseek-reasoner 输出 = 80', dr.output === 80, 'got ' + dr.output)
  check('deepseek-reasoner 推理 = 0', dr.reasoning === 0, 'got ' + dr.reasoning) // usage 里 reasoning=0 且 output 不自动加
}
const gpt = data.perModel.find((m) => m.provider === 'openai' && m.model === 'gpt-4o')
check('gpt-4o 存在', gpt !== undefined)
if (gpt) check('gpt-4o input = 300', gpt.input === 300, 'got ' + gpt.input)

console.log('按天窗口裁剪:')
check('byDay 不含 400 天前', data.byDay.every((d) => d.date >= data.byDay[0].date))
check('byDay 数量 ≥ 3 且不含 old 事件', !data.byDay.some((d) => d.tokens.input === 999))
const totalOfDays = data.byDay.reduce((s, d) => s + d.tokens.input, 0)
check('byDay 输入合计 = 650（不含窗口外）', totalOfDays === 650, 'got ' + totalOfDays)
const day0 = data.byDay.find((d) => d.date === data.byDay[data.byDay.length - 1].date)
if (day0) check('当天 day.msgs = 2（sA+sB 各 1 条 deepseek-chat）', day0.msgs === 2, 'got ' + day0.msgs)

console.log('live 事件折叠:')
const liveSession = { id: 'sA', header: { cwd: 'C:\\work\\proj-a' } }
const liveEvent = mkMsg({ inputTokens: 7, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }, 'deepseek', 'deepseek-chat', 0)
await eventHandlers[0](liveSession, liveEvent)
await new Promise((r) => setTimeout(r, 20))
const data2 = callRoute()
check('live 事件后 totals.input = 1656（1649+7）', data2.totals.input === 1656, 'got ' + data2.totals.input)
check('live 事件后 deepseek-chat msgs = 3', data2.perModel.find((m) => m.model === 'deepseek-chat').msgs === 3)
check('live 事件后 totals.msgs = 6（5+1）', data2.totals.msgs === 6, 'got ' + data2.totals.msgs)
const day0p = data2.byDay.find((d) => d.date === data2.byDay[data2.byDay.length - 1].date)
const deepseekWs = day0p && day0p.perWorkspace && day0p.perWorkspace.find((w) => w.msgs && w.msgs > 0)
if (day0p && deepseekWs) check('当天 byDay.perWorkspace[*].msgs 已记录（热力图 tooltip 用，sA=1+live=1=2）', deepseekWs.msgs === 2, 'got ' + deepseekWs.msgs)

if (typeof dispose === 'function') dispose()
console.log(failures === 0 ? '\n🎉 全部通过' : '\n💥 ' + failures + ' 项失败')
process.exit(failures === 0 ? 0 : 1)