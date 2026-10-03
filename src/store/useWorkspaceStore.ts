import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { Conflict, Issue } from '../api/types'
import { seedIssues } from '../api/seed'

type SavedFilter = { id: string; name: string; query: string; site: string; status: string; priority: string }

type WorkspaceState = {
  issues: Issue[]
  conflicts: Conflict[]
  selectedKeys: string[]
  savedFilters: SavedFilter[]
  draft: string
  mergeKeys: string[]
  setIssues: (issues: Issue[]) => void
  setConflicts: (conflicts: Conflict[]) => void
  setSelectedKeys: (keys: string[]) => void
  saveFilter: (filter: Omit<SavedFilter, 'id'>) => void
  removeFilter: (id: string) => void
  setDraft: (draft: string) => void
  mergeIssues: (keys: string[]) => void
  updateIssue: (issue: Issue) => void
}

/** 旧持久化数据迁移：rev=0 表示旧数据尚未接入版本控制，首次带版本号提交后生效 */
const migrateLegacyIssues = (issues: unknown): Issue[] =>
  Array.isArray(issues)
    ? (issues as Issue[]).map((issue) => ({ ...issue, rev: typeof issue.rev === 'number' ? issue.rev : 0 }))
    : structuredClone(seedIssues)

const migrationStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw)
      if (parsed?.state?.issues) parsed.state.issues = migrateLegacyIssues(parsed.state.issues)
      if (!('conflicts' in (parsed.state ?? {}))) parsed.state = { ...parsed.state, conflicts: [] }
      return JSON.stringify(parsed)
    } catch {
      return raw
    }
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
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
      name: 'accessibility-remediation-v1',
      version: 2,
      storage: createJSONStorage(() => migrationStorage),
      migrate: (persisted) => {
        const state = (persisted ?? {}) as Partial<WorkspaceState>
        return {
          ...state,
          issues: migrateLegacyIssues(state.issues),
          conflicts: state.conflicts ?? [],
        } as WorkspaceState
      },
    },
  ),
)
