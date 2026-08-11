export function selectEvidenceRun<T extends { id: string }>(
  runs: readonly T[],
  selectedRunId: string | null,
): T | undefined {
  if (!selectedRunId) return undefined
  return runs.find((run) => run.id === selectedRunId)
}
