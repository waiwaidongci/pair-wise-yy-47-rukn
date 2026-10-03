export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

export type RetestResult = '已通过' | '已退回' | '不适用'

export type Issue = {
  key: string
  title: string
  site: string
  version: string
  /** 问题版本号（乐观锁）。rev=0 表示旧数据尚未接入版本控制，首次带版本号提交后生效。 */
  rev: number
  wcag: string[]
  issueType: string
  impact: '致命' | '严重' | '中等' | '轻微'
  affected: string
  reproduction: string
  evidence: string
  rootCause: string
  status: IssueStatus
  priority: 'P0' | 'P1' | 'P2' | 'P3'
  team: string
  owner: string
  dueDate: string
  mergedKeys: string[]
  fixNote?: string
  retestEnv?: string
  retestRecords: Array<{ id: string; actor: string; result: string; note: string; at: string }>
  history: Array<{ at: string; actor: string; action: string; detail: string }>
}

/** 台账字段修改（编辑提交） */
export type IssuePatch = {
  status?: IssueStatus
  team?: string
  owner?: string
}

/** 复测提交 */
export type RetestPayload = {
  retest: { result: RetestResult; note: string; environment: string }
}

export type ChangeKind = '编辑' | '复测'

/** /api/changes 请求体：问题版本 baseRev + 操作号 opId */
export type ChangeRequest = {
  key: string
  opId: string
  baseRev: number
  actor?: string
  patch?: IssuePatch
  retest?: { result: RetestResult; note: string; environment: string }
}

export const CONFLICT_FIELDS = ['status', 'team', 'owner', 'retest'] as const
export type ConflictField = (typeof CONFLICT_FIELDS)[number]

export const FIELD_LABELS: Record<ConflictField, string> = {
  status: '状态',
  team: '团队',
  owner: '负责人',
  retest: '复测记录',
}

export type FieldConflict = {
  field: ConflictField
  /** 服务器当前值 */
  current: string
  /** 本次（落后版本）提交值 */
  incoming: string
  /** 复测场景下当前复测记录的说明（环境 / 记录），仅 retest 字段存在 */
  currentDetail?: string
  incomingDetail?: string
}

export type Conflict = {
  id: string
  key: string
  opId: string
  kind: ChangeKind
  actor: string
  at: string
  /** 产生冲突时落后的问题版本 */
  baseRev: number
  /** 审核员提交时基于的旧值（用于逐字段对照） */
  snapshot: IssuePatch & { retestResult?: RetestResult; retestNote?: string; retestEnv?: string }
  fields: FieldConflict[]
  /** 审核员逐字段选择：current=采用当前值，incoming=采用本次值 */
  resolution?: Partial<Record<ConflictField, 'current' | 'incoming'>>
  resolvedAt?: string
  /** 解决时写入所用的问题版本（解决操作本身也会推进一个版本） */
  resolvedRev?: number
}

export type ChangeResponse =
  | { outcome: 'applied'; issue: Issue; rev: number; opId: string; replay?: boolean }
  | { outcome: 'replayed'; issue: Issue; rev: number; opId: string; replay: true }
  | { outcome: 'conflict'; conflict: Conflict }
  | { outcome: 'legacy'; message: string }
