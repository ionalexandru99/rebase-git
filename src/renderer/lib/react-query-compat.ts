import {
  type UseMutationOptions,
  type UseQueryOptions,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'

export function createQuery<TData>(options: () => UseQueryOptions<TData>) {
  return useQuery(options())
}

export function createMutation<TData, TError, TVariables>(
  options: () => UseMutationOptions<TData, TError, TVariables>
) {
  return useMutation(options())
}

export { useQueryClient }
