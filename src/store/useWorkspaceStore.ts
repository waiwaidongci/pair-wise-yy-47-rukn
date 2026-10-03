import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ConflictRecord, Issue, RetestRecord } from '../api/types'
import { seedIssues } from '../api/seed'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

type WorkspaceState = {
  issues: Issue[]
  conflicts: ConflictRecord[]
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  mergeKeys: string[]
  setIssues: (issues: Issue[]) => void
  setConflicts: (conflicts: ConflictRecord[]) => void
  addConflicts: (conflicts: ConflictRecord[]) => void
  markConflictResolved: (conflictId: string, resolved?: ConflictRecord) => void
  discardConflict: (conflictId: string) => void
  /** 服务端未留存冲突（如刷新后）时，按原操作号在本地写入采纳字段 */
  resolveConflictLocal: (conflictId: string, adoptedFields: string[]) => void
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  mergeIssues: (keys: string[]) => void
  updateIssue: (issue: Issue) => void
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      issues: structuredClone(seedIssues),
      conflicts: [],
      selectedKeys: [],
      savedFilters: [
        { id: 'f1', name: 'P0/P1 未关闭', query: '', site: '', status: '', priority: 'P0' },
        { id: 'f2', name: '基础组件组待复测', query: '基础组件', site: '', status: '待复测', priority: '' },
      ],
      draft: 'A11Y-1048：需同时验证 Esc 关闭与 Tab/Shift+Tab 环绕顺序，移动端抽屉也需复测。',
      mergeKeys: [],
      setIssues: (issues) => set({ issues }),
      setConflicts: (conflicts) => set({ conflicts }),
      addConflicts: (incoming) =>
        set((state) => {
          const ids = new Set(state.conflicts.map((item) => item.id))
          const merged = [...state.conflicts]
          for (const conflict of incoming) {
            if (!ids.has(conflict.id)) merged.push(conflict)
          }
          return { conflicts: merged }
        }),
      markConflictResolved: (conflictId, resolved) =>
        set((state) => ({
          conflicts: state.conflicts.map((item) =>
            item.id === conflictId ? { ...item, status: '已确认', resolvedAt: resolved?.resolvedAt ?? item.resolvedAt ?? '刚刚' } : item,
          ),
        })),
      discardConflict: (conflictId) =>
        set((state) => ({
          conflicts: state.conflicts.map((item) => (item.id === conflictId ? { ...item, status: '已放弃' } : item)),
        })),
      resolveConflictLocal: (conflictId, adoptedFields) =>
        set((state) => {
          const conflict = state.conflicts.find((item) => item.id === conflictId)
          if (!conflict) return state
          const adopted = new Set(adoptedFields)
          const issues = state.issues.map((issue) => {
            if (issue.key !== conflict.issueKey) return issue
            const proposed = conflict.proposed
            const next: Issue = { ...issue }
            if (adopted.has('status')) next.status = proposed.status as Issue['status']
            if (adopted.has('team')) next.team = proposed.team as string
            if (adopted.has('owner')) next.owner = proposed.owner as string
            if (adopted.has('priority')) next.priority = proposed.priority as Issue['priority']
            if (adopted.has('dueDate')) next.dueDate = proposed.dueDate as string
            if (adopted.has('retestEnv')) next.retestEnv = proposed.retestEnv as string
            if (adopted.has('retestRecords') && proposed.retestRecord) {
              const rec = proposed.retestRecord as RetestRecord
              if (!next.retestRecords.some((item) => item.id === rec.id || item.opNo === conflict.opNo)) {
                next.retestRecords = [...next.retestRecords, rec]
              }
            }
            next.version = (typeof issue.version === 'number' ? issue.version : 0) + 1
            next.history = [...issue.history, { at: '刚刚', actor: '当前用户', action: '冲突确认', detail: `按操作号 ${conflict.opNo.slice(0, 8)} 采纳 ${adopted.size} 项字段` }]
            return next
          })
          return {
            issues,
            conflicts: state.conflicts.map((item) => (item.id === conflictId ? { ...item, status: '已确认', resolvedAt: '刚刚' } : item)),
          }
        }),
      setSelectedKeys: (selectedKeys) => set({ selectedKeys }),
      saveFilter: (filter) => set((state) => ({ savedFilters: [...state.savedFilters, { ...filter, id: crypto.randomUUID() }] })),
      removeFilter: (id) => set((state) => ({ savedFilters: state.savedFilters.filter((item) => item.id !== id) })),
      setDraft: (draft) => set({ draft }),
      mergeIssues: (keys) =>
        set((state) => {
          const primary = state.issues.find((issue) => issue.key === keys[0])
          if (!primary) return state
          return {
            issues: state.issues.map((issue) =>
              keys.includes(issue.key)
                ? {
                    ...issue,
                    rootCause: primary.rootCause,
                    status: issue.key === primary.key ? issue.status : '不适用',
                    mergedKeys: issue.key === primary.key ? keys.slice(1) : [primary.key],
                    version: (typeof issue.version === 'number' ? issue.version : 0) + 1,
                    history: [...issue.history, { at: '刚刚', actor: '当前用户', action: '重复问题合并', detail: `合并至 ${primary.key}` }],
                  }
                : issue,
            ),
            selectedKeys: [],
          }
        }),
      updateIssue: (updated) => set((state) => ({ issues: state.issues.map((issue) => (issue.key === updated.key ? updated : issue)) })),
    }),
    {
      name: 'accessibility-remediation-v2',
      version: 2,
    },
  ),
)
