#!/usr/bin/env node
/**
 * Automated verification: production code must not manually manage Sequelize
 * transaction commit/rollback lifecycles. The only allowed production entry is
 * sequelize.transaction inside utils/databaseTransaction.js.
 *
 * Allowed:
 *   - backend/utils/databaseTransaction.js (canonical wrapper)
 *   - backend/tests/** (test harness may open unmanaged transactions)
 *
 * Forbidden in all other production .js/.cjs files:
 *   - sequelize.transaction(
 *   - transaction.commit( / tx.commit(
 *   - transaction.rollback( / tx.rollback(
 *   - new Sequelize.Transaction
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BACKEND_ROOT = path.resolve(__dirname, '..')

const ALLOWED_FILES = new Set([
  path.join(BACKEND_ROOT, 'utils', 'databaseTransaction.js'),
])

const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'coverage',
  'data',
  '.git',
  'tests',
])

const SKIP_FILES = new Set([
  // This scanner documents forbidden patterns in its own source / help text.
  path.join(BACKEND_ROOT, 'scripts', 'checkTransactionBoundaries.js'),
])

const PATTERNS = [
  {
    name: 'sequelize.transaction(',
    // Match sequelize.transaction( or foo.sequelize.transaction(
    regex: /(?:^|[^.\w])(?:\w+\.)?sequelize\.transaction\s*\(/m,
  },
  {
    name: 'transaction.commit(',
    regex: /\b(?:transaction|tx)\.commit\s*\(/,
  },
  {
    name: 'transaction.rollback(',
    regex: /\b(?:transaction|tx)\.rollback\s*\(/,
  },
  {
    name: 'new Sequelize.Transaction',
    regex: /new\s+Sequelize\.Transaction\b/,
  },
]

const walk = (dir, files = []) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR_NAMES.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
      continue
    }
    if (entry.isFile() && /\.(js|cjs)$/.test(entry.name) && !SKIP_FILES.has(full)) {
      files.push(full)
    }
  }
  return files
}

const stripCommentsAndStrings = (source) => {
  // Rough strip so comment/string occurrences of forbidden APIs do not fail the scan.
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/`(?:\\.|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
}

const violations = []
const files = walk(BACKEND_ROOT)

for (const file of files) {
  if (ALLOWED_FILES.has(file)) {
    // Canonical helper may call sequelize.transaction once — verify no commit/rollback.
    const source = fs.readFileSync(file, 'utf8')
    const cleaned = stripCommentsAndStrings(source)
    const lines = cleaned.split('\n')
    lines.forEach((line, idx) => {
      for (const pattern of PATTERNS) {
        if (pattern.name === 'sequelize.transaction(') continue
        if (pattern.regex.test(line)) {
          violations.push({
            file: path.relative(BACKEND_ROOT, file),
            line: idx + 1,
            pattern: pattern.name,
            text: line.trim().slice(0, 160),
          })
        }
      }
    })
    continue
  }

  const source = fs.readFileSync(file, 'utf8')
  const cleaned = stripCommentsAndStrings(source)
  const lines = cleaned.split('\n')
  lines.forEach((line, idx) => {
    for (const pattern of PATTERNS) {
      if (pattern.regex.test(line)) {
        violations.push({
          file: path.relative(BACKEND_ROOT, file),
          line: idx + 1,
          pattern: pattern.name,
          text: line.trim().slice(0, 160),
        })
      }
    }
  })
}

if (violations.length) {
  console.error('Transaction boundary violations found:')
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.pattern}]  ${v.text}`)
  }
  console.error(
    `\nExpected: only utils/databaseTransaction.js may call sequelize.transaction(); ` +
      `no production file may call commit()/rollback().`
  )
  process.exit(1)
}

console.log(
  `checkTransactionBoundaries: OK (${files.length} files scanned, 0 violations)`
)
process.exit(0)
