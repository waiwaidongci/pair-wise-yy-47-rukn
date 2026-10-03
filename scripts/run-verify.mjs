// 单 bundle 方案：verify 脚本与 browser.ts 一起打包，共享同一份 msw 实例。
// setupWorker(msw/browser) 被替换为捕获器；browser.ts 中的相对路径处理器改写成通配主机（node 端无 location 基准）。
import { build } from 'esbuild'
import { pathToFileURL } from 'node:url'
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'a11y-verify-'))
const probe = join(dir, 'probe.mjs')
const shim = join(dir, 'msw-shim.mjs')
const outfile = join(dir, 'verify.mjs')

writeFileSync(probe, `
export const captured = []
export function setupWorker(...handlers) {
  captured.push(...handlers)
  return { start: async () => {}, use() {}, resetHandlers() {}, restoreHandlers() {} }
}
`)

writeFileSync(shim, `
import { http as baseHttp, HttpResponse } from 'msw'
const absolutize = (path) => (typeof path === 'string' && path.startsWith('/') ? '*' + path : path)
const wrap = (method) => (path, ...rest) => baseHttp[method](absolutize(path), ...rest)
export const http = {
  get: wrap('get'), post: wrap('post'), put: wrap('put'),
  patch: wrap('patch'), delete: wrap('delete'), head: wrap('head'), options: wrap('options'), all: wrap('all'),
}
export { HttpResponse }
`)

const mswRedirect = {
  name: 'msw-shim-for-browser',
  setup(api) {
    api.onResolve({ filter: /^msw$/ }, (args) => {
      if (args.importer.replace(/\\/g, '/').includes('/src/api/browser')) return { path: shim }
      return undefined
    })
  },
}

await build({
  entryPoints: ['/workspace/scripts/verify-conflicts.mts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  loader: { '.mts': 'ts' },
  alias: { 'msw/browser': probe, 'verify-probe': probe },
  plugins: [mswRedirect],
  // shim 从 /tmp 直接裸导入 msw，需要能解析到工作区依赖
  nodePaths: ['/workspace/node_modules'],
  logLevel: 'silent',
})

try {
  await import(pathToFileURL(outfile).href)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
