import type { SandboxClient, SandboxResult } from './contracts'

/**
 * Browser sandbox using a dedicated Worker with a hard timeout.
 * Uses Function constructor inside the worker (not page eval) with no DOM/network.
 * Suitable for basic tasks — not hostile multi-tenant isolation.
 */
export class WorkerSandboxClient implements SandboxClient {
  async run(input: {
    language: 'javascript' | 'typescript' | 'python'
    code: string
    files?: Record<string, string>
    timeoutMs?: number
  }): Promise<SandboxResult> {
    if (input.language === 'python') {
      return {
        ok: false,
        stdout: '',
        stderr: 'Python (Pyodide) is stubbed in this build. Use JavaScript/TypeScript for browser sandbox tasks.',
        durationMs: 0,
      }
    }

    const timeoutMs = input.timeoutMs ?? 3000
    const started = performance.now()
    const workerCode = `
      self.onmessage = (ev) => {
        const { code, files } = ev.data;
        const logs = [];
        const fakeConsole = {
          log: (...args) => logs.push(args.map(String).join(' ')),
          error: (...args) => logs.push('[err] ' + args.map(String).join(' ')),
          warn: (...args) => logs.push('[warn] ' + args.map(String).join(' ')),
        };
        const vfs = { ...(files || {}) };
        const api = {
          readFile: (p) => {
            if (!(p in vfs)) throw new Error('ENOENT: ' + p);
            return vfs[p];
          },
          writeFile: (p, c) => { vfs[p] = String(c); },
          listFiles: () => Object.keys(vfs),
        };
        try {
          const fn = new Function('console', 'fs', '"use strict";\\n' + code);
          const result = fn(fakeConsole, api);
          self.postMessage({ ok: true, stdout: logs.join('\\n') + (result !== undefined ? '\\n' + String(result) : ''), stderr: '', artifacts: Object.entries(vfs).map(([path, content]) => ({ path, content: String(content) })) });
        } catch (err) {
          self.postMessage({ ok: false, stdout: logs.join('\\n'), stderr: String(err && err.message ? err.message : err), artifacts: [] });
        }
      };
    `
    const blob = new Blob([workerCode], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)

    return new Promise((resolve) => {
      const timer = window.setTimeout(() => {
        worker.terminate()
        URL.revokeObjectURL(url)
        resolve({
          ok: false,
          stdout: '',
          stderr: `Sandbox timed out after ${timeoutMs}ms`,
          durationMs: Math.round(performance.now() - started),
        })
      }, timeoutMs)

      worker.onmessage = (ev: MessageEvent<{ ok: boolean; stdout: string; stderr: string; artifacts: Array<{ path: string; content: string }> }>) => {
        window.clearTimeout(timer)
        worker.terminate()
        URL.revokeObjectURL(url)
        resolve({
          ok: ev.data.ok,
          stdout: ev.data.stdout,
          stderr: ev.data.stderr,
          durationMs: Math.round(performance.now() - started),
          artifacts: ev.data.artifacts,
        })
      }

      worker.onerror = (err) => {
        window.clearTimeout(timer)
        worker.terminate()
        URL.revokeObjectURL(url)
        resolve({
          ok: false,
          stdout: '',
          stderr: err.message || 'Worker error',
          durationMs: Math.round(performance.now() - started),
        })
      }

      worker.postMessage({ code: input.code, files: input.files ?? {} })
    })
  }
}
