#!/usr/bin/env node
// Mesures d'exécution à partir des journaux de session DSH v4 (lecture seule, zéro dépendance).
//
//   node dsh-session-metrics.mjs [--sessions <dir>] [--file <jsonl.zstd>]
//        [--from <ISO>] [--to <ISO>] [--exclude <fragments,csv>] [--label <texte>]...
//
// Sortie JSON : span, tours/steps/appels LLM, tokens (entrée, sortie, cache), appels d'outils par
// outil, échecs d'outils, sorties bash non nulles (réels vs sans marqueur d'erreur), composition
// des commandes bash (piped/chained/plain), temps d'outil cumulé et par catégorie, signatures de
// commandes (nb d'appels, premier, premier succès, timeline), relectures répétées, approbations,
// compactions, gaps humains > 60 s, agrégat par session.
//
// Limites d'interprétation (documentées dans docs/engineering/DSH-MIGRATION-RETRO.md §2) :
//  - le harness ne journalise pas de prix : le coût API n'est PAS déductible ;
//  - une commande pipée ou chaînée ne publie que le code de sortie du dernier segment : le nombre
//    de sorties non nulles est un majorant des échecs visibles, pas un décompte d'échecs ;
//  - toolWallTime inclut les attentes d'approbation humaine ; les gaps > 60 s les isolent.
//
// Exemple (mission de migration) :
//   node docs/engineering/tooling/dsh-session-metrics.mjs \
//     --from 2026-10-20T05:40:00Z --to 2026-10-20T10:50:00Z --exclude agent-team~ \
//     --label "error TS" --label "npm ERR" > .scratch/metrics.json
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const args = process.argv.slice(2)
const readArg = name => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const cwdSlug = `--${process.cwd().replace(/^\/+|\/+$/g, '').replace(/[\\/]/g, '-')}--`
const sessionsDir = readArg('--sessions') ?? path.join(process.env.HOME ?? '', '.dsh/sessions', cwdSlug)
const from = readArg('--from') ? Date.parse(readArg('--from')) : Number.NEGATIVE_INFINITY
const to = readArg('--to') ? Date.parse(readArg('--to')) : Number.POSITIVE_INFINITY
const labels = args.reduce((list, value, index) => (value === '--label' ? [...list, args[index + 1]] : list), [])

const exclude = (readArg('--exclude') ?? '').split(',').filter(Boolean)
const single = readArg('--file')
const files = single ? [single] : fs.readdirSync(sessionsDir)
  .filter(name => !exclude.some(fragment => name.includes(fragment)))
  .map(name => path.join(sessionsDir, name, 'session.v4.jsonl.zstd'))
  .filter(file => fs.existsSync(file))
  .map(file => ({ file, mtime: fs.statSync(file).mtimeMs }))
  .filter(entry => entry.mtime >= from && entry.mtime <= to + 86_400_000)
  .sort((a, b) => a.mtime - b.mtime)

const aggregate = {
  sessions: 0,
  events: 0,
  first: null,
  last: null,
  turns: 0,
  steps: 0,
  llmCalls: 0,
  tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 },
  tools: new Map(),
  toolErrors: [],
  toolWallMs: 0,
  openCalls: new Map(),
  reads: new Map(),
  approvals: 0,
  compactions: 0,
  gaps: [],
  types: new Map(),
  buckets: new Map(),
  nonZeroExits: [],
  signatures: new Map(),
  milestones: new Map(),
  successes: new Map(),
  perSession: new Map(),
  hygiene: { piped: 0, chained: 0, plain: 0, total: 0 },
}

const MARKERS = [/Error:/, /error TS\d+/, /npm ERR/, /\[sandbox/, /ENOENT/, /EISDIR/, /EROFS/, /is not a function/, /Cannot read/, /npm cache/, /ENOTEMPTY/, /\bFAIL\b/, /failed/, /Tests\s+\d+/, /AssertionError/, /TypeError/, /command not found/]
for (const { file } of files) {
  aggregate.sessions += 1
  const sessionKey = path.basename(path.dirname(file))
  const session = aggregate.perSession.get(sessionKey) ?? { events: 0, steps: 0, llmCalls: 0, tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, totalTokens: 0 }, first: null, last: null, toolCalls: 0 }
  aggregate.perSession.set(sessionKey, session)
  const text = zlib.zstdDecompressSync(fs.readFileSync(file)).toString('utf8')
  for (const line of text.trim().split('\n')) {
    const event = JSON.parse(line)
    const type = event.type ?? 'HEADER'
    aggregate.types.set(type, (aggregate.types.get(type) ?? 0) + 1)
    if (type === 'HEADER') {
      const created = event.createdAt
      if (typeof created === 'number' && created >= from && created <= to) {
        aggregate.first = aggregate.first === null ? created : Math.min(aggregate.first, created)
      }
      continue
    }
    const time = event.time
    if (typeof time !== 'number' || time < from || time > to) continue
    aggregate.events += 1
    session.events += 1
    aggregate.first = aggregate.first === null ? time : Math.min(aggregate.first, time)
    aggregate.last = aggregate.last === null ? time : Math.max(aggregate.last, time)
    const data = event.data ?? {}

    if (type === 'turn/start') aggregate.turns += 1
    if (type === 'step/start') { aggregate.steps += 1; session.steps += 1 }
    session.last = session.last === null ? time : Math.max(session.last, time)
    session.first = session.first === null ? time : Math.min(session.first, time)
    if (type === 'assistant/message') {
      aggregate.llmCalls += 1
      session.llmCalls += 1
      const usage = data.usage ?? data.message?.usage
      if (usage) {
        for (const key of Object.keys(aggregate.tokens)) aggregate.tokens[key] += usage[key] ?? 0
        session.tokens.inputTokens += usage.inputTokens ?? 0
        session.tokens.outputTokens += usage.outputTokens ?? 0
        session.tokens.cacheReadTokens += usage.cacheReadTokens ?? 0
        session.tokens.totalTokens += usage.totalTokens ?? 0
      }
    }
    if (type === 'tool/call') {
      const tool = data.name ?? data.message?.name ?? 'unknown'
      aggregate.tools.set(tool, (aggregate.tools.get(tool) ?? 0) + 1)
      const callId = data.callId ?? data.message?.toolCallId
      let input = data.arguments ?? data.message?.arguments ?? {}
      if (typeof input === 'string') { try { input = JSON.parse(input) } catch { input = {} } }
      const command = typeof input.command === 'string' ? input.command : undefined
      const signatures = []
      if (tool === 'bash' && command) {
        aggregate.hygiene.total += 1
        if (/\|\s*(tail|head|grep|less)/.test(command)) aggregate.hygiene.piped += 1
        else if (command.split(/&&|;/).filter(part => part.trim().length > 0).length > 2) aggregate.hygiene.chained += 1
        else aggregate.hygiene.plain += 1
      }
      if (command) {
        for (const signature of ['npm run check', 'npm run typecheck', 'npm test', 'npm run build', 'npm ci', 'npm install', 'npx tsc', 'npm run guard', 'dsh plugin', 'dsh web', 'git commit', 'git push', 'gh pr']) {
          if (command.includes(signature)) signatures.push(signature)
        }
      }
      if ((tool === 'edit' || tool === 'write') && typeof input.file_path === 'string' && input.file_path.includes('/src/')) {
        if (!aggregate.milestones.has('first-src-edit')) aggregate.milestones.set('first-src-edit', time)
      }
      if (callId) aggregate.openCalls.set(callId, { time, tool, command, signatures })
      const target = input.file_path ?? input.path ?? (typeof input.pattern === 'string' ? `glob:${input.pattern}` : undefined)
      if (typeof target === 'string') aggregate.reads.set(target, (aggregate.reads.get(target) ?? 0) + 1)
    }
    if (type === 'tool/result') {
      const callId = data.toolCallId ?? data.message?.toolCallId
      const open = callId ? aggregate.openCalls.get(callId) : undefined
      const block = (data.message?.content ?? data.content ?? []).find(item => item.type === 'text')
      const text = typeof block?.text === 'string' ? block.text : ''
      if (open) {
        aggregate.toolWallMs += Math.max(0, time - open.time)
        const bucket = bucketOf(open.tool, open.command)
        aggregate.buckets.set(bucket, (aggregate.buckets.get(bucket) ?? 0) + (time - open.time))
        aggregate.openCalls.delete(callId)
      }
      const exitMatch = text.match(/\[exit code: (\d+)\]/)
      for (const signature of open?.signatures ?? []) {
        const entry = aggregate.signatures.get(signature) ?? { count: 0, first: null, firstSuccess: null, successes: 0, times: [] }
        entry.count += 1
        entry.first = entry.first === null ? time : entry.first
        const ok = ![...text.matchAll(/\[exit code: (\d+)\]/g)].some(match => match[1] !== '0')
        entry.times = [...entry.times, { time, ok }]
        if (ok) {
          entry.successes += 1
          if (entry.firstSuccess === null) entry.firstSuccess = time
        }
        aggregate.signatures.set(signature, entry)
      }
      if (exitMatch && exitMatch[1] !== '0') {
        const marker = MARKERS.find(pattern => pattern.test(text))
        const detail = marker === undefined ? '' : (text.split('\n').reverse().find(line => marker.test(line)) ?? '').trim()
        const key = marker === undefined
          ? 'benign: non-zero exit with no error marker (grep/rg no-match, test fixture)'
          : `${open?.tool ?? 'tool'}(exit ${exitMatch[1]}): ${labels.find(label => text.includes(label)) ?? detail.slice(0, 90)}`
        aggregate.nonZeroExits.push(key)
      }
      const failed = data.message?.isError === true || data.isError === true || /^Error:/.test(text)
      if (failed) {
        aggregate.toolErrors.push({
          tool: open?.tool ?? 'unknown',
          label: labels.find(label => text.includes(label)) ?? labelOf(text),
        })
      }
    }
    if (type === 'approval/asked') aggregate.approvals += 1
    if (type === 'compaction/start') aggregate.compactions += 1
  }
}

function bucketOf(tool, command) {
  if (tool !== 'bash' || typeof command !== 'string') return tool
  const first = command.split('\n').find(line => line.trim().length > 0)?.trim() ?? ''
  const match = first.match(/\b(npm run (check|build|typecheck|test)|npm (ci|install|view)|npx tsc|tsc|node|git (status|log|diff|add|commit|push|checkout)|dsh|gh|curl|rg|grep|cat|head|sed|ls|find|python3)\b/)
  return match ? `bash:${match[1]}` : 'bash:other'
}

function labelOf(text) {
  const first = text.split('\n').find(line => line.trim().length > 0) ?? ''
  return first.trim().slice(0, 90)
}

// Gap analysis: idle > 60s between consecutive events = human/queue/agent-thinking pause.
aggregate.gaps = (() => {
  const times = files.flatMap(file_ => {
    const text = zlib.zstdDecompressSync(fs.readFileSync(file_.file)).toString('utf8')
    return text.trim().split('\n').map(line => {
      const event = JSON.parse(line)
      return typeof event.time === 'number' ? event.time : null
    }).filter(value => value !== null && value >= from && value <= to)
  }).sort((a, b) => a - b)
  const gaps = []
  for (let index = 1; index < times.length; index += 1) {
    const delta = times[index] - times[index - 1]
    if (delta > 60_000) gaps.push({ at: new Date(times[index]).toISOString(), seconds: Math.round(delta / 1000) })
  }
  return gaps
})()

const spanMs = aggregate.first !== null && aggregate.last !== null ? aggregate.last - aggregate.first : 0
const fmt = ms => `${Math.floor(ms / 60_000)}m${String(Math.round(ms % 60_000 / 1000)).padStart(2, '0')}s`

const out = {
  window: { from: from === Number.NEGATIVE_INFINITY ? null : new Date(from).toISOString(), to: to === Number.POSITIVE_INFINITY ? null : new Date(to).toISOString() },
  sessions: aggregate.sessions,
  events: aggregate.events,
  span: fmt(spanMs),
  spanMs,
  turns: aggregate.turns,
  steps: aggregate.steps,
  llmCalls: aggregate.llmCalls,
  tokens: aggregate.tokens,
  toolCallsByTool: Object.fromEntries([...aggregate.tools].sort((a, b) => b[1] - a[1])),
  toolCallTotal: [...aggregate.tools.values()].reduce((sum, value) => sum + value, 0),
  toolErrorsTotal: aggregate.toolErrors.length,
  toolErrorLabels: Object.fromEntries([...group(aggregate.toolErrors.map(entry => `${entry.tool}: ${entry.label}`))].sort((a, b) => b[1] - a[1])),
  toolWallTime: fmt(aggregate.toolWallMs),
  toolWallMs: aggregate.toolWallMs,
  modelWallTime: fmt(Math.max(0, spanMs - aggregate.toolWallMs - aggregate.gaps.reduce((sum, gap) => sum + gap.seconds * 1000, 0))),
  idleGapTotal: fmt(aggregate.gaps.reduce((sum, gap) => sum + gap.seconds * 1000, 0)),
  idleGapsOver60s: aggregate.gaps.length,
  approvals: aggregate.approvals,
  bashCommandHygiene: aggregate.hygiene,
  commandSignatures: Object.fromEntries([...aggregate.signatures].map(([key, entry]) => [key, {
    calls: entry.count,
    successes: entry.successes ?? 0,
    first: entry.first ? new Date(entry.first).toISOString() : null,
    firstSuccess: entry.firstSuccess ? new Date(entry.firstSuccess).toISOString() : null,
    times: (entry.times ?? []).map(item => `${new Date(item.time).toISOString().slice(11, 19)}${item.ok ? ' ok' : ' FAIL'}`),
  }])),
  perSession: Object.fromEntries([...aggregate.perSession].map(([key, value]) => [key, {
    events: value.events,
    steps: value.steps,
    llmCalls: value.llmCalls,
    toolCalls: value.toolCalls,
    tokens: value.tokens,
    span: value.first !== null ? fmt(value.last - value.first) : 'n/a',
  }])),
  realFailureCount: aggregate.nonZeroExits.filter(entry => !entry.startsWith('benign:')).length,
  benignNonZeroExitCount: aggregate.nonZeroExits.filter(entry => entry.startsWith('benign:')).length,
  nonZeroExitLabels: Object.fromEntries([...group(aggregate.nonZeroExits)].sort((a, b) => b[1] - a[1]).slice(0, 25)),
  milestones: Object.fromEntries([...aggregate.milestones].map(([key, value]) => [key, new Date(value).toISOString()])),
  firstCheck: aggregate.signatures.get('npm run check')?.first ? new Date(aggregate.signatures.get('npm run check').first).toISOString() : null,
  toolWallTimeByCategory: Object.fromEntries([...aggregate.buckets].sort((a, b) => b[1] - a[1]).slice(0, 18).map(([key, ms]) => [key, fmt(ms)])),
  compactions: aggregate.compactions,
  repeatedReadsTop: [...aggregate.reads].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]).slice(0, 15),
  repeatedReadTotal: [...aggregate.reads].filter(([, count]) => count > 1).reduce((sum, [, count]) => sum + count - 1, 0),
}

function group(values) {
  const map = new Map()
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1)
  return map
}

console.log(JSON.stringify(out, null, 1))
