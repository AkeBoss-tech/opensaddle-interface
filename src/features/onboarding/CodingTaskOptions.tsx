import React from 'react'
void React

export type CodingTaskSpec = {
  schema_version: 'opensaddle.coding-task.v1'
  allowed_paths: string[]
  verification_commands: string[][]
}
export type CodingTaskDraft = { enabled: boolean; paths: string; checks: string }
export const emptyCodingTaskDraft: CodingTaskDraft = { enabled: false, paths: '', checks: '' }
export function codingTaskSpec(draft: CodingTaskDraft): CodingTaskSpec | undefined {
  if (!draft.enabled) return undefined
  const paths = draft.paths.split('\n').map(value => value.trim()).filter(Boolean)
  if (!paths.length || paths.length > 32 || new Set(paths).size !== paths.length || paths.some(path => path.length > 1000 || path.startsWith('/') || /[\\\0\r*?\[\]]/.test(path) || path.split('/').some(part => ['..', '.', '.git', '.ssh', '.venv', 'node_modules', '.env'].includes(part) || part.startsWith('.env.') || !part))) throw Error('Choose 1–32 unique repository-relative file paths, without parent-directory traversal.')
  const lines = draft.checks.split('\n').map(value => value.trim()).filter(Boolean)
  if (!lines.length || lines.length > 16) throw Error('Provide 1–16 verification checks as argument arrays.')
  const verification_commands = lines.map(line => {
    let value: unknown
    try { value = JSON.parse(line) } catch { throw Error('Each check must be a JSON argument array, such as ["python", "-m", "pytest", "tests/test_example.py"].') }
    if (!Array.isArray(value) || !value.length || value.length > 64 || value.some(arg => typeof arg !== 'string' || !arg || arg.includes('\0') || arg.length > 4096)) throw Error('Each verification check needs an executable and bounded string arguments.')
    return value as string[]
  })
  if (verification_commands.reduce((total, argv) => total + argv.reduce((size, arg) => size + new TextEncoder().encode(arg).length, 0), 0) > 16384) throw Error('Verification arguments exceed the 16 KiB total bound.')
  return { schema_version: 'opensaddle.coding-task.v1', allowed_paths: paths, verification_commands }
}
export function CodingTaskOptions({ value, onChange, available, disabled }: { value: CodingTaskDraft; onChange: React.Dispatch<React.SetStateAction<CodingTaskDraft>>; available: boolean; disabled?: boolean }) {
  let error: string | undefined
  try { codingTaskSpec(value) } catch (reason) { error = reason instanceof Error ? reason.message : String(reason) }
  return <fieldset><legend>Workspace changes</legend>
    <label><input type="checkbox" checked={value.enabled} disabled={disabled || !available} onChange={event => onChange(current => ({ ...current, enabled: event.target.checked }))} />Make a bounded coding change</label>
    {!available && <p>Workspace changes are unavailable for the selected coding agent or server.</p>}
    {value.enabled && <>
      <p>The installed agent runs as your local user. This is trusted-local execution. The requested scope permits the listed files and checks; it does not authorize commits, pushes, deployment, or permission changes.</p>
      <label>Allowed file paths · one per line<textarea disabled={disabled} value={value.paths} onChange={event => onChange(current => ({ ...current, paths: event.target.value }))} placeholder={'src/example.py\ntests/test_example.py'} /></label>
      <label>Verification checks · one argument array per line<textarea disabled={disabled} value={value.checks} onChange={event => onChange(current => ({ ...current, checks: event.target.value }))} placeholder={'["python", "-m", "pytest", "tests/test_example.py"]'} /></label>
      <p>OpenSaddle passes these arguments directly; it does not wrap checks in a shell.</p>
      {error && <p role="status">{error}</p>}
    </>}
  </fieldset>
}
