export type IssueStatus = '待分配' | '修复中' | '待复测' | '已通过' | '已退回' | '不适用'

export type RetestRecord = { id: string; actor: string; result: string; note: string; at: string; opNo?: string }
export type HistoryEvent = { at: string; actor: string; action: string; detail: string }

export type Issue = {
  key: string
  title: string
  site: string
  /** 产品版本号（如 v4.18），用于台账「站点 / 版本」展示 */
  productVersion: string
  /** 台账版本号，从 1 开始；旧数据可能缺失，首次带版本号提交即生效 */
  version: number
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
  retestRecords: RetestRecord[]
  history: HistoryEvent[]
}

/** 冲突可逐字段采用的字段键 */
export type ConflictFieldKey = 'status' | 'team' | 'owner' | 'priority' | 'dueDate' | 'retestEnv' | 'retestRecords'

export type ConflictField = {
  key: ConflictFieldKey
  label: string
  current: string
  proposed: string
  adopt: boolean
}

export type ConflictSource = '复测' | '批量分配'

/** 版本落后进入的冲突待处理记录 */
export type ConflictRecord = {
  id: string
  /** 原操作号，确认写入时沿用，保证重试幂等 */
  opNo: string
  issueKey: string
  baseVersion: number
  currentVersion: number
  source: ConflictSource
  submittedAt: string
  actor: string
  status: '待处理' | '已确认' | '已放弃'
  fields: ConflictField[]
  /** 本次提交的原始值，确认时按采用字段写入 */
  proposed: Record<string, unknown>
  resolvedAt?: string
}
