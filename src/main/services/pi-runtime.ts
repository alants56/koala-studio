import { app } from 'electron'
import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

function resolvePiCommand(): string | undefined {
  const pathCandidates = (process.env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, process.platform === 'win32' ? 'pi.cmd' : 'pi'))
  const candidates = [
    process.env.PI_ACP_PI_COMMAND,
    ...pathCandidates,
    join(homedir(), '.npm-global/bin/pi'),
    join(homedir(), '.local/bin/pi'),
    join(homedir(), '.bun/bin/pi'),
    '/opt/homebrew/bin/pi',
    '/usr/local/bin/pi'
  ]
  return candidates.find((candidate): candidate is string => Boolean(candidate && existsSync(candidate)))
}

/**
 * GUI apps on macOS do not inherit the terminal PATH. Pi's npm launcher uses
 * `#!/usr/bin/env node`, so expose Electron's bundled Node runtime under that name.
 */
function ensureBundledNodeOnPath(): string | undefined {
  if (process.platform === 'win32') return undefined

  const runtimeBin = join(app.getPath('userData'), 'runtime-bin')
  const nodeShim = join(runtimeBin, 'node')
  mkdirSync(runtimeBin, { recursive: true })

  const existingShim = lstatSync(nodeShim, { throwIfNoEntry: false })
  if (existingShim) {
    const isExpectedSymlink = existingShim.isSymbolicLink()
      && resolve(dirname(nodeShim), readlinkSync(nodeShim)) === resolve(process.execPath)
    if (!isExpectedSymlink) unlinkSync(nodeShim)
  }
  if (!lstatSync(nodeShim, { throwIfNoEntry: false })) symlinkSync(process.execPath, nodeShim)

  return runtimeBin
}

export function piAcpEnvironment(): NodeJS.ProcessEnv {
  const runtimeBin = ensureBundledNodeOnPath()
  const piCommand = resolvePiCommand()
  const path = [runtimeBin, process.env.PATH].filter(Boolean).join(delimiter)

  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ...(path ? { PATH: path } : {}),
    ...(piCommand ? { PI_ACP_PI_COMMAND: piCommand } : {})
  }
}
