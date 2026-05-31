import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export function runtimeDylibDependencies(runtimeNodePath, options = {}) {
  const otool = options.otool ?? ((nodePath) => execFileSync('otool', ['-L', nodePath], { encoding: 'utf8' }))
  const output = otool(runtimeNodePath)
  return output
    .split(/\r?\n/)
    .map(line => line.trim().match(/^(@rpath\/lib[^()\s]+\.dylib)\s/))
    .filter((match) => match)
    .map((match) => match[1])
}

export function resolveRuntimeDylib(ref, runtimeNodePath, options = {}) {
  const name = basename(ref)
  const candidates = [
    join(dirname(runtimeNodePath), name),
    join(dirname(runtimeNodePath), '..', 'lib', name),
    ...(options.searchDirs ?? []).map(dir => join(dir, name)),
    join(dirname(process.execPath), '..', 'lib', name),
    join(dirname(process.execPath), name),
  ].map(candidate => resolve(candidate))
  return candidates.find(candidate => existsSync(candidate)) ?? null
}

export function copyRuntimeDylibs(runtimeNodePath, options = {}) {
  const copied = []
  for (const ref of runtimeDylibDependencies(runtimeNodePath, options)) {
    const source = resolveRuntimeDylib(ref, runtimeNodePath, options)
    if (!source) throw new Error(`Could not resolve runtime dependency ${ref}`)
    const target = join(dirname(runtimeNodePath), basename(ref))
    if (resolve(source) !== resolve(target)) copyFileSync(source, target)
    copied.push({ ref, source, target })
  }
  return copied
}
