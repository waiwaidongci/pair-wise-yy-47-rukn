// 逻辑验证：复用实际 mock 处理器（src/api/browser.ts 的全部路由），用 MSW node server 模拟双审核员并发
import { setupServer } from 'msw/node'
import { http } from 'msw'
// browser.ts 经 msw/browser 别名把处理器注册到捕获探针；这里仅确保该模块被求值
import '../src/api/browser'
// @ts-expect-error 探针虚拟模块
import { captured } from 'verify-probe'

async function main() {
  const workerHandlers = captured as Parameters<typeof setupServer>[0][]
  if (!workerHandlers.length) throw new Error('未捕获到 mock 处理器')
  const server = setupServer(...workerHandlers)
  server.listen({ onUnhandledRequest: 'error' })

  const base = 'http://localhost'
  const json = (r: Response) => r.json()
  const expect = (name: string, cond: boolean, extra = '') => {
    if (!cond) { console.error(`❌ ${name} ${extra}`); process.exitCode = 1 }
    else console.log(`✅ ${name} ${extra}`)
  }

  // 场景 0：旧数据首次提交必须带版本号（428 保护）
  const noVersion = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1061', opId: 'OP-x', patch: { team: '结算体验组' } }) })
  expect('不带版本号/操作号被拒绝 428', noVersion.status === 428)

  // 场景 1：旧数据 rev=0，审核员 A 首次带版本号提交即生效，rev 推进到 1
  const opA = 'OP-AAA-1111'
  const rA = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1061', opId: opA, baseRev: 0, patch: { team: '团队A', owner: '甲', status: '修复中' } }) }).then(json)
  expect('旧数据首次带版本号提交生效', rA.outcome === 'applied' && rA.rev === 1 && rA.issue.team === '团队A', `rev=${rA.rev}`)

  // 场景 2：审核员 B 基于旧版本 rev 0 晚到，改了不同团队/状态 -> 冲突挂起，台账不被覆盖
  const opB = 'OP-BBB-2222'
  const rB = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1061', opId: opB, baseRev: 0, patch: { team: '团队B', owner: '乙', status: '待复测' } }) })
  const bBody = await rB.json()
  expect('版本落后转入冲突 409', rB.status === 409 && bBody.outcome === 'conflict')
  expect('冲突列出 status/team/owner 三个字段', bBody.conflict.fields.map((f: any) => f.field).join() === 'status,team,owner', bBody.conflict.fields.map((f: any) => `${f.field}:${f.current}->${f.incoming}`).join(' | '))
  const afterConflict = (await fetch(`${base}/api/issues`).then(json)).find((i: any) => i.key === 'A11Y-1061')
  expect('冲突后台账仍是 A 的值（未被覆盖）', afterConflict.team === '团队A' && afterConflict.status === '修复中' && afterConflict.rev === 1)
  const conflictsList = await fetch(`${base}/api/conflicts`).then(json)
  expect('冲突进入待处理列表', conflictsList.length === 1 && !conflictsList[0].resolvedAt)

  // 场景 3：B 断网重试，沿用原操作号 -> 回放同一冲突，不重复新增
  const rB2 = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1061', opId: opB, baseRev: 0, patch: { team: '团队B', owner: '乙', status: '待复测' } }) })
  expect('同操作号重试仍是同一冲突 409', rB2.status === 409)
  const conflictsAfterRetry = await fetch(`${base}/api/conflicts`).then(json)
  expect('重试不重复挂起冲突', conflictsAfterRetry.length === 1)

  // 场景 4：审核员逐字段解决：状态采用当前（修复中），团队/负责人采用本次（团队B/乙）
  const cfId = bBody.conflict.id
  const rR = await fetch(`${base}/api/conflicts/${cfId}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: { status: 'current', team: 'incoming', owner: 'incoming' } }) }).then(json)
  expect('按原操作号写入解决结果', rR.outcome === 'applied' && rR.issue.team === '团队B' && rR.issue.owner === '乙' && rR.issue.status === '修复中' && rR.rev === 2, `rev=${rR.rev}`)

  // 场景 5：解决后 B 再用原操作号重试 -> 回放解决结果，不再产生冲突/写入
  const rB3 = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1061', opId: opB, baseRev: 0, patch: { team: '团队B', owner: '乙', status: '待复测' } }) }).then(json)
  expect('原操作号重试回放解决结果', rB3.outcome === 'applied' && rB3.replay === true && rB3.issue.rev === 2 && rB3.issue.status === '修复中')

  // 场景 6：复测不重复追加记录 —— A11Y-1074 rev0，复测员 R1 首次提交（激活版本 rev1）
  const opR1 = 'OP-RT1-1111'
  const p1 = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1074', opId: opR1, baseRev: 0, retest: { result: '已退回', note: '对比度仍不足', environment: 'Safari 26' } }) }).then(json)
  expect('首次复测生效 rev1，追加一条记录', p1.rev === 1 && p1.issue.retestRecords.length === 1)

  // 同操作号因断网重试
  const p1retry = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1074', opId: opR1, baseRev: 0, retest: { result: '已退回', note: '对比度仍不足', environment: 'Safari 26' } }) }).then(json)
  expect('复测断网重试回放首次结果，不重复追加', p1retry.replay === true && p1retry.issue.retestRecords.length === 1)

  // R2 基于 rev0 晚到不同复测结论 -> 复测字段冲突，且不追加 R2 记录
  const opR2 = 'OP-RT2-2222'
  const p2 = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1074', opId: opR2, baseRev: 0, retest: { result: '已通过', note: '复测通过', environment: 'Chrome 140' } }) })
  const p2b = await p2.json()
  expect('复测版本落后产生冲突', p2.status === 409 && p2b.conflict.fields.some((f: any) => f.field === 'retest'))
  const i1074 = (await fetch(`${base}/api/issues`).then(json)).find((i: any) => i.key === 'A11Y-1074')
  expect('冲突复测记录未写入（仍 1 条）', i1074.retestRecords.length === 1)

  // 解决冲突，复测采用本次值 -> 只追加 1 条
  const rtCf = p2b.conflict
  const resolveR = await fetch(`${base}/api/conflicts/${rtCf.id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: { retest: 'incoming' } }) }).then(json)
  expect('解决复测冲突按原操作号写入且仅追加一条', resolveR.issue.retestRecords.length === 2 && resolveR.issue.status === '已通过' && resolveR.rev === 2)
  // 再次解决同一冲突 -> replay
  const resolveAgain = await fetch(`${base}/api/conflicts/${rtCf.id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resolution: { retest: 'incoming' } }) }).then(json)
  expect('重复解决冲突回放首次结果', resolveAgain.replay === true && resolveAgain.issue.retestRecords.length === 2)

  // 场景 7：版本落后但值已与当前一致 -> 直接写入（不冲突）
  const opSame = 'OP-SAME-333'
  // A11Y-1048 当前 rev0 团队=前端基础组件组；A 先把它推到 rev1，B 基于 rev0 提交相同团队/不同 owner
  const a1 = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1048', opId: 'OP-A1-1', baseRev: 0, patch: { owner: '何沐-改' } }) }).then(json)
  const bSame = await fetch(`${base}/api/changes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'A11Y-1048', opId: opSame, baseRev: 0, patch: { owner: '何沐-改' } }) }).then(json)
  expect('版本落后但无差异字段时正常写入（幂等演进）', bSame.outcome === 'applied' && bSame.issue.owner === '何沐-改', `rev=${bSame.rev}`)

  // 场景 8：批量分配携带各问题版本号
  const bulk = await fetch(`${base}/api/issues/bulk-assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ opId: 'OP-BULK-1', keys: ['A11Y-1083'], revs: { 'A11Y-1083': 0 }, team: '供应链前端组', owner: '顾雪', dueDate: '2026-10-05', priority: 'P1' }) }).then(json)
  expect('批量分配旧数据按 rev 生效', bulk.updated === 1 && bulk.conflicted === 0)
  const i1083 = (await fetch(`${base}/api/issues`).then(json)).find((i: any) => i.key === 'A11Y-1083')
  expect('批量分配后 rev 推进', i1083.rev === 1 && i1083.status === '修复中')

  server.close()
  console.log(process.exitCode ? '\n存在失败用例' : '\n全部用例通过')
}

main().catch((err) => { console.error(err); process.exit(1) })
