import type { Conflict, Issue } from './types'

/**
 * 正式统计只认未冲突台账：
 * 只要某问题存在未解决的冲突待处理，它就暂时移出统计口径，
 * 由冲突待处理数量另行提示，避免晚到修改影响团队/状态/记录的统计结果。
 */
export const openConflicts = (conflicts: Conflict[]) => conflicts.filter((item) => !item.resolvedAt)

export const conflictedKeys = (conflicts: Conflict[]) => new Set(openConflicts(conflicts).map((item) => item.key))

export const officialIssues = (issues: Issue[], conflicts: Conflict[]) => {
  const blocked = conflictedKeys(conflicts)
  return issues.filter((issue) => !blocked.has(issue.key))
}

export const findIssue = (issues: Issue[], key: string) => issues.find((issue) => issue.key === key)
