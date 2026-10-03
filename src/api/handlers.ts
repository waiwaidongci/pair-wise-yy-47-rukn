import { http, HttpResponse } from 'msw'
import { seedIssues } from './seed'
import type { ConflictRecord, Issue, RetestRecord } from './types'

let issues: Issue[] = structuredClone(seedIssues)

/**
 * 已处理操作号：opNo -> 首次处理结果。
 * 断网重试时沿用首次结果，复测记录不重复追加。
 */
type ProcessedResult = {
  issue?: Issue
  updated?: number
  conflict?: ConflictRecord
  conflicts?: ConflictRecord[]
  changed?: Issue[]
  resolved?: boolean
}
const processedOps = new Map<string, ProcessedResult>()

/** 冲突待处理台账 */
let conflicts: ConflictRecord[] = []

/** 模拟断网：下一次写操作在处理完成后返回 500（响应丢失），客户端重试时按 opNo 幂等返回 */
let armFailureOnce = false

const now = () => '刚刚'
const actor = '当前用户'

/**
 * 版本判断（乐观并发）。
 * 旧数据（无 version）首次提交带版本号即生效；否则以 baseVersion 与当前版本比对，
 * baseVersion 落后则判为冲突。
 */
function checkVersion(issue: Issue, baseVersion: number | undefined): 'ok' | 'conflict' {
  if (typeof issue.version !== 'number') return 'ok'
  if (baseVersion == null) return 'ok'
  if (baseVersion < issue.version) return 'conflict'
  return 'ok'
}

function bumpVersion(issue: Issue) {
  issue.version = (typeof issue.version === 'number' ? issue.version : 0) + 1
}

function conflictFieldsForReview(issue: Issue, body: { result: string; note: string; environment: string }) {
  return [
    { key: 'status' as const, label: '状态', current: issue.status, proposed: body.result, adopt: true },
    { key: 'retestEnv' as const, label: '复测环境', current: issue.retestEnv ?? '（未填写）', proposed: body.environment, adopt: true },
    { key: 'retestRecords' as const, label: '复测记录', current: `已有 ${issue.retestRecords.length} 条记录`, proposed: `新增 1 条：${body.result} · ${body.note}`, adopt: true },
  ]
}

function conflictFieldsForAssign(issue: Issue, body: { team: string; owner: string; priority: string; dueDate: string }) {
  return [
    { key: 'team' as const, label: '团队', current: issue.team, proposed: body.team, adopt: true },
    { key: 'owner' as const, label: '负责人', current: issue.owner, proposed: body.owner, adopt: true },
    { key: 'priority' as const, label: '优先级', current: issue.priority, proposed: body.priority, adopt: true },
    { key: 'dueDate' as const, label: '截止日期', current: issue.dueDate, proposed: body.dueDate, adopt: true },
    { key: 'status' as const, label: '状态', current: issue.status, proposed: '修复中', adopt: true },
  ]
}

export function createHandlers(base = '') {
  return [
  http.get(`${base}/api/issues`, ({ request }) => {
    const url = new URL(request.url)
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const status = url.searchParams.get('status') ?? ''
    const site = url.searchParams.get('site') ?? ''
    const filtered = issues.filter((issue) => (!query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(query)) && (!status || issue.status === status) && (!site || issue.site === site))
    return HttpResponse.json(filtered)
  }),

  http.post(`${base}/api/issues/:key/review`, async ({ params, request }) => {
    const issue = issues.find((item) => item.key === params.key)
    if (!issue) return new HttpResponse(null, { status: 404 })
    const body = (await request.json()) as { result: string; note: string; environment: string; opNo: string; baseVersion: number }
    const opNo = body.opNo

    // 幂等：同一操作号重试，沿用首次结果，不重复追加复测记录
    if (processedOps.has(opNo)) {
      const first = processedOps.get(opNo)!
      if (first.conflict) return HttpResponse.json({ conflict: first.conflict }, { status: 409 })
      return HttpResponse.json(first.issue)
    }

    if (checkVersion(issue, body.baseVersion) === 'conflict') {
      const conflict: ConflictRecord = {
        id: `CF-${Date.now()}`,
        opNo,
        issueKey: issue.key,
        baseVersion: body.baseVersion,
        currentVersion: issue.version,
        source: '复测',
        submittedAt: now(),
        actor,
        status: '待处理',
        fields: conflictFieldsForReview(issue, body),
        proposed: {
          status: body.result,
          retestEnv: body.environment,
          retestRecord: { id: `RT-${Date.now()}`, actor, result: body.result, note: body.note, at: now(), opNo },
        },
      }
      conflicts = [...conflicts, conflict]
      processedOps.set(opNo, { issue, conflict })
      if (armFailureOnce) {
        armFailureOnce = false
        return HttpResponse.json({ error: 'network', conflict }, { status: 500 })
      }
      return HttpResponse.json({ conflict }, { status: 409 })
    }

    // 正常写入
    issue.status = body.result as Issue['status']
    issue.retestEnv = body.environment
    issue.retestRecords.push({ id: `RT-${Date.now()}`, actor, result: body.result, note: body.note, at: now(), opNo })
    issue.history.push({ at: now(), actor, action: `复测${body.result}`, detail: `${body.note}（操作号 ${opNo.slice(0, 8)}）` })
    bumpVersion(issue)
    processedOps.set(opNo, { issue })

    if (armFailureOnce) {
      armFailureOnce = false
      return HttpResponse.json({ error: 'network' }, { status: 500 })
    }
    return HttpResponse.json(issue)
  }),

  http.post(`${base}/api/issues/bulk-assign`, async ({ request }) => {
    const body = (await request.json()) as { keys: string[]; team: string; owner: string; dueDate: string; priority: string; opNo: string; baseVersions: Record<string, number> }
    const opNo = body.opNo

    // 幂等：同一操作号重试，沿用首次结果
    if (processedOps.has(opNo)) {
      const first = processedOps.get(opNo)!
      return HttpResponse.json({ updated: first.updated, conflicts: first.conflicts ?? [], changed: first.changed ?? [] })
    }

    const newConflicts: ConflictRecord[] = []
    const changed: Issue[] = []
    for (const key of body.keys) {
      const issue = issues.find((item) => item.key === key)
      if (!issue) continue
      const baseVersion = body.baseVersions?.[key]
      if (checkVersion(issue, baseVersion) === 'conflict') {
        newConflicts.push({
          id: `CF-${Date.now()}-${key}`,
          opNo,
          issueKey: key,
          baseVersion: baseVersion as number,
          currentVersion: issue.version,
          source: '批量分配',
          submittedAt: now(),
          actor,
          status: '待处理',
          fields: conflictFieldsForAssign(issue, body),
          proposed: { team: body.team, owner: body.owner, priority: body.priority, dueDate: body.dueDate, status: '修复中' },
        })
        continue
      }
      issue.team = body.team
      issue.owner = body.owner
      issue.dueDate = body.dueDate
      issue.priority = body.priority as Issue['priority']
      issue.status = '修复中'
      issue.history.push({ at: now(), actor, action: '批量分配', detail: `指派至 ${body.team} / ${body.owner}（操作号 ${opNo.slice(0, 8)}）` })
      bumpVersion(issue)
      changed.push(issue)
    }

    conflicts = [...conflicts, ...newConflicts]
    const result: ProcessedResult = { updated: changed.length, conflicts: newConflicts, changed }
    processedOps.set(opNo, result)

    if (armFailureOnce) {
      armFailureOnce = false
      return HttpResponse.json({ error: 'network', conflicts: newConflicts }, { status: 500 })
    }
    return HttpResponse.json({ updated: changed.length, conflicts: newConflicts, changed })
  }),

  http.get(`${base}/api/conflicts`, () => {
    return HttpResponse.json(conflicts)
  }),

  http.post(`${base}/api/conflicts/:id/resolve`, async ({ params, request }) => {
    const body = (await request.json()) as { opNo: string; adoptedFields: string[] }
    const conflict = conflicts.find((item) => item.id === params.id)
    if (!conflict) return new HttpResponse(null, { status: 404 })

    // 幂等：按原操作号写入，断网重试沿用首次结果
    if (processedOps.has(body.opNo) && processedOps.get(body.opNo)!.resolved) {
      const first = processedOps.get(body.opNo)!
      return HttpResponse.json({ issue: first.issue, conflict: first.conflict })
    }

    const issue = issues.find((item) => item.key === conflict.issueKey)
    const adopted = new Set(body.adoptedFields)
    if (issue) {
      const proposed = conflict.proposed
      if (adopted.has('status')) issue.status = proposed.status as Issue['status']
      if (adopted.has('team')) issue.team = proposed.team as string
      if (adopted.has('owner')) issue.owner = proposed.owner as string
      if (adopted.has('priority')) issue.priority = proposed.priority as Issue['priority']
      if (adopted.has('dueDate')) issue.dueDate = proposed.dueDate as string
      if (adopted.has('retestEnv')) issue.retestEnv = proposed.retestEnv as string
      if (adopted.has('retestRecords') && proposed.retestRecord) {
        const rec = proposed.retestRecord as RetestRecord
        if (!issue.retestRecords.some((item) => item.id === rec.id || item.opNo === body.opNo)) {
          issue.retestRecords.push(rec)
        }
      }
      issue.history.push({ at: now(), actor, action: '冲突确认', detail: `按操作号 ${body.opNo.slice(0, 8)} 采纳 ${adopted.size} 项字段` })
      bumpVersion(issue)
    }

    conflict.status = '已确认'
    conflict.resolvedAt = now()
    processedOps.set(body.opNo, { issue, conflict, resolved: true })

    if (armFailureOnce) {
      armFailureOnce = false
      return HttpResponse.json({ error: 'network' }, { status: 500 })
    }
    return HttpResponse.json({ issue, conflict })
  }),

  http.post(`${base}/api/conflicts/:id/discard`, async ({ params }) => {
    const conflict = conflicts.find((item) => item.id === params.id)
    if (!conflict) return new HttpResponse(null, { status: 404 })
    conflict.status = '已放弃'
    return HttpResponse.json({ conflict })
  }),

  // 开发辅助：模拟下一次写操作断网（响应丢失），用于验证重试幂等
  http.post(`${base}/api/dev/arm-failure`, async () => {
    armFailureOnce = true
    return HttpResponse.json({ armed: true })
  }),
  ]
}

export { issues }
