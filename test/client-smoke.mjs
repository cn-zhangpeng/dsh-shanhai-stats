// dsh-shanhai-stats client 半 smoke 测试：模拟浏览器模块加载环境，验证工厂能导出 inject/apply 且结构正确
import fs from 'node:fs'

let result = null
let errors = 0
function check(label, cond, detail) {
  if (cond) console.log('  ✅ ' + label)
  else { errors += 1; console.log('  ❌ ' + label + (detail !== undefined ? ' — ' + detail : '')) }
}

// 模拟 window + ModuleLoader
global.window = {
  __ModuleLoader__: {
    load(spec) {
      result = spec
      const mod = spec.factory((mid) => {
        if (mid === 'react') {
          // 最小 React 桩：createElement 返回描述对象，hooks 返回 [state, setState]
          return {
            createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
            Fragment: 'FRAGMENT',
            useState: (init) => [{ value: init }, () => {}],
            useEffect: () => {},
          }
        }
        throw new Error('unsupported require: ' + mid)
      })
      return mod
    },
  },
}
global.document = undefined // CSS 注入守卫应跳过

const code = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
try {
  // 工厂由 load 调用并返回 module.exports；此处直接执行以捕获顶层错误
  new Function('window', 'require', code)(global.window, (mid) => {
    if (mid === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
        Fragment: 'FRAGMENT',
        useState: (init) => [{ value: init }, () => {}],
        useEffect: () => {},
      }
    }
    throw new Error('unsupported require: ' + mid)
  })
} catch (e) {
  errors += 1
  console.log('  ❌ 顶层执行 — ' + e.message)
}

check('load 被调用', result !== null && result.id === 'dsh-shanhai-stats', result && result.id)
if (result !== null) {
  const mod = result.id === 'dsh-shanhai-stats' ? tryFactory(result) : null
  check('exports.inject 含 slots', mod !== null && Array.isArray(mod.inject) && mod.inject.includes('slots'))
  check('exports.apply 是函数', mod !== null && typeof mod.apply === 'function')
}

function tryFactory(spec) {
  try {
    return spec.factory((mid) => {
      if (mid === 'react') {
        return {
          createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
          Fragment: 'FRAGMENT',
          useState: (init) => [{ value: init }, () => {}],
          useEffect: () => {},
        }
      }
      throw new Error('unsupported require: ' + mid)
    })
  } catch (e) {
    errors += 1
    console.log('  ❌ factory — ' + e.message)
    return null
  }
}

console.log(errors === 0 ? '\n🎉 client smoke 全部通过' : '\n💥 ' + errors + ' 项失败')
process.exit(errors === 0 ? 0 : 1)