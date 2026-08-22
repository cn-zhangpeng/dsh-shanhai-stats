// dsh-shanhai-stats 插件 Client 半（浏览器 bundle）
// CC Switch 风格用量统计页：总量徽章 · 每日走势柱状图 · GitHub 风格热力图 · 按模型/提供商分组明细表
// 客户端模块工厂格式：window.__ModuleLoader__.load({ id, factory })
window.__ModuleLoader__.load({
  id: "dsh-shanhai-stats",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    const React = require("react");
    // 内联柱状图 SVG 图标：单色、用 currentColor 自动适配浅色/深色主题，零外部依赖
    function StatsIcon(props) {
      return React.createElement('svg', Object.assign({
        viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round', xmlns: 'http://www.w3.org/2000/svg',
      }, props || {}),
        React.createElement('line', { x1: 4, y1: 20, x2: 20, y2: 20 }),
        React.createElement('rect', { x: 6, y: 12, width: 3, height: 8 }),
        React.createElement('rect', { x: 11, y: 7, width: 3, height: 13 }),
        React.createElement('rect', { x: 16, y: 4, width: 3, height: 16 }),
      )
    }

    // ---------- helpers ----------
    function pad2(n) {
      return String(n).padStart(2, '0')
    }
    function fmtDate(d) {
      return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    }
    function trim1(v) {
      return String(Math.round(v * 10) / 10)
    }
    function trim2(v) {
      return String(Math.round(v * 100) / 100)
    }
    function fmtCompact(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
      if (n >= 100000000) return trim1(n / 100000000) + '亿'
      if (n >= 10000) return trim1(n / 10000) + '万'
      return n.toLocaleString('zh-CN')
    }
    function fmtCount(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
      return Math.round(n).toLocaleString('zh-CN')
    }
    function fmtWan(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '0'
      if (n >= 100000000) return trim2(n / 100000000) + '亿'
      if (n >= 10000) return trim2(n / 10000) + '万'
      return n.toLocaleString('zh-CN')
    }
    function rateOf(input, cacheRead) {
      const denom = input + cacheRead
      if (denom <= 0) return 0
      return (cacheRead / denom) * 100
    }
    function humanDate(date) {
      const parts = date.split('-')
      const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
      const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
      return parts[0] + '年' + Number(parts[1]) + '月' + Number(parts[2]) + '日 ' + week
    }
    function levelOf(count) {
      if (count >= 200) return 4
      if (count >= 100) return 3
      if (count >= 20) return 2
      if (count >= 1) return 1
      return 0
    }
    const CC_GREEN = '#2ea043'
    const LEVEL_PCT = [20, 45, 70, 96]
    function cellBg(level) {
      if (level <= 0) return 'var(--dsw-alias-bg-layer-2)'
      return 'color-mix(in srgb, ' + CC_GREEN + ' ' + LEVEL_PCT[level - 1] + '%, var(--dsw-alias-bg-layer-2))'
    }
    function wsColor(i) {
      return 'hsl(' + ((i * 137) % 360) + ', 70%, 55%)'
    }
    function providerColor(name) {
      let h = 0
      for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360
      return 'hsl(' + h + ', 70%, 55%)'
    }
    // 每日走势柱状图的四段配色（输入/缓存读/缓存写/输出）
    const BAR_COLORS = {
      input: '#4c8dff',
      cacheRead: '#2ea043',
      cacheWrite: '#b088f9',
      output: '#ffa657',
    }
    const BAR_KEYS = ['input', 'cacheRead', 'cacheWrite', 'output']
    const BAR_LABELS = { input: '输入', cacheRead: '缓存命中', cacheWrite: '缓存创建', output: '输出' }

    // 时间范围聚合：按 [startKey, endKey] 闭区间从 byDay 重算（含 perModel）
    // range: { kind:'today'|'1d'|'7d'|'30d'|'custom', start?:'YYYY-MM-DD', end?:'YYYY-MM-DD' }
    function rangeAgg(stats, range) {
      const empty = { totals: { turns: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, perWs: [], perModel: [] }
      if (stats === null || stats === undefined) return empty
      if (range.kind === 'all') {
        const totals = stats.totals || empty.totals
        return { totals, perWs: Array.isArray(stats.perWorkspace) ? stats.perWorkspace : [], perModel: Array.isArray(stats.perModel) ? stats.perModel : [] }
      }
      const days = Array.isArray(stats.byDay) ? stats.byDay : []
      let startKey
      let endKey
      const today = new Date()
      const fmt = (d) => fmtDate(d)
      const day = (n) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return fmt(d) }
      if (range.kind === 'today') { startKey = day(0); endKey = day(0) }
      else if (range.kind === '1d') { startKey = day(-1); endKey = day(0) }
      else if (range.kind === '7d') { startKey = day(-6); endKey = day(0) }
      else if (range.kind === '30d') { startKey = day(-29); endKey = day(0) }
      else if (range.kind === 'custom') {
        startKey = range.start && range.start !== '' ? range.start : day(-29)
        endKey = range.end && range.end !== '' ? range.end : day(0)
        if (startKey > endKey) { const t = startKey; startKey = endKey; endKey = t }
      } else return empty
      const t = { turns: 0, sessions: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      const perWs = new Map()
      const perModel = new Map()
      for (const day of days) {
        if (!day || !day.date || day.date < startKey || day.date > endKey) continue
        const tokens = day.tokens || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
        t.turns += day.turns || 0
        t.input += tokens.input || 0
        t.output += tokens.output || 0
        t.cacheRead += tokens.cacheRead || 0
        t.cacheWrite += tokens.cacheWrite || 0
        t.reasoning += tokens.reasoning || 0
        for (const w of (day.byWorkspace || [])) {
          let p = perWs.get(w.workspaceId)
          if (p === undefined) { p = { workspaceId: w.workspaceId, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }; perWs.set(w.workspaceId, p) }
          p.input += w.input || 0
          p.output += w.output || 0
          p.cacheRead += w.cacheRead || 0
          p.cacheWrite += w.cacheWrite || 0
          p.reasoning += w.reasoning || 0
        }
        for (const w of (day.perWorkspace || [])) {
          let p = perWs.get(w.workspaceId)
          if (p === undefined) { p = { workspaceId: w.workspaceId, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }; perWs.set(w.workspaceId, p) }
          p.turns += w.turns || 0
        }
        for (const m of (day.byModel || [])) {
          let pm = perModel.get(m.provider + '\u0000' + m.model)
          if (pm === undefined) { pm = { provider: m.provider, model: m.model, msgs: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }; perModel.set(m.provider + '\u0000' + m.model, pm) }
          pm.input += m.input
          pm.output += m.output
          pm.cacheRead += m.cacheRead
          pm.cacheWrite += m.cacheWrite
          pm.reasoning += m.reasoning
          pm.msgs += m.msgs
        }
      }
      const perModelArr = Array.from(perModel.values())
      perModelArr.sort((a, b) => {
        const ta = a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning
        const tb = b.input + b.output + b.cacheRead + b.cacheWrite + b.reasoning
        if (tb !== ta) return tb - ta
        return a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0
      })
      return { totals: t, perWs: Array.from(perWs.values()), perModel: perModelArr }
    }
    function streaks(dayMap) {
      const today = new Date()
      let streak = 0
      for (let i = 0; i < 371; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
        const day = dayMap.get(fmtDate(d))
        const active = day !== undefined && day.turns > 0
        if (active) streak += 1
        else if (i > 0) break
      }
      let best = 0
      let run = 0
      for (let i = 0; i < 371; i++) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
        const day = dayMap.get(fmtDate(d))
        if (day !== undefined && day.turns > 0) {
          run += 1
          if (run > best) best = run
        } else {
          run = 0
        }
      }
      return { streak, best }
    }
    // 数字滚动动画：首次从 0 滚动到目标值，之后直接同步目标值
    // 使用浏览器原生 setInterval（静态 bundle ctx 无 timer 服务，与参考 npm 版 usage-stats 一致）
    function useCountUp(target) {
      const [state, setState] = React.useState({ value: 0, done: false })
      React.useEffect(() => {
        if (typeof target !== 'number' || !Number.isFinite(target) || target <= 0) {
          setState({ value: 0, done: false })
          return undefined
        }
        if (state.done) {
          setState({ value: target, done: true })
          return undefined
        }
        const start = Date.now()
        const duration = 700
        const id = window.setInterval(() => {
          const t = Math.min(1, (Date.now() - start) / duration)
          const eased = 1 - Math.pow(1 - t, 3)
          if (t >= 1) {
            window.clearInterval(id)
            setState({ value: target, done: true })
          } else {
            setState({ value: Math.round(target * eased), done: false })
          }
        }, 32)
        return () => window.clearInterval(id)
      }, [target])
      return state.value
    }

    // ---------- styles ----------
    const CSS = `
.cc-page { display:flex; flex-direction:column; gap:14px; padding:2px 2px 28px; font-family:inherit; }
.cc-head { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.cc-title { margin:0; font-size:15px; font-weight:600; color:var(--dsw-alias-label-primary); }
.cc-actions { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.cc-range { display:inline-flex; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; overflow:hidden; }
.cc-range button { border:0; background:transparent; color:var(--dsw-alias-label-secondary); padding:4px 12px; font-size:12px; cursor:pointer; font-family:inherit; transition:background-color .15s ease, color .15s ease; }
.cc-range button + button { border-left:1px solid var(--dsw-alias-border-l2); }
.cc-range button.cc-on { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 20%, var(--dsw-alias-bg-layer-2)); color:var(--dsw-alias-label-primary); font-weight:600; }
.cc-refresh { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:8px; padding:4px 12px; font-size:12px; cursor:pointer; font-family:inherit; transition:border-color .15s ease, color .15s ease, transform .1s ease; }
.cc-refresh:hover { border-color:var(--dsw-alias-brand-primary); }
.cc-refresh:active, .cc-chip:active, .cc-range button:active { transform:scale(.96); }
.cc-progress { font-size:12px; color:var(--dsw-alias-label-secondary); display:flex; align-items:center; gap:10px; }
.cc-bar { flex:1; height:6px; border-radius:3px; background:var(--dsw-alias-bg-layer-2); overflow:hidden; max-width:340px; }
.cc-fill { height:100%; background:var(--dsw-alias-brand-primary); border-radius:3px; transition:width .3s ease; }
.cc-cards { display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:10px; }
.cc-card { background:var(--dsw-alias-bg-layer-1); border:1px solid rgba(128,128,128,.22); border:1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius:12px; padding:12px 14px; display:flex; flex-direction:column; gap:6px; min-height:86px; animation:cc-card-in .45s ease both; transition:transform .18s ease, border-color .18s ease, box-shadow .18s ease; }
.cc-card:hover { transform:translateY(-2px); border-color:color-mix(in srgb, currentColor 26%, transparent); box-shadow:0 6px 18px rgba(0,0,0,.10); }
.cc-card-label { font-size:12px; color:var(--dsw-alias-label-secondary); }
.cc-card-value { font-size:20px; font-weight:650; color:var(--dsw-alias-label-primary); line-height:1.2; }
.cc-card-value.cc-lg { font-size:24px; }
.cc-card-sub { font-size:11px; color:var(--dsw-alias-label-secondary); line-height:1.55; }
.cc-panel { background:var(--dsw-alias-bg-layer-1); border:1px solid rgba(128,128,128,.22); border:1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius:12px; padding:14px; }
.cc-panel-title { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); margin:0 0 10px; }
.cc-panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
.cc-legend { display:flex; align-items:center; gap:12px; font-size:11px; color:var(--dsw-alias-label-secondary); flex-wrap:wrap; }
.cc-legend-item { display:inline-flex; align-items:center; gap:5px; }
.cc-legend-dot { width:9px; height:9px; border-radius:3px; flex:none; }
.cc-chart-scroll { overflow-x:hidden; width:100%; }
.cc-line-wrap { position:relative; width:100%; height:180px; }
.cc-line { width:100%; height:100%; overflow:visible; }
.cc-axis-y { position:absolute; left:0; top:0; bottom:24px; width:36px; display:flex; flex-direction:column; justify-content:space-between; align-items:flex-end; padding-right:6px; font-size:10px; color:var(--dsw-alias-label-tertiary); pointer-events:none; }
.cc-axis-y span { line-height:1; }
.cc-line-area { position:absolute; left:36px; right:0; top:0; bottom:24px; }
.cc-line-xlabels { position:absolute; left:36px; right:0; bottom:0; height:20px; }
.cc-line polyline { transition:opacity .2s ease; }
.cc-line-input { stroke:#4c8dff; }
.cc-line-cacheRead { stroke:#2ea043; }
.cc-line-cacheWrite { stroke:#b088f9; }
.cc-line-output { stroke:#ffa657; }
.cc-line-dot { fill:var(--dsw-alias-bg-layer-1); stroke-width:2; cursor:pointer; transition:r .15s ease; }
.cc-line-dot:hover { r:5; }
.cc-line-dot.cc-line-active { r:5 !important; }
.cc-line-xlabel { position:absolute; transform:translateX(-50%); white-space:nowrap; }
.cc-line-xlabel.cc-hide { visibility:hidden; }
.cc-date { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:8px; padding:3px 8px; font-size:12px; font-family:inherit; color-scheme:dark; }
.cc-date-sep { font-size:12px; color:var(--dsw-alias-label-secondary); }
.cc-chart { display:flex; align-items:flex-end; gap:2px; min-width:560px; height:150px; padding-top:8px; }
.cc-day { display:flex; flex-direction:column; align-items:center; gap:4px; flex:1; min-width:0; }
.cc-bars { display:flex; align-items:flex-end; gap:1px; height:118px; width:100%; justify-content:center; }
.cc-barv { width:6px; min-height:1px; border-radius:2px 2px 0 0; background:var(--dsw-alias-bg-layer-2); transition:height .5s cubic-bezier(.22,.61,.36,1); }
.cc-day-label { font-size:9px; color:var(--dsw-alias-label-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:100%; }
.cc-hm-head { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap; margin-bottom:10px; }
.cc-chips { display:flex; flex-wrap:wrap; gap:6px; }
.cc-chip { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--dsw-alias-border-l2); background:transparent; color:var(--dsw-alias-label-primary); border-radius:999px; padding:2px 10px; font-size:11px; cursor:pointer; font-family:inherit; max-width:190px; transition:border-color .15s ease, background-color .15s ease, color .15s ease, transform .1s ease; }
.cc-chip .cc-chip-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cc-chip.cc-on { border-color:var(--dsw-alias-brand-primary); background:color-mix(in srgb, var(--dsw-alias-brand-primary) 14%, transparent); }
.cc-dot { width:8px; height:8px; border-radius:50%; flex:none; }
.cc-hm-scroll { overflow-x:auto; padding-bottom:2px; }
.cc-months { position:relative; height:16px; margin-left:30px; width:686px; font-size:10px; color:var(--dsw-alias-label-secondary); }
.cc-months span { position:absolute; top:0; }
.cc-hm-body { display:flex; gap:6px; min-width:720px; }
.cc-wdays { display:grid; grid-template-rows:repeat(7,10px); gap:3px; font-size:10px; color:var(--dsw-alias-label-secondary); text-align:right; width:24px; }
.cc-wdays span { line-height:10px; }
.cc-grid { display:grid; grid-auto-flow:column; grid-template-rows:repeat(7,10px); gap:3px; }
.cc-cell { width:10px; height:10px; border-radius:2px; background:var(--dsw-alias-bg-layer-2); animation:cc-cell-in .45s ease both; transition:transform .12s ease, box-shadow .12s ease; }
.cc-cell:hover { transform:scale(1.35); box-shadow:0 1px 6px rgba(0,0,0,.28); position:relative; z-index:2; }
.cc-tip { position:fixed; z-index:1200; background:var(--dsw-alias-bg-overlay); border:1px solid var(--dsw-alias-border-l2); border-radius:10px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,.18); pointer-events:auto; min-width:200px; max-width:290px; animation:cc-tip-in .16s ease both; }
.cc-tip-date { font-size:12px; font-weight:600; color:var(--dsw-alias-label-primary); margin-bottom:6px; }
.cc-tip-row { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-primary); padding:3px 6px; margin:0 -6px; border-radius:6px; cursor:pointer; transition:background-color .12s ease; }
.cc-tip-row:hover { background:color-mix(in srgb, var(--dsw-alias-brand-primary) 12%, transparent); }
.cc-tip-row .cc-n { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-secondary); }
.cc-tip-tokens { font-size:11px; color:var(--dsw-alias-label-secondary); margin-top:6px; border-top:1px solid var(--dsw-alias-border-l1); padding-top:6px; }
.cc-empty { color:var(--dsw-alias-label-secondary); font-size:12px; text-align:center; padding:26px 0; }
.cc-note { font-size:11px; color:var(--dsw-alias-label-secondary); line-height:1.6; }
.cc-grp { display:flex; flex-direction:column; }
.cc-grp-head { display:flex; align-items:center; gap:8px; padding:8px 10px; border-radius:8px; cursor:pointer; font-size:12px; color:var(--dsw-alias-label-primary); border:1px solid transparent; transition:background-color .15s ease, border-color .15s ease; }
.cc-grp-head:hover { background:var(--dsw-alias-bg-layer-2); }
.cc-grp-head.cc-open { border-color:var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.cc-grp-caret { width:10px; flex:none; text-align:center; color:var(--dsw-alias-label-secondary); transition:transform .15s ease; font-size:10px; }
.cc-grp-head.cc-open .cc-grp-caret { transform:rotate(90deg); }
.cc-grp-name { font-weight:600; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cc-grp-provider { font-size:11px; color:var(--dsw-alias-label-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
.cc-grp-num { margin-left:auto; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-secondary); font-size:11px; flex:none; }
.cc-grp-sub { font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-primary); font-size:12px; flex:none; margin-left:10px; }
.cc-grp-body { display:flex; flex-direction:column; gap:1px; padding-left:26px; }
.cc-hrow, .cc-row { display:grid; grid-template-columns:minmax(120px,1.6fr) .6fr .8fr .8fr .8fr .8fr .8fr .9fr 1fr; gap:8px; align-items:center; min-width:720px; padding:6px 10px; border-radius:8px; font-size:12px; }
.cc-hrow { color:var(--dsw-alias-label-secondary); font-size:11px; }
.cc-row { border:1px solid transparent; transition:background-color .15s ease; }
.cc-row:hover { background:var(--dsw-alias-bg-layer-2); }
.cc-num { text-align:right; font-variant-numeric:tabular-nums; color:var(--dsw-alias-label-primary); }
.cc-hrow .cc-num { color:var(--dsw-alias-label-secondary); }
.cc-model-name { color:var(--dsw-alias-label-primary); font-weight:550; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cc-barwrap { height:5px; border-radius:3px; background:var(--dsw-alias-bg-layer-2); overflow:hidden; margin-top:3px; }
.cc-barfill { height:100%; border-radius:3px; transform-origin:left center; animation:cc-bar-grow .7s cubic-bezier(.22,.61,.36,1) both; transition:width .5s cubic-bezier(.22,.61,.36,1); }
@keyframes cc-cell-in { from { opacity:0; transform:scale(.4); } to { opacity:1; transform:scale(1); } }
@keyframes cc-glow { 0% { box-shadow:0 0 0 0 rgba(46,160,67,.5); } 70% { box-shadow:0 0 0 5px rgba(46,160,67,0); } 100% { box-shadow:0 0 0 0 rgba(46,160,67,0); } }
@keyframes cc-card-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
@keyframes cc-bar-grow { from { transform:scaleX(0); } to { transform:scaleX(1); } }
@keyframes cc-tip-in { from { opacity:0; } to { opacity:1; } }
.cc-loader-wrap { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:48px 0; color:var(--dsw-alias-label-primary); }
.cc-orbit { position:relative; width:40px; height:40px; }
.cc-orbit::before { content:''; position:absolute; left:50%; top:50%; width:9px; height:9px; margin:-4.5px 0 0 -4.5px; border-radius:2px; background:currentColor; opacity:.55; animation:cc-orbit-core 1.4s ease-in-out infinite; }
.cc-orbit i { position:absolute; left:50%; top:50%; width:10px; height:10px; margin:-5px 0 0 -5px; border-radius:2.5px; background:currentColor; transform-origin:20px 0; animation:cc-orbit-spin 1.4s linear infinite; }
.cc-orbit i:nth-child(2) { animation-delay:-.7s; opacity:.55; transform-origin:20px 0; }
.cc-loader-text { font-size:14px; color:var(--dsw-alias-label-secondary); letter-spacing:.3px; }
@keyframes cc-orbit-spin { from { transform:rotate(0deg) translateX(15px) rotate(0deg); } to { transform:rotate(360deg) translateX(15px) rotate(-360deg); } }
@keyframes cc-orbit-core { 0%, 100% { opacity:.35; transform:scale(.8); } 50% { opacity:.8; transform:scale(1.25); } }
.cc-sidebar-action { display:flex; align-items:center; gap:10px; flex:0 0 100%; padding:8px 12px; border-radius:8px; cursor:pointer; font-size:13px; color:var(--dsw-alias-label-secondary); transition:background-color .15s ease, color .15s ease; }
.cc-sidebar-action:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.cc-sidebar-action-icon { width:18px; height:18px; color:var(--dsw-alias-label-secondary); flex:none; }
.cc-sidebar-action:hover .cc-sidebar-action-icon { color:var(--dsw-alias-label-primary); }
.cc-sidebar-action-main { display:flex; align-items:center; gap:10px; min-width:0; }
.cc-sidebar-action-label { font-size:13px; }
.cc-sidebar-action-value { font-size:13px; font-weight:600; color:var(--dsw-alias-label-primary); white-space:nowrap; margin-left:auto; }
.cc-modal-overlay { position:fixed; inset:0; z-index:1100; background:rgba(0,0,0,.45); backdrop-filter:blur(2px); display:flex; align-items:center; justify-content:center; padding:20px; animation:cc-tip-in .18s ease both; }
.cc-modal { background:var(--dsw-alias-bg-layer-1); border:1px solid var(--dsw-alias-border-l2); border-radius:14px; box-shadow:0 20px 60px rgba(0,0,0,.28); width:min(520px, calc(100vw - 40px)); max-height:calc(100vh - 40px); display:flex; flex-direction:column; overflow:hidden; }
.cc-modal-head { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 18px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); }
.cc-modal-title { margin:0; font-size:15px; font-weight:600; color:var(--dsw-alias-label-primary); }
.cc-modal-close { border:0; background:transparent; color:var(--dsw-alias-label-secondary); font-size:18px; line-height:1; cursor:pointer; padding:4px; border-radius:6px; transition:background-color .15s ease, color .15s ease; }
.cc-modal-close:hover { background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); }
.cc-modal-body { padding:18px; overflow-y:auto; display:flex; flex-direction:column; gap:14px; }
.cc-modal-foot { display:flex; justify-content:flex-end; gap:10px; padding:12px 18px 16px; border-top:1px solid var(--dsw-alias-border-l1); }
.cc-modal-btn { border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border-radius:8px; padding:6px 14px; font-size:12px; cursor:pointer; font-family:inherit; transition:border-color .15s ease, background-color .15s ease; }
.cc-modal-btn:hover { border-color:var(--dsw-alias-brand-primary); }
.cc-mini-card { background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1); border-radius:10px; padding:12px 14px; }
.cc-mini-card-label { font-size:11px; color:var(--dsw-alias-label-secondary); margin-bottom:4px; }
.cc-mini-card-value { font-size:22px; font-weight:700; color:var(--dsw-alias-label-primary); }
.cc-mini-card-sub { font-size:11px; color:var(--dsw-alias-label-secondary); margin-top:4px; }
.cc-mini-table { display:flex; flex-direction:column; gap:1px; }
.cc-mini-row { display:grid; grid-template-columns:1fr .8fr .8fr; gap:10px; align-items:center; padding:7px 10px; border-radius:6px; font-size:12px; transition:background-color .12s ease; }
.cc-mini-row:hover { background:var(--dsw-alias-bg-layer-2); }
.cc-mini-row.cc-head { color:var(--dsw-alias-label-secondary); font-size:11px; }
.cc-mini-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cc-mini-num { text-align:right; font-variant-numeric:tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  .cc-cell, .cc-card, .cc-barfill, .cc-tip, .cc-barv, .cc-orbit, .cc-orbit i, .cc-orbit::before { animation:none !important; transition:none !important; }
}
`
    const cssTagId = "dsh-shanhai-stats/styles.css"
    const ensureStyles = () => {
      if (typeof document === "undefined") return
      const sel = 'style[data-plugin-css="' + cssTagId + '"]'
      if (document.querySelector(sel) === null) {
        const tag = document.createElement("style")
        tag.dataset.plugin = "dsh-shanhai-stats"
        tag.dataset.pluginCss = cssTagId
        tag.textContent = CSS
        document.head.appendChild(tag)
      }
    }
    ensureStyles()

    // ---------- host data interface ----------
    const getStats = () => fetch('/api/shanhai-stats', { headers: { accept: 'application/json' } }).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    })

    function UsagePage(props) {
      const [stats, setStats] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [range, setRange] = React.useState({ kind: 'today' })
      const [customStart, setCustomStart] = React.useState('')
      const [customEnd, setCustomEnd] = React.useState('')
      const [wsFilter, setWsFilter] = React.useState(null)
      const [hover, setHover] = React.useState(null)
      const [lineHover, setLineHover] = React.useState(null)

      React.useEffect(() => {
        let alive = true
        let scanDone = false
        const refreshStats = () => {
          getStats().then((data) => {
            if (!alive) return
            if (data && data.scan) scanDone = !!data.scan.done
            setStats(data)
            setError(null)
          }, (e) => {
            if (!alive) return
            if (stats === null) setError('加载失败：' + (e && e.message ? e.message : String(e)))
          })
        }
        refreshStats()
        const fast = window.setInterval(() => { if (!scanDone) refreshStats() }, 2000)
        const slow = window.setInterval(() => { if (scanDone) refreshStats() }, 15000)
        return () => { alive = false; window.clearInterval(fast); window.clearInterval(slow) }
      }, [])

      const onRefresh = () => {
        getStats().then((d) => { if (d) { setStats(d); setError(null) } }, (e) => { setError('刷新失败：' + (e && e.message ? e.message : String(e))) })
      }
      const toggleFilter = (id) => {
        setWsFilter((prev) => (prev === id ? null : id))
      }

      const agg = rangeAgg(stats, range)
      const animatedTotal = useCountUp(agg.totals.input + agg.totals.output + agg.totals.cacheRead + agg.totals.cacheWrite + agg.totals.reasoning)
      const animatedRate = useCountUp(Math.round(rateOf(agg.totals.input, agg.totals.cacheRead) * 10))
      const animatedTurns = useCountUp(agg.totals.turns)

      if (error !== null) {
        return React.createElement('div', { className: 'cc-page' },
          React.createElement('div', { className: 'cc-panel' }, React.createElement('div', { className: 'cc-empty' }, error)),
        )
      }
      if (stats === null) {
        return React.createElement('div', { className: 'cc-page' },
          React.createElement('div', { className: 'cc-panel' },
            React.createElement('div', { className: 'cc-loader-wrap' },
              React.createElement('div', { className: 'cc-orbit' }, React.createElement('i', null), React.createElement('i', null)),
              React.createElement('div', { className: 'cc-loader-text' }, '正在加载用量统计…'),
            ),
          ),
        )
      }

      const scan = stats.scan || { done: true, started: true, scanned: 0, total: 0, failed: 0 }
      const workspaces = Array.isArray(stats.workspaces) ? stats.workspaces : []
      const wsById = new Map()
      const wsIndex = new Map()
      workspaces.forEach((w, i) => { wsById.set(w.id, w); wsIndex.set(w.id, i) })
      const dayMap = new Map()
      for (const d of (Array.isArray(stats.byDay) ? stats.byDay : [])) {
        if (d && d.date) dayMap.set(d.date, d)
      }
      const wsTitle = (id) => {
        const meta = wsById.get(id)
        return meta ? (meta.title || meta.path || '未知工作区') : '未知工作区'
      }

      const totalTokens = agg.totals.input + agg.totals.output + agg.totals.cacheRead + agg.totals.cacheWrite + agg.totals.reasoning
      const cacheRate = rateOf(agg.totals.input, agg.totals.cacheRead)
      const st = streaks(dayMap)

      // ---------- daily line chart (跟随筛选范围) ----------
      const chartDays = []
      {
        const now = new Date()
        let startD
        let endD
        const mk = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
        if (range.kind === 'today') { startD = mk(0); endD = mk(0) }
        else if (range.kind === '1d') { startD = mk(-1); endD = mk(0) }
        else if (range.kind === '7d') { startD = mk(-6); endD = mk(0) }
        else if (range.kind === '30d') { startD = mk(-29); endD = mk(0) }
        else if (range.kind === 'custom') {
          startD = range.start && range.start !== '' ? new Date(range.start + 'T00:00:00') : mk(-29)
          endD = range.end && range.end !== '' ? new Date(range.end + 'T00:00:00') : mk(0)
          if (startD.getTime() > endD.getTime()) { const t = startD; startD = endD; endD = t }
        } else { startD = mk(-29); endD = mk(0) }
        const totalDays = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / 86400000) + 1)
        const cap = 120
        const step = Math.max(1, Math.ceil(totalDays / cap))
        for (let i = 0; i < totalDays; i += step) {
          const d = new Date(startD.getFullYear(), startD.getMonth(), startD.getDate() + i)
          const key = fmtDate(d)
          const day = dayMap.get(key)
          chartDays.push({
            date: key,
            mday: d.getMonth() + 1 + '/' + d.getDate(),
            turns: day ? day.turns : 0,
            tokens: { input: day && day.tokens ? day.tokens.input : 0, output: day && day.tokens ? day.tokens.output : 0, cacheRead: day && day.tokens ? day.tokens.cacheRead : 0, cacheWrite: day && day.tokens ? day.tokens.cacheWrite : 0 },
          })
        }
        if (totalDays > cap && step > 1) {
          const last = new Date(endD.getFullYear(), endD.getMonth(), endD.getDate())
          const lk = fmtDate(last)
          if (!chartDays.some((c) => c.date === lk)) {
            const day = dayMap.get(lk)
            chartDays.push({ date: lk, mday: last.getMonth() + 1 + '/' + last.getDate(), turns: day ? day.turns : 0, tokens: { input: day && day.tokens ? day.tokens.input : 0, output: day && day.tokens ? day.tokens.output : 0, cacheRead: day && day.tokens ? day.tokens.cacheRead : 0, cacheWrite: day && day.tokens ? day.tokens.cacheWrite : 0 } })
          }
        }
      }
      let chartMax = 1
      for (const cd of chartDays) {
        for (const k of BAR_KEYS) if (cd.tokens[k] > chartMax) chartMax = cd.tokens[k]
      }
      const LINE_W = 560
      const LINE_H = 130
      const LINE_PAD = 8
      const linePoints = {}
      const lineDots = []
      for (const k of BAR_KEYS) {
        linePoints[k] = chartDays.map((cd, i) => {
          const x = chartDays.length === 1 ? LINE_W / 2 : LINE_PAD + (i / (chartDays.length - 1)) * (LINE_W - LINE_PAD * 2)
          const y = LINE_H - LINE_PAD - (cd.tokens[k] / chartMax) * (LINE_H - LINE_PAD * 2)
          return x.toFixed(1) + ',' + y.toFixed(1)
        }).join(' ')
      }
      chartDays.forEach((cd, i) => {
        const x = chartDays.length === 1 ? LINE_W / 2 : LINE_PAD + (i / (chartDays.length - 1)) * (LINE_W - LINE_PAD * 2)
        const active = lineHover !== null && lineHover.date === cd.date
        for (const k of BAR_KEYS) {
          const y = LINE_H - LINE_PAD - (cd.tokens[k] / chartMax) * (LINE_H - LINE_PAD * 2)
          lineDots.push(React.createElement('circle', {
            key: k + '-' + i,
            className: 'cc-line-dot' + (active ? ' cc-line-active' : ''),
            cx: x,
            cy: y,
            r: active ? 5 : 3,
            stroke: BAR_COLORS[k],
            onMouseEnter: (ev) => { setHover(null); setLineHover({ date: cd.date, x: ev.clientX, y: ev.clientY, day: dayMap.get(cd.date) }) },
            onMouseMove: (ev) => setLineHover((prev) => (prev && prev.date === cd.date ? { ...prev, x: ev.clientX, y: ev.clientY } : prev)),
            onMouseLeave: () => setLineHover(null),
          }))
        }
      })
      const lineLegend = BAR_KEYS.map((k) => React.createElement('span', { key: k, className: 'cc-legend-item' },
        React.createElement('span', { className: 'cc-legend-dot', style: { background: BAR_COLORS[k] } }),
        BAR_LABELS[k],
      ))
      const lineSvg = React.createElement('svg', { className: 'cc-line', viewBox: '0 0 ' + LINE_W + ' ' + LINE_H, preserveAspectRatio: 'none' },
        ...BAR_KEYS.map((k) => React.createElement('polyline', { key: k, className: 'cc-line-' + k, points: linePoints[k], fill: 'none', stroke: BAR_COLORS[k], strokeWidth: 2, strokeLinejoin: 'round', strokeLinecap: 'round' })),
        ...lineDots,
      )
      const lineXLabels = chartDays.map((cd, i) => {
        const show = chartDays.length <= 14 || i === 0 || i === chartDays.length - 1 || i % Math.max(1, Math.floor(chartDays.length / 7)) === 0
        return React.createElement('span', { key: cd.date, className: 'cc-line-xlabel' + (show ? '' : ' cc-hide'), style: { left: (chartDays.length === 1 ? 0 : (i / (chartDays.length - 1)) * 100) + '%' } }, cd.mday)
      })
      const yTicks = [0, 0.25, 0.5, 0.75, 1].map((p) => ({ value: Math.round(chartMax * p), top: ((1 - p) * 100).toFixed(1) + '%' }))
      const yAxis = React.createElement('div', { className: 'cc-axis-y' },
        yTicks.map((t) => React.createElement('span', { key: t.value, style: { position: 'absolute', top: t.top, transform: 'translateY(-50%)' } }, fmtCompact(t.value))),
      )
      const chartRangeText = {
        today: '当天',
        '1d': '近 1 天',
        '7d': '近 7 天',
        '30d': '近 30 天',
        custom: (range.start || '…') + ' ~ ' + (range.end || '…'),
      }[range.kind]

      // ---------- heatmap (跟随筛选范围, GitHub 风格) ----------
      const today = new Date()
      const todayKey = fmtDate(today)
      const hmDays = []
      {
        const now = new Date()
        const mk = (n) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
        let hs
        let he
        if (range.kind === 'today') { hs = mk(0); he = mk(0) }
        else if (range.kind === '1d') { hs = mk(-1); he = mk(0) }
        else if (range.kind === '7d') { hs = mk(-6); he = mk(0) }
        else if (range.kind === '30d') { hs = mk(-29); he = mk(0) }
        else if (range.kind === 'custom') {
          hs = range.start && range.start !== '' ? new Date(range.start + 'T00:00:00') : mk(-29)
          he = range.end && range.end !== '' ? new Date(range.end + 'T00:00:00') : mk(0)
          if (hs.getTime() > he.getTime()) { const t = hs; hs = he; he = t }
        } else { hs = mk(-29); he = mk(0) }
        const n = Math.max(1, Math.round((he.getTime() - hs.getTime()) / 86400000) + 1)
        const hmCap = 371
        const hmStep = Math.max(1, Math.ceil(n / hmCap))
        for (let i = 0; i < n; i += hmStep) {
          const d = new Date(hs.getFullYear(), hs.getMonth(), hs.getDate() + i)
          hmDays.push({ date: fmtDate(d), weekday: d.getDay(), month: d.getMonth(), year: d.getFullYear() })
        }
        if (n > hmCap && hmStep > 1) {
          const lk = fmtDate(he)
          if (!hmDays.some((c) => c.date === lk)) hmDays.push({ date: lk, weekday: he.getDay(), month: he.getMonth(), year: he.getFullYear() })
        }
      }
      const hmCols = Math.max(1, Math.ceil(hmDays.length / 7))
      const hmMonthLabels = []
      for (let c = 0; c < hmCols; c++) {
        const first = hmDays[c * 7]
        if (first === undefined) continue
        const prev = c > 0 ? hmDays[(c - 1) * 7] : undefined
        if (prev === undefined || first.month !== prev.month || first.year !== prev.year) {
          hmMonthLabels.push({ col: c, text: first.month === 0 ? first.year + '年1月' : (first.month + 1) + '月' })
        }
      }
      const weekdayLabels = ['', '周一', '', '周三', '', '周五', '']

      const onEnter = (cell, ev) => {
        setHover({ date: cell.date, x: ev.clientX, y: ev.clientY, day: dayMap.get(cell.date) })
      }
      const onMove = (cell, ev) => {
        setHover((prev) => (prev !== null && prev.date === cell.date ? { date: prev.date, x: ev.clientX, y: ev.clientY, day: prev.day } : prev))
      }
      const onLeave = () => setHover(null)

      const cellElements = hmDays.map((cell, i) => {
        const day = dayMap.get(cell.date)
        const count = day !== undefined ? day.turns || 0 : 0
        const level = levelOf(count)
        const isToday = cell.date === todayKey
        const style = {
          background: cellBg(level),
          animationDelay: (i * 1.2) + 'ms',
        }
        if (isToday) style.animation = 'cc-cell-in .45s ease both, cc-glow 3s ease-in-out .7s infinite'
        return React.createElement('div', {
          key: cell.date,
          className: 'cc-cell',
          style,
          onMouseEnter: (ev) => onEnter(cell, ev),
          onMouseMove: (ev) => onMove(cell, ev),
          onMouseLeave: onLeave,
        })
      })

      // ---------- per-model grouped table ----------
      const models = Array.isArray(agg.perModel) ? agg.perModel : []
      const modelTotal = (m) => m.input + m.output + m.cacheRead + m.cacheWrite + m.reasoning
      const providers = []
      const providerMap = new Map()
      for (const m of models) {
        let g = providerMap.get(m.provider)
        if (g === undefined) {
          g = { provider: m.provider, models: [], input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, msgs: 0 }
          providerMap.set(m.provider, g)
          providers.push(g)
        }
        g.models.push(m)
        g.input += m.input
        g.output += m.output
        g.cacheRead += m.cacheRead
        g.cacheWrite += m.cacheWrite
        g.reasoning += m.reasoning
        g.msgs += m.msgs
      }
      providers.sort((a, b) => modelTotal(b) - modelTotal(a))
      for (const g of providers) g.models.sort((a, b) => modelTotal(b) - modelTotal(a))

      let tip = null
      if (lineHover !== null && lineHover !== undefined) {
        const day = lineHover.day
        const tokens = (day && day.tokens) ? day.tokens : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        const flip = lineHover.x > 640
        tip = React.createElement('div', {
          key: lineHover.date,
          className: 'cc-tip',
          style: {
            left: lineHover.x + 14,
            top: lineHover.y + 12,
            transform: flip ? 'translateX(calc(-100% - 28px))' : 'none',
          },
        },
          React.createElement('div', { className: 'cc-tip-date' }, humanDate(lineHover.date)),
          ['input', 'output', 'cacheWrite', 'cacheRead'].map((k) => React.createElement('div', { key: k, className: 'cc-tip-row' },
            React.createElement('span', { className: 'cc-dot', style: { background: BAR_COLORS[k] } }),
            React.createElement('span', {}, BAR_LABELS[k]),
            React.createElement('span', { className: 'cc-n' }, fmtCompact(tokens[k] || 0)),
          )),
        )
      } else if (hover !== null && hover !== undefined) {
        const day = hover.day
        let rowsContent = []
        let tokensText = ''
        if (day !== undefined) {
          const pw = Array.isArray(day.perWorkspace) ? day.perWorkspace : []
          const tokens = day.tokens || { input: 0, output: 0, cacheRead: 0 }
          const sorted = pw.slice().sort((a, b) => (b.turns || 0) - (a.turns || 0))
          rowsContent = sorted.map((entry) => {
            const idx = wsIndex.get(entry.workspaceId)
            return React.createElement('div', {
              key: entry.workspaceId,
              className: 'cc-tip-row',
              onClick: () => { toggleFilter(entry.workspaceId); setHover(null) },
            },
              React.createElement('span', { className: 'cc-dot', style: { background: wsColor(idx === undefined ? 0 : idx) } }),
              React.createElement('span', {}, wsTitle(entry.workspaceId)),
              React.createElement('span', { className: 'cc-n' }, (entry.turns || 0) + ' 次'),
            )
          })
          if (tokens.input + tokens.output + tokens.cacheRead > 0) {
            tokensText = 'Token：输入 ' + fmtCompact(tokens.input) + ' · 缓存命中 ' + fmtCompact(tokens.cacheRead) + ' · 输出 ' + fmtCompact(tokens.output)
          }
        }
        const flip = hover.x > 640
        tip = React.createElement('div', {
          key: hover.date,
          className: 'cc-tip',
          style: {
            left: hover.x + 14,
            top: hover.y + 12,
            transform: flip ? 'translateX(calc(-100% - 28px))' : 'none',
          },
        },
          React.createElement('div', { className: 'cc-tip-date' }, humanDate(hover.date)),
          day !== undefined && day.turns > 0
            ? rowsContent
            : React.createElement('div', { className: 'cc-empty', style: { padding: '6px 0' } }, '这一天没有使用记录'),
          tokensText !== '' ? React.createElement('div', { className: 'cc-tip-tokens' }, tokensText) : null,
        )
      }

      const rangeLabel = { today: '当天', '1d': '近 1 天', '7d': '近 7 天', '30d': '近 30 天', custom: (range.start || '…') + ' ~ ' + (range.end || '…'), all: '全部' }[range.kind] || '全部'
      const scanning = !scan.done
      const pct = scan.total > 0 ? Math.min(100, Math.round((scan.scanned / scan.total) * 100)) : 40
      const byDayArr = Array.isArray(stats.byDay) ? stats.byDay : []
      const totals = stats.totals || { turns: 0 }
      const isEmpty = scan.done && byDayArr.length === 0 && totals.turns === 0
      const card = (label, value, sub, delay, large) => React.createElement('div', { className: 'cc-card', style: { animationDelay: (delay * 70) + 'ms' } },
        React.createElement('div', { className: 'cc-card-label' }, label),
        React.createElement('div', { className: 'cc-card-value' + (large ? ' cc-lg' : '') }, value),
        React.createElement('div', { className: 'cc-card-sub' }, sub),
      )

      return React.createElement('div', { className: 'cc-page' },
        React.createElement('div', { className: 'cc-head' },
          React.createElement('h2', { className: 'cc-title' }, '使用统计'),
          React.createElement('div', { className: 'cc-actions' },
            React.createElement('div', { className: 'cc-range' },
              [['today', '当天'], ['1d', '1 天'], ['7d', '7 天'], ['30d', '30 天']].map(([rk, rl]) => React.createElement('button', {
                key: rk,
                className: range.kind === rk ? 'cc-on' : '',
                onClick: () => setRange({ kind: rk }),
              }, rl)),
            ),
            React.createElement('input', {
              className: 'cc-date',
              type: 'date',
              value: customStart,
              onChange: (e) => setCustomStart(e.target.value),
            }),
            React.createElement('span', { className: 'cc-date-sep' }, '至'),
            React.createElement('input', {
              className: 'cc-date',
              type: 'date',
              value: customEnd,
              onChange: (e) => setCustomEnd(e.target.value),
            }),
            React.createElement('button', {
              className: 'cc-refresh',
              onClick: () => {
                if (customStart !== '' || customEnd !== '') setRange({ kind: 'custom', start: customStart, end: customEnd })
              },
            }, '应用'),
            React.createElement('button', { className: 'cc-refresh', onClick: onRefresh }, '刷新'),
          ),
        ),
        scanning ? React.createElement('div', { className: 'cc-progress' },
          React.createElement('span', {}, '正在统计历史会话 ' + scan.scanned + ' / ' + scan.total + (scan.failed > 0 ? '（' + scan.failed + ' 个读取失败）' : '')),
          React.createElement('div', { className: 'cc-bar' }, React.createElement('div', { className: 'cc-fill', style: { width: pct + '%' } })),
        ) : null,
        isEmpty ? React.createElement('div', { className: 'cc-panel' },
          React.createElement('div', { className: 'cc-empty' }, '还没有使用记录。开始对话后，这里会点亮。'),
        ) : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'cc-cards' },
            card('总花费 Token', fmtCount(animatedTotal), '≈ ' + fmtWan(agg.totals.input + agg.totals.output + agg.totals.cacheRead + agg.totals.cacheWrite + agg.totals.reasoning) + ' · 输入 ' + fmtCompact(agg.totals.input) + ' · 命中 ' + fmtCompact(agg.totals.cacheRead) + ' · 输出 ' + fmtCompact(agg.totals.output) + ' · 推理 ' + fmtCompact(agg.totals.reasoning), 0, true),
            card('缓存命中率', (animatedRate / 10).toFixed(1) + '%', '命中 ' + fmtCompact(agg.totals.cacheRead) + ' / 未命中输入 ' + fmtCompact(agg.totals.input), 1),
            card('总使用次数', fmtCount(animatedTurns), range.kind === 'all' ? (agg.totals.sessions || 0) + ' 个会话' : rangeLabel + '内的回合数', 2),
            card('模型用量', models.length + ' 个模型', providers.length + ' 个提供商 · 累计 ' + fmtCompact(models.reduce((s, m) => s + m.msgs, 0)) + ' 条消息', 3),
            card('连续使用', st.streak + ' 天', '最长连续 ' + st.best + ' 天', 4),
          ),
          React.createElement('div', { className: 'cc-panel' },
            React.createElement('div', { className: 'cc-panel-head' },
              React.createElement('h3', { className: 'cc-panel-title', style: { margin: 0 } }, '使用统计'),
              React.createElement('div', { className: 'cc-legend' },
                lineLegend,
                React.createElement('span', { className: 'cc-legend-item' }, chartRangeText),
              ),
            ),
            chartDays.length === 0
              ? React.createElement('div', { className: 'cc-empty' }, '暂无每日数据')
              : React.createElement('div', { className: 'cc-chart-scroll' },
                React.createElement('div', { className: 'cc-line-wrap' },
                  yAxis,
                  React.createElement('div', { className: 'cc-line-area' }, lineSvg),
                  React.createElement('div', { className: 'cc-line-xlabels' }, lineXLabels),
                ),
              ),
          ),
          React.createElement('div', { className: 'cc-panel' },
            React.createElement('div', { className: 'cc-hm-head' },
              React.createElement('div', { className: 'cc-legend' },
                ['0', '1–20', '20–100', '100–200', '200+'].map((text, l) => React.createElement(React.Fragment, { key: l },
                  React.createElement('span', { className: 'cc-cell', style: { background: cellBg(l) } }),
                  React.createElement('span', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)' } }, text),
                )),
              ),
            ),
            React.createElement('div', { className: 'cc-hm-scroll' },
              React.createElement('div', { className: 'cc-months', style: { width: Math.max(200, hmCols * 13) } },
                hmMonthLabels.map((m, i) => React.createElement('span', { key: i, style: { left: m.col * 13 } }, m.text)),
              ),
              React.createElement('div', { className: 'cc-hm-body' },
                React.createElement('div', { className: 'cc-wdays' }, weekdayLabels.map((w, i) => React.createElement('span', { key: i }, w))),
                React.createElement('div', { className: 'cc-grid', style: { gridAutoFlow: 'column', gridTemplateRows: 'repeat(7,10px)', gridAutoColumns: '10px' } }, cellElements),
              ),
            ),
            React.createElement('div', { className: 'cc-note', style: { marginTop: 10 } }, '口径：每完成一个回合点亮一次（含子代理会话）；悬停查看按工作区明细，点击工作区可筛选热力图与明细表。'),
          ),
          React.createElement('div', { className: 'cc-panel' },
            React.createElement('h3', { className: 'cc-panel-title' }, '按供应商统计（' + rangeLabel + '）'),
            providers.length === 0
              ? React.createElement('div', { className: 'cc-empty' }, '暂无供应商用量数据')
              : React.createElement(React.Fragment, null,
                React.createElement('div', { className: 'cc-hrow' },
                  React.createElement('div', {}, '供应商'),
                  React.createElement('div', { className: 'cc-num' }, '请求数'),
                  React.createElement('div', { className: 'cc-num' }, 'Tokens'),
                  React.createElement('div', { className: 'cc-num' }, '缓存命中'),
                ),
                providers.map((g) => {
                  const gTotal = modelTotal(g)
                  return React.createElement('div', { key: g.provider, className: 'cc-row' },
                    React.createElement('div', { className: 'cc-grp-name' },
                      React.createElement('span', { className: 'cc-dot', style: { background: providerColor(g.provider) } }),
                      g.provider,
                    ),
                    React.createElement('div', { className: 'cc-num' }, fmtCompact(g.msgs)),
                    React.createElement('div', { className: 'cc-num' }, fmtCompact(gTotal)),
                    React.createElement('div', { className: 'cc-num' }, fmtCompact(g.cacheRead)),
                  )
                }),
              ),
          ),
        ),
        tip,
      )
    }

    function TodayModal({ stats, onClose }) {
      const todayKey = fmtDate(new Date())
      const days = Array.isArray(stats && stats.byDay) ? stats.byDay : []
      const today = days.find((d) => d && d.date === todayKey)
      const tokens = (today && today.tokens) ? today.tokens : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      const total = (tokens.input || 0) + (tokens.output || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite || 0) + (tokens.reasoning || 0)
      const denom = (tokens.input || 0) + (tokens.cacheRead || 0)
      const rate = denom > 0 ? ((tokens.cacheRead || 0) / denom * 100).toFixed(1) : '0.0'
      const turns = (today && today.turns) || 0

      const byModel = (today && Array.isArray(today.byModel)) ? today.byModel : []
      const modelList = byModel.slice().sort((a, b) => {
        const ta = (a.input || 0) + (a.output || 0) + (a.cacheRead || 0) + (a.cacheWrite || 0) + (a.reasoning || 0)
        const tb = (b.input || 0) + (b.output || 0) + (b.cacheRead || 0) + (b.cacheWrite || 0) + (b.reasoning || 0)
        return tb - ta
      })

      React.useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])

      return React.createElement('div', {
        className: 'cc-modal-overlay',
        onClick: (e) => { if (e.target === e.currentTarget) onClose() },
      },
        React.createElement('div', { className: 'cc-modal' },
          React.createElement('div', { className: 'cc-modal-head' },
            React.createElement('h3', { className: 'cc-modal-title' }, '今日用量'),
            React.createElement('button', { className: 'cc-modal-close', onClick: onClose, title: '关闭' }, '×'),
          ),
          React.createElement('div', { className: 'cc-modal-body' },
            React.createElement('div', { className: 'cc-mini-card' },
              React.createElement('div', { className: 'cc-mini-card-label' }, '总 Token'),
              React.createElement('div', { className: 'cc-mini-card-value' }, fmtCount(total)),
              React.createElement('div', { className: 'cc-mini-card-sub' },
                '≈ ' + fmtWan(total) + ' · 输入 ' + fmtCompact(tokens.input || 0) + ' · 输出 ' + fmtCompact(tokens.output || 0) + ' · 命中 ' + rate + '% · ' + turns + ' 次',
              ),
            ),
            modelList.length > 0
              ? React.createElement(React.Fragment, null,
                  React.createElement('div', { className: 'cc-panel-title', style: { margin: 0 } }, '按模型分布'),
                  React.createElement('div', { className: 'cc-mini-table' },
                    React.createElement('div', { className: 'cc-mini-row cc-head' },
                      React.createElement('div', { className: 'cc-mini-name' }, '模型'),
                      React.createElement('div', { className: 'cc-mini-num' }, 'Token'),
                      React.createElement('div', { className: 'cc-mini-num' }, '请求数'),
                    ),
                    modelList.map((m) => React.createElement('div', { key: (m.provider || '') + '/' + (m.model || ''), className: 'cc-mini-row' },
                      React.createElement('div', { className: 'cc-mini-name', title: (m.provider || '') + ' / ' + (m.model || '') }, m.model || '未知模型'),
                      React.createElement('div', { className: 'cc-mini-num' }, fmtCompact((m.input || 0) + (m.output || 0) + (m.cacheRead || 0) + (m.cacheWrite || 0) + (m.reasoning || 0))),
                      React.createElement('div', { className: 'cc-mini-num' }, fmtCount(m.msgs || 0)),
                    )),
                  ),
                )
              : React.createElement('div', { className: 'cc-empty' }, '今天还没有使用记录'),
          ),
          React.createElement('div', { className: 'cc-modal-foot' },
            React.createElement('button', { className: 'cc-modal-btn', onClick: onClose }, '关闭'),
          ),
        ),
      )
    }

    function SidebarToday() {
      const [todayStats, setTodayStats] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const actionRef = React.useRef(null)
      React.useEffect(() => {
        let alive = true
        const refresh = () => {
          getStats().then((d) => { if (alive) setTodayStats(d) }, () => {})
        }
        refresh()
        const t = window.setInterval(refresh, 15000)
        return () => { alive = false; window.clearInterval(t) }
      }, [])
      React.useEffect(() => {
        const el = actionRef.current
        if (!el) return
        const parent = el.parentElement
        if (parent) parent.style.flexWrap = 'wrap'
      }, [])

      const todayKey = fmtDate(new Date())
      const days = Array.isArray(todayStats && todayStats.byDay) ? todayStats.byDay : []
      const today = days.find((d) => d && d.date === todayKey)
      const tokens = (today && today.tokens) ? today.tokens : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
      const total = (tokens.input || 0) + (tokens.output || 0) + (tokens.cacheRead || 0) + (tokens.cacheWrite || 0) + (tokens.reasoning || 0)

      return React.createElement(React.Fragment, null,
        React.createElement('div', { ref: actionRef, className: 'cc-sidebar-action', onClick: () => setOpen(true), title: '查看今日用量' },
          React.createElement(StatsIcon, { className: 'cc-sidebar-action-icon', width: 16, height: 16 }),
          React.createElement('div', { className: 'cc-sidebar-action-main' },
            React.createElement('span', { className: 'cc-sidebar-action-label' }, '今日用量'),
            React.createElement('span', { className: 'cc-sidebar-action-value' }, todayStats === null ? '—' : fmtCompact(total)),
          ),
        ),
        open ? React.createElement(TodayModal, { stats: todayStats, onClose: () => setOpen(false) }) : null,
      )
    }

    function renderPage() {
      try {
        return React.createElement(UsagePage)
      } catch (e) {
        console.error('[shanhai-stats] render error:', e)
        return React.createElement('div', { className: 'cc-page' },
          React.createElement('div', { className: 'cc-empty' }, '用量统计渲染失败：' + (e && e.message ? e.message : String(e))),
        )
      }
    }

    exports.apply = (ctx) => {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'shanhai-stats', order: 31, label: () => '用量统计' },
        renderPage,
      ))
      // sidebar 入口已移除，今日用量合并到设置页面的默认当天视图
    }
    exports.inject = ['slots']
    return module.exports;
  }
});