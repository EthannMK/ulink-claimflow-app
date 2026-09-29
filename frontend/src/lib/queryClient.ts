import { QueryClient } from '@tanstack/react-query'

/** The app's one query cache, shared so code outside React (e.g. the JD1 runner) can refresh data. */
export const queryClient = new QueryClient()

/** Re-read the AI allowance/usage right away (after a scan, a page batch or a chat answer)
 *  instead of waiting for the 30-second refresh. Only screens currently showing it refetch. */
export function refreshUsage() {
  queryClient.invalidateQueries({ queryKey: ['usage'] })
}
