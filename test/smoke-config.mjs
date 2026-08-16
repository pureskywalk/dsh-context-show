// Ad-hoc smoke: parse the shipped bundle patch and validate the
// context-show config against the built host Config schema.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Config } from '../lib/index.js'

// js-yaml resolves from the dsh installation (not a plugin dependency).
const require = createRequire('C:/nvm4w/nodejs/node_modules/@deepseek-ai/dsh/package.json')
const { load } = require('js-yaml')

const patch = load(readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8'))
const rows = patch.flatMap((entry) => (entry.insert ?? []))
const row = rows.find((item) => item.id === 'context-show')
if (row === undefined) throw new Error('context-show row missing from patch')
// Schemastery schemas are callable: Config(value) validates and returns
// the normalized config.
const parsed = Config(row.config ?? {})
console.log('peakHours:', JSON.stringify(parsed.peakHours), '| timeZone:', parsed.timeZone)
console.log('flash peak:', JSON.stringify(parsed.prices['deepseek-official']?.peak))
console.log(JSON.stringify(parsed, null, 2))
