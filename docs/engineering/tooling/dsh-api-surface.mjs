#!/usr/bin/env node
// DSH API surface probe: deterministic contract check between two installed trees.
//
//   node api-surface.mjs --imports plugin-imports.json --services plugin-services.json \
//        --base <dir-with-@deepseek-ai-packages> --target <dir-with-@deepseek-ai-packages>
//
// `--imports` maps "package" or "package:subpath" to imported symbols.
// `--services` lists context service names the plugin injects.
// Prints JSON: missing symbols, signature drift (hash of the declaration text),
// and service-surface drift. Read-only; no type checking required.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const args = process.argv.slice(2)
const readArg = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const imports = JSON.parse(fs.readFileSync(readArg('--imports'), 'utf8'))
const services = fs.existsSync(readArg('--services')) ? JSON.parse(fs.readFileSync(readArg('--services'), 'utf8')) : []
const baseDir = readArg('--base')
const targetDir = readArg('--target')

const cache = new Map()
function packageText(dir, pkg) {
  const key = `${dir}::${pkg}`
  if (cache.has(key)) return cache.get(key)
  const root = path.join(dir, pkg)
  let text = ''
  if (fs.existsSync(root)) {
    const walk = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.d.ts') || entry.name.endsWith('.d.cts')) text += fs.readFileSync(full, 'utf8') + '\n'
      }
    }
    walk(root)
  }
  cache.set(key, text)
  return text
}

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10)
}

function declaration(text, symbol) {
  const patterns = [
    new RegExp(`export\\s+declare\\s+(?:abstract\\s+)?(class|interface|type|const|function|enum|var|let)\\s+${symbol}\\b`),
    new RegExp(`export\\s+(class|interface|type|const|function|enum)\\s+${symbol}\\b`),
    new RegExp(`^\\s*(?:readonly\\s+)?${symbol}\\s*[?]?\\s*[:=(]`, 'm'),
    new RegExp(`\\b${symbol}\\s*[?]?\\s*[:=]`, 'm'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(text)
    if (!match) continue
    const from = match.index
    let depth = 0
    let end = from
    for (let index = from; index < text.length && index < from + 4000; index += 1) {
      const char = text[index]
      if (char === '{' || char === '(') depth += 1
      else if (char === '}' || char === ')') depth -= 1
      else if (char === '\n' && depth <= 0) { end = index; break }
    }
    const snippet = text.slice(from, Math.max(end, from + 1)).replace(/\s+/g, ' ').trim()
    return snippet.slice(0, 600)
  }
  return text.includes(symbol) ? 'MENTION-ONLY' : null
}

const report = { baseDir, targetDir, symbols: [], services: [], summary: {} }
const drift = { missingInTarget: [], addedInTarget: [], signatureChanged: [], identical: 0 }

for (const [spec, symbols] of Object.entries(imports)) {
  const [pkg, subpath] = spec.split(':')
  for (const raw of symbols) {
    const symbol = raw.replace(/^type\s+/, '').trim()
    if (!symbol) continue
    const baseText = packageText(baseDir, pkg)
    const targetText = packageText(targetDir, pkg)
    const baseDecl = declaration(baseText, symbol)
    const targetDecl = declaration(targetText, symbol)
    const entry = {
      package: pkg + (subpath ? `:${subpath}` : ''),
      symbol,
      inBase: baseDecl !== null,
      inTarget: targetDecl !== null,
      baseHash: baseDecl === null ? null : hash(baseDecl),
      targetHash: targetDecl === null ? null : hash(targetDecl),
      changed: baseDecl !== null && targetDecl !== null && hash(baseDecl) !== hash(targetDecl),
      targetDecl: targetDecl === null ? null : targetDecl.slice(0, 220),
    }
    report.symbols.push(entry)
    if (entry.inBase && !entry.inTarget) drift.missingInTarget.push(`${entry.package}#${entry.symbol}`)
    else if (!entry.inBase && entry.inTarget) drift.addedInTarget.push(`${entry.package}#${entry.symbol}`)
    else if (entry.changed) drift.signatureChanged.push(`${entry.package}#${entry.symbol}`)
    else drift.identical += 1
  }
}

for (const service of services) {
  const scan = dir => {
    let found = null
    for (const pkg of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const text = packageText(dir, pkg)
      const pattern = new RegExp(`interface\\s+Context\\b[\\s\\S]{0,4000}?${service}\\s*[?]?\\s*:`)
      const match = pattern.exec(text)
      if (match) { found = { pkg, snippet: match[0].replace(/\s+/g, ' ').slice(-160) }; break }
    }
    return found
  }
  const base = scan(baseDir)
  const target = scan(targetDir)
  report.services.push({
    service,
    inBase: base !== null,
    inTarget: target !== null,
    basePkg: base?.pkg ?? null,
    targetPkg: target?.pkg ?? null,
    changed: (base?.snippet ?? '') !== (target?.snippet ?? ''),
  })
}

report.summary = {
  symbolsChecked: report.symbols.length,
  identical: drift.identical,
  missingInTarget: drift.missingInTarget,
  addedInTarget: drift.addedInTarget,
  signatureChanged: drift.signatureChanged,
  servicesChecked: report.services.length,
  servicesMissingInTarget: report.services.filter(entry => entry.inBase && !entry.inTarget).map(entry => entry.service),
}
console.log(JSON.stringify(report, null, 1))
