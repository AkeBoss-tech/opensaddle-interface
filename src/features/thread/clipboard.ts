export async function writeClipboardText(text: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard access is unavailable in this environment.')
  }

  await navigator.clipboard.writeText(text)
}
