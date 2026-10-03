import { useEffect } from 'react'
import axios from 'axios'
import { useQuery } from '@tanstack/react-query'
import type { ConflictRecord } from './types'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export function useConflicts() {
  const setConflicts = useWorkspaceStore((state) => state.setConflicts)
  const query = useQuery({
    queryKey: ['conflicts'],
    queryFn: async () => (await axios.get<ConflictRecord[]>('/api/conflicts')).data,
  })

  useEffect(() => {
    if (!query.data) return
    // 合并本地持久化的冲突（刷新后服务端内存重置，本地仍留存待处理项）
    const current = useWorkspaceStore.getState().conflicts
    const serverIds = new Set(query.data.map((item) => item.id))
    const localOnly = current.filter((item) => !serverIds.has(item.id))
    setConflicts([...query.data, ...localOnly])
  }, [query.data, setConflicts])

  return query
}
