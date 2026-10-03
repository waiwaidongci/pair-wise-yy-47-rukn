import { setupServer } from 'msw/node'
import { createHandlers } from '../src/api/handlers'
import assert from 'node:assert'

const BASE = 'http://localhost'
const server = setupServer(...createHandlers(BASE))
server.listen({ onUnhandledRequest: 'error' })

async function getIssue(key: string) {
  const res = await fetch(`${BASE}/api/issues`)
  const list = (await res.json()) as Array<Record<string, unknown>>
  return list.find((item) => item.key === key)
}

async function review(key: string, body: Record<string, unknown>) {
  return fetch(`${BASE}/api/issues/${key}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function main() {
  // 1. 正常复测：版本 +1，追加一条记录
  let issue = await getIssue('A11Y-1074')
  assert.equal(issue!.version, 1, 'seed version should be 1')
  const opNo1 = crypto.randomUUID()
  let res = await review('A11Y-1074', { result: '已通过', note: '测试通过', environment: 'Chrome', opNo: opNo1, baseVersion: 1 })
  assert.equal(res.status, 200)
  issue = await getIssue('A11Y-1074')
  assert.equal(issue!.version, 2, 'version should increment to 2')
  assert.equal((issue!.retestRecords as unknown[]).length, 1, 'one retest record')
  assert.equal(issue!.status, '已通过')

  // 2. 同操作号重试（断网）：不重复追加记录，版本不变
  res = await review('A11Y-1074', { result: '已通过', note: '测试通过', environment: 'Chrome', opNo: opNo1, baseVersion: 1 })
  assert.equal(res.status, 200)
  issue = await getIssue('A11Y-1074')
  assert.equal((issue!.retestRecords as unknown[]).length, 1, 'retry should not duplicate record')
  assert.equal(issue!.version, 2, 'retry should not increment version')

  // 3. 版本落后：晚到的修改进入冲突待处理，不覆盖台账
  const opNo2 = crypto.randomUUID()
  res = await review('A11Y-1074', { result: '已退回', note: '晚到的修改', environment: 'Firefox', opNo: opNo2, baseVersion: 1 })
  assert.equal(res.status, 409, 'late version should conflict')
  const conflictBody = (await res.json()) as { conflict: Record<string, unknown> }
  assert.ok(conflictBody.conflict, 'should return conflict')
  assert.equal(conflictBody.conflict.currentVersion, 2)
  issue = await getIssue('A11Y-1074')
  assert.equal(issue!.status, '已通过', 'conflict should not overwrite status')
  assert.equal((issue!.retestRecords as unknown[]).length, 1, 'conflict should not append record')

  // 4. 冲突字段列出当前值与本次值
  const fields = conflictBody.conflict.fields as Array<Record<string, string>>
  const statusField = fields.find((f) => f.key === 'status')!
  assert.equal(statusField.current, '已通过')
  assert.equal(statusField.proposed, '已退回')

  // 5. 逐字段采用后按原操作号写入
  const conflictId = conflictBody.conflict.id as string
  res = await fetch(`${BASE}/api/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opNo: opNo2, adoptedFields: ['status', 'retestRecords'] }),
  })
  assert.equal(res.status, 200)
  issue = await getIssue('A11Y-1074')
  assert.equal(issue!.status, '已退回', 'adopted status should be applied')
  assert.equal((issue!.retestRecords as unknown[]).length, 2, 'adopted retest record should be appended')
  assert.equal(issue!.version, 3)

  // 6. 确认写入重试：同操作号幂等，不重复追加
  res = await fetch(`${BASE}/api/conflicts/${conflictId}/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opNo: opNo2, adoptedFields: ['status', 'retestRecords'] }),
  })
  assert.equal(res.status, 200)
  issue = await getIssue('A11Y-1074')
  assert.equal((issue!.retestRecords as unknown[]).length, 2, 'resolve retry should not duplicate')

  // 7. 批量分配：部分冲突，未冲突的正常写入，冲突的不覆盖
  const opNo3 = crypto.randomUUID()
  await review('A11Y-1061', { result: '已通过', note: '先更新', environment: 'Chrome', opNo: opNo3, baseVersion: 1 })
  const opNo4 = crypto.randomUUID()
  res = await fetch(`${BASE}/api/issues/bulk-assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keys: ['A11Y-1048', 'A11Y-1061'], team: '新团队', owner: '新负责人', dueDate: '2026-11-01', priority: 'P1', opNo: opNo4, baseVersions: { 'A11Y-1048': 1, 'A11Y-1061': 1 } }),
  })
  assert.equal(res.status, 200)
  const bulkBody = (await res.json()) as { updated: number; conflicts: Array<Record<string, unknown>> }
  assert.equal(bulkBody.updated, 1, 'one applied')
  assert.equal(bulkBody.conflicts.length, 1, 'one conflict')
  assert.equal(bulkBody.conflicts[0].issueKey, 'A11Y-1061')
  issue = await getIssue('A11Y-1048')
  assert.equal(issue!.team, '新团队', 'applied issue updated')
  issue = await getIssue('A11Y-1061')
  assert.equal(issue!.team, '结算体验组', 'conflicted issue not overwritten')

  // 8. 模拟断网：首次处理后返回 500，重试按操作号幂等，记录不重复
  await fetch(`${BASE}/api/dev/arm-failure`, { method: 'POST' })
  const opNo5 = crypto.randomUUID()
  res = await review('A11Y-1083', { result: '已通过', note: '断网测试', environment: 'Chrome', opNo: opNo5, baseVersion: 1 })
  assert.equal(res.status, 500, 'armed failure returns 500')
  issue = await getIssue('A11Y-1083')
  assert.equal((issue!.retestRecords as unknown[]).length, 2, 'record appended once despite 500')
  res = await review('A11Y-1083', { result: '已通过', note: '断网测试', environment: 'Chrome', opNo: opNo5, baseVersion: 1 })
  assert.equal(res.status, 200)
  issue = await getIssue('A11Y-1083')
  assert.equal((issue!.retestRecords as unknown[]).length, 2, 'retry after 500 does not duplicate')

  server.close()
  console.log('All concurrency tests passed!')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
