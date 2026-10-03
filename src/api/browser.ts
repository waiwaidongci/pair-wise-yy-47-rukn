import { setupWorker } from 'msw/browser'
import { http, HttpResponse } from 'msw'
import { seedIssues } from './seed'
import { FIELD_LABELS } from './types'
import type {
  ChangeRequest,
  Conflict,
  FieldConflict,
  Issue,
  IssuePatch,
} from './types'

const ACTOR = '当前用户'
const now = () => '刚刚'
const rid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
const shortOp = (opId: string) => opId.slice(0, 8)

let issues = structuredClone(seedIssues)

/** 冲突待处理（未解决与已解决都保留，台账正式统计只认未冲突项） */
let conflicts: Conflict[] = []

/**
 * 已处理操作号 -> 首次处理结果。
 * 断网重试时按原操作号命中，直接回放首次结果：
 * 已写入的回放写入后的问题（复测记录不会重复追加），已挂起冲突的回放同一冲突。
 */
let processedOps: Record<string, { type: 'applied'; issue: Issue } | { type: 'conflict'; conflict: Conflict }> = {}

/** 断网模拟开关（由布局右下角的同步卡片切换），开启后所有写入请求直接网络失败 */
let offline = false
try {
  offline = localStorage.getItem('a11y-offline') === '1'
} catch {
  offline = false
}
globalThis.__setA11yOffline = (value: boolean) => {
  offline = value
}

const networkGate = () => (offline ? HttpResponse.error() : null)

/** 比较本次提交值与服务器当前值，只收集真正不一致的字段，供逐字段采用 */
function buildFieldConflicts(issue: Issue, req: ChangeRequest): FieldConflict[] {
  const fields: FieldConflict[] = []
  if (req.patch) {
    ;(['status', 'team', 'owner'] as const).forEach((field) => {
      const incoming = req.patch?.[field]
      if (incoming !== undefined && incoming !== issue[field]) {
        fields.push({ field, current: String(issue[field]), incoming: String(incoming) })
      }
    })
  }
  if (req.retest) {
    const latest = issue.retestRecords[issue.retestRecords.length - 1]
    const sameRecord = Boolean(
      latest &&
        latest.result === req.retest.result &&
        latest.note === req.retest.note &&
        issue.retestEnv === req.retest.environment,
    )
    if (!sameRecord && (issue.status !== req.retest.result || !latest || latest.note !== req.retest.note)) {
      fields.push({
        field: 'retest',
        current: latest ? `${latest.result}（当前状态：${issue.status}）` : `无复测记录（当前状态：${issue.status}）`,
        incoming: `${req.retest.result}（本次提交）`,
        currentDetail: latest
          ? `环境：${issue.retestEnv ?? '未记录'}｜${latest.note}（${latest.actor}）`
          : `当前状态 ${issue.status}，尚无复测记录`,
        incomingDetail: `环境：${req.retest.environment}｜${req.retest.note}`,
      })
    }
  }
  return fields
}

type ProcessInput = ChangeRequest & {
  /** 批量分配附带的、不进入冲突对照的字段 */
  extras?: { priority?: Issue['priority']; dueDate?: string }
}

type ProcessResult =
  | { outcome: 'applied'; issue: Issue; replay: boolean }
  | { outcome: 'conflict'; conflict: Conflict; replay: boolean }

function processChange(req: ProcessInput): ProcessResult {
  const replayed = processedOps[req.opId]
  if (replayed?.type === 'applied') return { outcome: 'applied', issue: structuredClone(replayed.issue), replay: true }
  if (replayed?.type === 'conflict') return { outcome: 'conflict', conflict: structuredClone(replayed.conflict), replay: true }

  const issue = issues.find((item) => item.key === req.key)
  if (!issue) return new Response(null, { status: 404 }) as never
  const actor = req.actor ?? ACTOR

  const applyDirect = (): Issue => {
    const history = [...issue.history]
    let retestRecords = issue.retestRecords
    let retestEnv = issue.retestEnv

    if (req.retest) {
      const latest = retestRecords[retestRecords.length - 1]
      const sameRecord = Boolean(
        latest &&
          latest.result === req.retest!.result &&
          latest.note === req.retest!.note &&
          retestEnv === req.retest!.environment,
      )
      // 同内容复测不重复追加记录（幂等保护的第二道防线）
      retestRecords = sameRecord
        ? retestRecords
        : [...retestRecords, { id: rid('RT'), actor, result: req.retest.result, note: req.retest.note, at: now() }]
      retestEnv = req.retest.environment
      history.push({
        at: now(),
        actor,
        action: `复测${req.retest.result}`,
        detail: sameRecord
          ? `与最新复测记录一致，沿用首次结果（操作号 ${shortOp(req.opId)}）`
          : `${req.retest.note}（操作号 ${shortOp(req.opId)}）`,
      })
    }
    if (req.patch) {
      const changed = (['status', 'team', 'owner'] as const).filter(
        (field) => req.patch![field] !== undefined && req.patch![field] !== issue[field],
      )
      history.push({
        at: now(),
        actor,
        action: '问题编辑',
        detail: changed.length
          ? `更新 ${changed.map((field) => FIELD_LABELS[field]).join('、')}（操作号 ${shortOp(req.opId)}）`
          : `内容与当前值一致（操作号 ${shortOp(req.opId)}）`,
      })
    }

    const updated: Issue = {
      ...issue,
      ...(req.extras ?? {}),
      ...(req.patch ?? {}),
      ...(req.retest ? { status: req.retest.result } : {}),
      retestEnv,
      retestRecords,
      history,
      // 旧数据 rev=0：首次带版本号（baseRev=0）提交即在本版本生效，版本推进到 1
      rev: issue.rev + 1,
    }
    issues = issues.map((item) => (item.key === issue.key ? updated : item))
    processedOps[req.opId] = { type: 'applied', issue: structuredClone(updated) }
    return updated
  }

  const stale = req.baseRev !== issue.rev
  const differing = stale ? buildFieldConflicts(issue, req) : []

  if (stale && differing.length > 0) {
    // 版本落后且会盖掉他人改动：挂入冲突待处理，不修改台账
    const existingOpen = conflicts.find((item) => item.opId === req.opId && !item.resolvedAt)
    if (existingOpen) return { outcome: 'conflict', conflict: structuredClone(existingOpen), replay: false }

    const conflict: Conflict = {
      id: rid('CF'),
      key: issue.key,
      opId: req.opId,
      kind: req.retest ? '复测' : '编辑',
      actor,
      at: now(),
      baseRev: req.baseRev,
      snapshot: {
        ...(req.patch ?? {}),
        ...(req.retest
          ? { status: req.retest.result, retestResult: req.retest.result, retestNote: req.retest.note, retestEnv: req.retest.environment }
          : {}),
      },
      fields: differing,
    }
    conflicts = [...conflicts, conflict]
    processedOps[req.opId] = { type: 'conflict', conflict: structuredClone(conflict) }
    return { outcome: 'conflict', conflict, replay: false }
  }

  // 版本落后但本次值与当前值已无差异，不会覆盖任何字段，正常写入
  return { outcome: 'applied', issue: applyDirect(), replay: false }
}

export const worker = setupWorker(
  http.get('/api/issues', ({ request }) => {
    const url = new URL(request.url)
    const query = url.searchParams.get('query')?.toLowerCase() ?? ''
    const status = url.searchParams.get('status') ?? ''
    const site = url.searchParams.get('site') ?? ''
    const filtered = issues.filter(
      (issue) =>
        (!query || `${issue.key}${issue.title}${issue.rootCause}`.toLowerCase().includes(query)) &&
        (!status || issue.status === status) &&
        (!site || issue.site === site),
    )
    return HttpResponse.json(filtered)
  }),

  http.get('/api/conflicts', () => HttpResponse.json(conflicts)),

  http.post('/api/changes', async ({ request }) => {
    const failed = networkGate()
    if (failed) return failed
    let req: ProcessInput
    try {
      req = (await request.json()) as ProcessInput
    } catch {
      return new HttpResponse(null, { status: 400 })
    }
    if (!req.key || !req.opId || typeof req.baseRev !== 'number') {
      // 未带问题版本号 / 操作号：拒绝写入，提示先取最新版本
      return HttpResponse.json({ message: '提交缺少问题版本号或操作号，请刷新台账后重试。' }, { status: 428 })
    }
    const result = processChange(req)
    if (result.outcome === 'conflict') {
      return HttpResponse.json({ outcome: 'conflict', conflict: result.conflict }, { status: 409 })
    }
    return HttpResponse.json({
      outcome: 'applied',
      issue: result.issue,
      rev: result.issue.rev,
      opId: req.opId,
      replay: result.replay,
    })
  }),

  http.post('/api/conflicts/:id/resolve', async ({ params, request }) => {
    const failed = networkGate()
    if (failed) return failed
    const conflict = conflicts.find((item) => item.id === params.id)
    if (!conflict) return new HttpResponse(null, { status: 404 })
    if (conflict.resolvedAt) {
      const done = processedOps[conflict.opId]
      if (done?.type === 'applied') {
        return HttpResponse.json({ outcome: 'replayed', issue: done.issue, rev: done.issue.rev, opId: conflict.opId, replay: true })
      }
      return HttpResponse.json({ outcome: 'conflict', conflict }, { status: 409 })
    }

    const body = (await request.json()) as { resolution: NonNullable<Conflict['resolution']>; actor?: string }
    const issue = issues.find((item) => item.key === conflict.key)
    if (!issue) return new HttpResponse(null, { status: 404 })
    const actor = body.actor ?? ACTOR

    const adoptIncoming = (field: FieldConflict['field']) => body.resolution[field] === 'incoming'
    const patch: IssuePatch = {}
    ;(['status', 'team', 'owner'] as const).forEach((field) => {
      const value = conflict.snapshot[field]
      if (adoptIncoming(field) && value !== undefined) (patch as Record<string, unknown>)[field] = value
    })

    const history = [...issue.history]
    let retestRecords = issue.retestRecords
    let retestEnv = issue.retestEnv
    let status = issue.status
    let retestAdopted = false

    if (conflict.fields.some((item) => item.field === 'retest')) {
      if (adoptIncoming('retest')) {
        // 采用本次复测：按原操作号只追加这一条复测记录
        retestAdopted = true
        retestRecords = [
          ...retestRecords,
          {
            id: rid('RT'),
            actor: conflict.actor,
            result: conflict.snapshot.retestResult ?? '已退回',
            note: conflict.snapshot.retestNote ?? '',
            at: now(),
          },
        ]
        retestEnv = conflict.snapshot.retestEnv
        status = (conflict.snapshot.status as Issue['status']) ?? issue.status
        history.push({
          at: now(),
          actor,
          action: '冲突解决',
          detail: `复测采用本次值（原操作号 ${shortOp(conflict.opId)}）：${conflict.snapshot.retestNote ?? ''}`,
        })
      } else {
        history.push({
          at: now(),
          actor,
          action: '冲突解决',
          detail: `复测采用当前值，本次复测不写入（原操作号 ${shortOp(conflict.opId)}）`,
        })
      }
    }
    const adoptedEdit = (['status', 'team', 'owner'] as const).filter((field) => adoptIncoming(field))
    if (adoptedEdit.length) {
      history.push({
        at: now(),
        actor,
        action: '冲突解决',
        detail: `${adoptedEdit.map((field) => FIELD_LABELS[field]).join('、')}采用本次值（原操作号 ${shortOp(conflict.opId)}）`,
      })
    }

    const updated: Issue = {
      ...issue,
      ...patch,
      status: retestAdopted ? status : patch.status ?? issue.status,
      retestEnv,
      retestRecords,
      history,
      rev: issue.rev + 1,
    }
    issues = issues.map((item) => (item.key === issue.key ? updated : item))

    conflicts = conflicts.map((item) =>
      item.id === conflict.id ? { ...item, resolution: body.resolution, resolvedAt: now(), resolvedRev: updated.rev } : item,
    )
    // 关键：原操作号此后一律回放本次解决结果，重试不再重复写入、不重复追加复测记录
    processedOps[conflict.opId] = { type: 'applied', issue: structuredClone(updated) }

    return HttpResponse.json({ outcome: 'applied', issue: updated, rev: updated.rev, opId: conflict.opId })
  }),

  http.post('/api/issues/bulk-assign', async ({ request }) => {
    const failed = networkGate()
    if (failed) return failed
    const body = (await request.json()) as {
      opId: string
      keys: string[]
      team: string
      owner: string
      dueDate: string
      priority: Issue['priority']
      revs?: Record<string, number>
    }
    let updated = 0
    let conflicted = 0
    const conflictIds: string[] = []
    body.keys.forEach((key) => {
      const result = processChange({
        opId: `${body.opId}:${key}`,
        key,
        baseRev: body.revs?.[key] ?? 0,
        patch: { team: body.team, owner: body.owner, status: '修复中' },
        extras: { priority: body.priority, dueDate: body.dueDate },
      })
      if (result.outcome === 'applied') updated += 1
      else {
        conflicted += 1
        conflictIds.push(result.conflict.id)
      }
    })
    return HttpResponse.json({ updated, conflicted, conflictIds })
  }),
)

export { issues }

declare global {
  // eslint-disable-next-line no-var
  var __setA11yOffline: ((value: boolean) => void) | undefined
}
