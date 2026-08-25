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
    wsId = pathIndex.get(cwd)
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

  // ---------- baseline scan over durable logs ----------
  async function runBaseline() {
    if (scan.started) return
    scan.started = true
    try {
      const workspaces = ctx.workspaceRegistry.list()
      for (const w of workspaces) {
        const id = w && w.id
        const path = w && typeof w.path === 'string' ? w.path : ''
        const title = w && typeof w.title === 'string' ? w.title : ''
        if (id === undefined) continue
        wsMeta.set(id, { id, title, path })
        if (path !== '') pathIndex.set(path, id)
        if (w && Array.isArray(w.sessionIds)) {
          for (const sid of w.sessionIds) memberOf.set(sid, id)
        }
      }
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
      const wsId = cwd === '' ? undefined : pathIndex.get(cwd)
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
    ctx.effect(() => webServer.register({
      kind: 'exact',
      path: '/api/shanhai-stats',
      handler: (req, res) => {
        if (!scan.started) void runBaseline()
        sendJson(res, 200, snapshot())
      },
    }))
  }

  // ---------- start the historical backfill immediately ----------
  void runBaseline()
}

export { name, inject, apply }
export default { name, inject, apply }