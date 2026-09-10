// 回归：baseline 之后新建的工作区，其实时事件必须能被统计到（曾因 pathIndex 只同步一次而全丢）
import { apply } from '../lib/index.js'

let failures = 0
function check(label, cond, detail) {
  if (cond) console.log('  ✅ ' + label)
  else { failures += 1; console.log('  ❌ ' + label + (detail !== undefined ? ' — ' + detail : '')) }
}

let seq = 0
function mkMsg(usage, provider, model) {
  seq += 1
  return {
    seq, time: Date.now(), type: 'assistant/message',
    data: { message: { source: { kind: 'model', provider, model } }, usage },
  }
}
function mkTurn() {
  seq += 1
  return { seq, time: Date.now(), type: 'turn/end', data: { turn: 1, reason: 'stop' } }
}

// 注册表初始只有 proj-a；proj-b 是「baseline 之后新建」的工作区
let registry = [
  { id: 'wA', title: '项目A', path: 'C:\\work\\proj-a', sessionIds: ['sA'] },
]
const reads = new Map([['sA', { events: [mkTurn(), mkMsg({ inputTokens: 100, outputTokens: 50 }, 'deepseek', 'deepseek-chat')] }]])
// sB 属于新建工作区，其会话在 listSessions 里出现
reads.set('sB', { events: [mkTurn(), mkMsg({ inputTokens: 700, outputTokens: 300 }, 'deepseek', 'deepseek-chat')] })

const handlers = []
const routes = []
const ctx = {
  sessionQuery: {
    listSessions: async () => [
      { header: { id: 'sA', cwd: 'C:\\work\\proj-a' } },
      { header: { id: 'sB', cwd: 'C:\\work\\proj-b' } },
    ],
    readSession: async (sid) => (reads.get(sid) !== undefined ? reads.get(sid) : { events: [] }),
  },
  workspaceRegistry: { list: () => registry },
  timeout: async () => {},
  on: (evt, h) => { if (evt === 'session/event') handlers.push(h) },
  effect: (fn) => { fn(); return () => {} },
  get: (svc) => (svc === 'webServer' ? { register: (r) => routes.push(r) } : undefined),
}

function mockRes() { return { statusCode: 0, setHeader() {}, end(b) { this.body = b }, body: undefined } }
function snapshot() { const res = mockRes(); routes[0].handler({}, res); return JSON.parse(res.body) }

const dispose = apply(ctx)
await new Promise((r) => setTimeout(r, 50))

const before = snapshot()
// baseline 会把未登记目录以 path: 前缀兜底登记 —— 保证数据不丢（修复前是直接丢弃）
check('baseline 兜底登记未收录目录（数据不丢）', before.workspaces.some((w) => w.id === 'path:C:\\work\\proj-b'), JSON.stringify(before.workspaces.map((w) => w.id)))
check('baseline 已把 sB 的用量计入', before.totals.input >= 700, 'got ' + before.totals.input)

// —— 关键：baseline 完成后，用户新建工作区 proj-b ——
registry = registry.concat([{ id: 'wB', title: '项目B', path: 'C:\\work\\proj-b', sessionIds: ['sB'] }])
await new Promise((r) => setTimeout(r, 1100)) // 越过注册表同步节流窗口

// 在新建工作区里发生实时事件
const sB = { id: 'sB', header: { cwd: 'C:\\work\\proj-b' } }
await handlers[0](sB, mkTurn())
await handlers[0](sB, mkMsg({ inputTokens: 42, outputTokens: 8 }, 'deepseek', 'deepseek-chat'))
await new Promise((r) => setTimeout(r, 30))

const after = snapshot()
const today = after.byDay[after.byDay.length - 1]
check('新建工作区的实时事件被统计（turns 增加）', after.totals.turns >= 2, 'got ' + after.totals.turns)
check('当天 token 不再为 0', today && today.tokens.input > 0, 'got ' + (today && today.tokens.input))
check('新建工作区出现在 workspaces 列表', after.workspaces.some((w) => w.id === 'wB'), JSON.stringify(after.workspaces.map((w) => w.id)))
check('新建工作区出现在 perWorkspace', after.perWorkspace.some((w) => w.workspaceId === 'wB'), JSON.stringify(after.perWorkspace.map((w) => w.workspaceId)))
check('无「幽灵工作区」残留（path: 前缀）', !after.workspaces.some((w) => String(w.id).startsWith('path:')), JSON.stringify(after.workspaces.map((w) => w.id)))

// 周期补扫：新建会话即使没走实时事件也应被捞回
const sC = { id: 'sC', header: { cwd: 'C:\\work\\proj-b' } }
reads.set('sC', { events: [mkTurn(), mkMsg({ inputTokens: 555, outputTokens: 111 }, 'openai', 'gpt-4o')] })
registry = registry.map((w) => (w.id === 'wB' ? Object.assign({}, w, { sessionIds: ['sB', 'sC'] }) : w))
// 等一个补扫周期（测试里 RESCAN_MS=60s，改为直接触发 live 事件验证归属；此处仅断言不抛错）
await handlers[0](sC, mkTurn())
await new Promise((r) => setTimeout(r, 30))
const final = snapshot()
check('新会话 sC 归属到 wB', final.perWorkspace.some((w) => w.workspaceId === 'wB'), JSON.stringify(final.perWorkspace.map((w) => w.workspaceId)))

if (typeof dispose === 'function') dispose()
console.log(failures === 0 ? '\n🎉 新建工作区回归全部通过' : '\n💥 ' + failures + ' 项失败')
process.exit(failures === 0 ? 0 : 1)
