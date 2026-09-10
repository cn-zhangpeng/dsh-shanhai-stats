// dsh-shanhai-stats 插件 Host 半
// CC Switch 风格用量统计：事件折叠聚合（全量 / 按工作区 / 按模型·提供商 / 53 周按天），
// 通过 webServer 路由 /api/shanhai-stats 向客户端提供数据。
// 折叠与增量续扫逻辑参考 dsh-usage-stats；perModel 维度为其扩展。
const name = 'dsh-shanhai-stats'
const inject = ['sessionQuery', 'workspaceRegistry', 'timer']

function sendJson(res, code, value) {
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(value))
}

function apply(ctx) {
  const webServer = ctx.get('webServer')

  // ---------- owned aggregation state ----------
  const wsMeta = new Map()
  const pathIndex = new Map()
  const memberOf = new Map()
  const byDay = new Map()
  const perWorkspace = new Map()
  const perModel = new Map()
  const totals = { turns: 0, msgs: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  const sessionCount = new Set()
  const sessionSeq = new Map()
  const chains = new Map()
  const scan = { started: false, done: false, scanned: 0, total: 0, failed: 0 }

  const DAY_MS = 86400000
  const WEEKS = 53
  const RESCAN_MS = 60000 // 周期补扫：新建工作区/会话也能被纳入，不必重启
  const WS_SYNC_THROTTLE_MS = 1000

  const cleanups = []
  let lastWsSyncAt = 0
  let rescanTimer = null

  function dayKey(ms) {
    const d = new Date(ms)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  function cutoffKey() {
    return dayKey(Date.now() - WEEKS * 7 * DAY_MS)
  }
  function num(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0
  }
  function ensureDay(date) {
    let day = byDay.get(date)
    if (day === undefined) {
      day = { turns: 0, msgs: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, perWs: new Map(), byWs: new Map(), byModel: new Map() }
      byDay.set(date, day)
    }
    return day
  }
  function ensureDayModel(day, model) {
    const key = model.provider + '\u0000' + model.model
    let rec = day.byModel.get(key)
    if (rec === undefined) {
      rec = { provider: model.provider, model: model.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, msgs: 0 }
      day.byModel.set(key, rec)
    }
    return rec
  }
  function ensureWs(wsId) {
    let ws = perWorkspace.get(wsId)
    if (ws === undefined) {
      ws = { turns: 0, msgs: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      perWorkspace.set(wsId, ws)
    }
    return ws
  }
  function ensureDayWs(day, wsId) {
    let w = day.byWs.get(wsId)
    if (w === undefined) {
      w = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      day.byWs.set(wsId, w)
    }
    return w
  }
  // perModel: key = 'provider \u0000 model' → { provider, model, ...5 桶, msgs }
  function modelKeyOf(data) {
    const src = data && data.message && data.message.source
    if (src !== null && src !== undefined && typeof src === 'object') {
      const provider = typeof src.provider === 'string' ? src.provider : ''
      const model = typeof src.model === 'string' ? src.model : ''
      if (provider !== '' || model !== '') {
        return { provider: provider || 'unknown', model: model || 'unknown' }
      }
    }
    return null
  }
  function ensureModel(m) {
    const key = m.provider + '\u0000' + m.model
    let rec = perModel.get(key)
    if (rec === undefined) {
      rec = { provider: m.provider, model: m.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, msgs: 0 }
      perModel.set(key, rec)
    }
    return rec
  }
  function addUsage(wsId, time, usage, model) {
    const input = num(usage && usage.inputTokens)
    const output = num(usage && usage.outputTokens)
    const cacheRead = num(usage && usage.cacheReadTokens)
    const cacheWrite = num(usage && usage.cacheWriteTokens)
    const reasoning = num(usage && usage.reasoningTokens)
    totals.input += input
    totals.output += output
    totals.cacheRead += cacheRead
    totals.cacheWrite += cacheWrite
    totals.reasoning += reasoning
    const ws = ensureWs(wsId)
    ws.input += input
    ws.output += output
    ws.cacheRead += cacheRead
    ws.cacheWrite += cacheWrite
    ws.reasoning += reasoning
    if (model !== null) {
      const m = ensureModel(model)
      m.input += input
      m.output += output
      m.cacheRead += cacheRead
      m.cacheWrite += cacheWrite
      m.reasoning += reasoning
      m.msgs += 1
      ws.msgs += 1
      totals.msgs += 1
    }
    const date = dayKey(time)
    if (date < cutoffKey()) return
    const day = ensureDay(date)
    day.tokens.input += input
    day.tokens.output += output
    day.tokens.cacheRead += cacheRead
    day.tokens.cacheWrite += cacheWrite
    day.tokens.reasoning += reasoning
    const dw = ensureDayWs(day, wsId)
    dw.input += input
    dw.output += output
    dw.cacheRead += cacheRead
    dw.cacheWrite += cacheWrite
    dw.reasoning += reasoning
    if (model !== null) {
      const dm = ensureDayModel(day, model)
      dm.input += input
      dm.output += output
      dm.cacheRead += cacheRead
      dm.cacheWrite += cacheWrite
      dm.reasoning += reasoning
      dm.msgs += 1
      day.msgs += 1
      let dpw = day.perWs.get(wsId)
      if (dpw === undefined) { dpw = { turns: 0, msgs: 0 }; day.perWs.set(wsId, dpw) }
      dpw.msgs += 1
    }
  }
  function addTurn(wsId, time) {
    const date = dayKey(time)
    ensureWs(wsId).turns += 1
    totals.turns += 1
    if (date < cutoffKey()) return
    const day = ensureDay(date)
    day.turns += 1
    let pw = day.perWs.get(wsId)
    if (pw === undefined) { pw = { turns: 0, msgs: 0 }; day.perWs.set(wsId, pw) }
    pw.turns += 1
  }
  function foldEvent(wsId, time, type, data) {
    if (type === 'turn/end') addTurn(wsId, time)
    else if (type === 'assistant/message' && data && data.usage) addUsage(wsId, time, data.usage, modelKeyOf(data))
  }
  function foldEvents(wsId, events, fromSeq) {
    for (const ev of events) {
      if (fromSeq !== undefined) {
        const s = typeof ev.seq === 'number' ? ev.seq : -1
        if (s <= fromSeq) continue
      }
      if (ev.type === 'turn/end' || ev.type === 'assistant/message') foldEvent(wsId, ev.time, ev.type, ev.data)
    }
  }
  function lastSeqOf(events) {
    let last = 0
    for (const ev of events) {
      const s = typeof ev.seq === 'number' ? ev.seq : -1
      if (s > last) last = s
    }
    return last
  }
  // ---------- 工作区注册表同步 ----------
  // 关键：注册表在插件激活后仍会新增工作区（用户新建/打开目录）。
  // 早期版本只在 baseline 同步一次，导致新建工作区的 cwd 永远查不到 wsId，
  // 其全部实时事件在 wsForLiveSession 里被丢弃 —— 表现为「当天统计不到数据」。
  function syncWorkspaces() {
    let list
    try {
      list = ctx.workspaceRegistry.list()
    } catch (err) {
      return
    }
    if (!Array.isArray(list)) return
    for (const w of list) {
      if (w === undefined || w === null) continue
      const path = typeof w.path === 'string' ? w.path : ''
      // w.id 可能缺失（存储层把 id 作为 key 而非字段），用 path 兜底
      const id = w.id !== undefined && w.id !== null ? w.id : (path === '' ? undefined : 'path:' + path)
      if (id === undefined) continue
      const title = typeof w.title === 'string' ? w.title : ''
      wsMeta.set(id, { id, title, path })
      if (path !== '' && pathIndex.get(path) !== id) pathIndex.set(path, id)
      if (Array.isArray(w.sessionIds)) {
        for (const sid of w.sessionIds) {
          if (!memberOf.has(sid)) memberOf.set(sid, id)
        }
      }
      if (path !== '') mergeFallbackWs(path, id)
    }
    lastWsSyncAt = Date.now()
  }
  function maybeSyncWorkspaces() {
    if (Date.now() - lastWsSyncAt < WS_SYNC_THROTTLE_MS) return
    syncWorkspaces()
  }
  // 注册表尚未收录该目录时，按 cwd 建临时工作区，保证数据不丢
  function fallbackWs(cwd) {
    const wsId = 'path:' + cwd
    if (!wsMeta.has(wsId)) {
      const seg = cwd.replace(/[\\/]+$/, '').split(/[\\/]/)
      wsMeta.set(wsId, { id: wsId, title: seg[seg.length - 1] || cwd, path: cwd })
      pathIndex.set(cwd, wsId)
    }
    return wsId
  }
  // 临时工作区后来被注册表收录 → 把已聚合的数据并入真实 id，避免出现「幽灵工作区」
  function mergeFallbackWs(path, realId) {
    const tempId = 'path:' + path
    if (tempId === realId) return
    if (!perWorkspace.has(tempId) && !wsMeta.has(tempId)) return
    const a = perWorkspace.get(tempId)
    if (a !== undefined) {
      const b = ensureWs(realId)
      b.turns += a.turns
      b.msgs += a.msgs
      b.input += a.input
      b.output += a.output
      b.cacheRead += a.cacheRead
      b.cacheWrite += a.cacheWrite
      b.reasoning += a.reasoning
      perWorkspace.delete(tempId)
    }
    for (const day of byDay.values()) {
      const pa = day.perWs.get(tempId)
      if (pa !== undefined) {
        let pb = day.perWs.get(realId)
        if (pb === undefined) { pb = { turns: 0, msgs: 0 }; day.perWs.set(realId, pb) }
        pb.turns += pa.turns
        pb.msgs += pa.msgs
        day.perWs.delete(tempId)
      }
      const wa = day.byWs.get(tempId)
      if (wa !== undefined) {
        const wb = ensureDayWs(day, realId)
        wb.input += wa.input
        wb.output += wa.output
        wb.cacheRead += wa.cacheRead
        wb.cacheWrite += wa.cacheWrite
        wb.reasoning += wa.reasoning
        day.byWs.delete(tempId)
      }
    }
    wsMeta.delete(tempId)
  }
  function isFallbackId(id) {
    return typeof id === 'string' && id.indexOf('path:') === 0
  }
  function resolveWs(cwd) {
    if (cwd === '') return undefined
    let wsId = pathIndex.get(cwd)
    // 命中「未登记目录」时同样要重试注册表：它可能刚被收录，需要归并到真实 id
    if (wsId === undefined || isFallbackId(wsId)) {
      maybeSyncWorkspaces()
      wsId = pathIndex.get(cwd)
    }
    return wsId !== undefined ? wsId : fallbackWs(cwd)
  }
  function enqueue(sid, task) {
    const prev = chains.get(sid) || Promise.resolve()
    const next = prev.then(() => task(), () => task())
    chains.set(sid, next)
    return next
  }
  function wsForLiveSession(session, sid) {
    let wsId = memberOf.get(sid)
    if (wsId !== undefined) return wsId
    const header = session && session.header
    const cwd = header && typeof header.cwd === 'string' ? header.cwd : ''
    if (cwd === '') return undefined
    wsId = resolveWs(cwd)
    if (wsId !== undefined) memberOf.set(sid, wsId)
    return wsId
  }
  async function processLiveEvent(sid, wsId, event) {
    const seq = typeof event.seq === 'number' ? event.seq : -1
    const last = sessionSeq.get(sid)
    if (last === undefined) {
      try {
        const snap = await ctx.sessionQuery.readSession(sid)
        if (snap && Array.isArray(snap.events)) {
          foldEvents(wsId, snap.events)
          sessionSeq.set(sid, lastSeqOf(snap.events))
          sessionCount.add(sid)
        }
      } catch (err) { /* retry on the next event */ }
      return
    }
    if (seq <= last) return
    if (seq > last + 1) {
      try {
        const snap = await ctx.sessionQuery.readSession(sid)
        if (snap && Array.isArray(snap.events)) {
          foldEvents(wsId, snap.events, last)
          sessionSeq.set(sid, lastSeqOf(snap.events))
        }
      } catch (err) { /* keep last; retry later */ }
      return
    }
    foldEvent(wsId, event.time, event.type, event.data)
    sessionSeq.set(sid, seq)
    sessionCount.add(sid)
  }

  // ---------- 增量补扫：把 baseline 之后新建的会话纳入统计 ----------
  async function rescanSessions() {
    try {
      syncWorkspaces()
    } catch (err) { /* keep going */ }
    let records = []
    try {
      records = await ctx.sessionQuery.listSessions()
    } catch (err) {
      return
    }
    if (!Array.isArray(records)) return
    for (const record of records) {
      if (record === undefined || record === null || record.header === undefined) continue
      const sid = record.header.id
      if (sid === undefined || sessionSeq.has(sid)) continue
      const cwd = typeof record.header.cwd === 'string' ? record.header.cwd : ''
      const wsId = resolveWs(cwd)
      if (wsId === undefined) continue
      await enqueue(sid, async () => {
        try {
          if (sessionSeq.has(sid)) return
          const snap = await ctx.sessionQuery.readSession(sid)
          if (snap && Array.isArray(snap.events)) {
            foldEvents(wsId, snap.events)
            sessionSeq.set(sid, lastSeqOf(snap.events))
            sessionCount.add(sid)
          }
        } catch (err) {
          sessionSeq.set(sid, -1)
        }
      })
      await ctx.timeout(0)
    }
  }
  function startRescan() {
    if (rescanTimer !== null) return
    const timer = typeof ctx.get === 'function' ? ctx.get('timer') : undefined
    const run = () => { void rescanSessions() }
    if (timer !== undefined && typeof timer.setInterval === 'function') {
      rescanTimer = timer.setInterval(run, RESCAN_MS)
      return
    }
    rescanTimer = setInterval(run, RESCAN_MS)
  }
  function stopRescan() {
    if (rescanTimer === null) return
    const timer = typeof ctx.get === 'function' ? ctx.get('timer') : undefined
    if (timer !== undefined && typeof timer.clearInterval === 'function') timer.clearInterval(rescanTimer)
    else clearInterval(rescanTimer)
    rescanTimer = null
  }

  // ---------- baseline scan over durable logs ----------
  async function runBaseline() {
    if (scan.started) return
    scan.started = true
    try {
      syncWorkspaces()
    } catch (err) {
      console.error('[shanhai-stats] workspace list failed:', err)
    }
    let records = []
    try {
      records = await ctx.sessionQuery.listSessions()
    } catch (err) {
      console.error('[shanhai-stats] session list failed:', err)
    }
    scan.total = Array.isArray(records) ? records.length : 0
    for (const record of records) {
      if (record === undefined || record === null || record.header === undefined) {
        scan.scanned += 1
        continue
      }
      const sid = record.header.id
      const cwd = typeof record.header.cwd === 'string' ? record.header.cwd : ''
      const wsId = resolveWs(cwd)
      if (sid === undefined || wsId === undefined) {
        scan.scanned += 1
        continue
      }
      await enqueue(sid, async () => {
        try {
          if (sessionSeq.has(sid)) return
          const snap = await ctx.sessionQuery.readSession(sid)
          if (snap && Array.isArray(snap.events)) {
            foldEvents(wsId, snap.events)
            sessionSeq.set(sid, lastSeqOf(snap.events))
            sessionCount.add(sid)
          }
        } catch (err) {
          sessionSeq.set(sid, -1)
          scan.failed += 1
        } finally {
          scan.scanned += 1
        }
      })
      await ctx.timeout(0)
    }
    scan.done = true
    startRescan()
  }

  // ---------- live feed ----------
  ctx.on('session/event', (session, event) => {
    if (event === undefined || event === null) return
    const type = event.type
    if (type !== 'turn/end' && type !== 'assistant/message') return
    const sid = session && session.id
    if (typeof sid !== 'string') return
    const wsId = wsForLiveSession(session, sid)
    if (wsId === undefined) return
    enqueue(sid, () => processLiveEvent(sid, wsId, event))
  })

  // ---------- snapshot for the client ----------
  function snapshot() {
    const cutoff = cutoffKey()
    const byDayArr = []
    for (const pair of byDay) {
      const date = pair[0]
      const day = pair[1]
      if (date < cutoff) continue
      byDayArr.push({
        date,
        turns: day.turns,
        msgs: day.msgs,
        tokens: { input: day.tokens.input, output: day.tokens.output, cacheRead: day.tokens.cacheRead, cacheWrite: day.tokens.cacheWrite, reasoning: day.tokens.reasoning },
        perWorkspace: Array.from(day.perWs, (p) => ({ workspaceId: p[0], turns: p[1].turns, msgs: p[1].msgs })),
        byWorkspace: Array.from(day.byWs, (p) => ({ workspaceId: p[0], input: p[1].input, output: p[1].output, cacheRead: p[1].cacheRead, cacheWrite: p[1].cacheWrite, reasoning: p[1].reasoning })),
        byModel: Array.from(day.byModel, (p) => ({ provider: p[1].provider, model: p[1].model, msgs: p[1].msgs, input: p[1].input, output: p[1].output, cacheRead: p[1].cacheRead, cacheWrite: p[1].cacheWrite, reasoning: p[1].reasoning })),
      })
    }
    byDayArr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    const perModelArr = Array.from(perModel.values(), (m) => ({
      provider: m.provider,
      model: m.model,
      msgs: m.msgs,
      input: m.input,
      output: m.output,
      cacheRead: m.cacheRead,
      cacheWrite: m.cacheWrite,
      reasoning: m.reasoning,
    }))
    perModelArr.sort((a, b) => {
      const ta = a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning
      const tb = b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
      if (tb !== ta) return tb - ta
      return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0
    })
    return {
      scan: { started: scan.started, done: scan.done, scanned: scan.scanned, total: scan.total, failed: scan.failed },
      generatedAt: Date.now(),
      workspaces: Array.from(wsMeta.values(), (w) => ({ id: w.id, title: w.title, path: w.path })),
      totals: { turns: totals.turns, msgs: totals.msgs, sessions: sessionCount.size, input: totals.input, output: totals.output, cacheRead: totals.cacheRead, cacheWrite: totals.cacheWrite, reasoning: totals.reasoning },
      perWorkspace: Array.from(perWorkspace, (p) => ({ workspaceId: p[0], turns: p[1].turns, msgs: p[1].msgs, input: p[1].input, output: p[1].output, cacheRead: p[1].cacheRead, cacheWrite: p[1].cacheWrite, reasoning: p[1].reasoning })),
      perModel: perModelArr,
      byDay: byDayArr,
    }
  }

  // ---------- HTTP data route for the client half ----------
  if (webServer !== undefined) {
    ctx.effect(() => {
      const dispose = webServer.register({
        kind: 'exact',
        path: '/api/shanhai-stats',
        handler: (req, res) => {
          if (!scan.started) void runBaseline()
          sendJson(res, 200, snapshot())
        },
      })
      if (typeof dispose === 'function') cleanups.push(dispose)
    })
  }

  // ---------- start the historical backfill immediately ----------
  void runBaseline()

  return () => {
    stopRescan()
    for (const fn of cleanups) {
      try { fn() } catch (err) { /* ignore */ }
    }
  }
}

export { name, inject, apply }
export default { name, inject, apply }