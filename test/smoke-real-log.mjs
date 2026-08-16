// Ad-hoc smoke: fold a REAL persisted session log (multi-frame zstd) through
// the built fold. Each durable append is one zstd frame; scan for the frame
// magic and decode every frame.
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import {
  createContextUsageProjectionDefinition,
  createPricingSpec,
} from '../lib/usage-fold.js'

const ZSTD_MAGIC = 0xFD2FB528
const file = process.argv[2]
const buffer = readFileSync(file)
const starts = []
for (let offset = 0; offset + 4 <= buffer.length; offset += 1) {
  if (buffer.readUInt32LE(offset) === ZSTD_MAGIC) starts.push(offset)
}
let plaintext = ''
for (let index = 0; index < starts.length; index += 1) {
  const end = index + 1 < starts.length ? starts[index + 1] : buffer.length
  plaintext += zstdDecompressSync(buffer.subarray(starts[index], end)).toString('utf8')
}
const lines = plaintext.split('\n').filter((line) => line.trim() !== '')
const spec = createPricingSpec({
  currency: 'CNY',
  prices: {
    'deepseek-official': { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 2 },
  },
  defaultPrice: { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 2 },
})
const definition = createContextUsageProjectionDefinition(spec)
let events = 0
let state = definition.init()
const types = new Set()
for (const line of lines) {
  const parsed = JSON.parse(line)
  if (parsed.type === undefined) continue // header line
  events += 1
  types.add(parsed.type)
  state = definition.apply(state, parsed)
}
console.log('frames:', starts.length, '| events folded:', events)
console.log('event types:', [...types].join(', '))
console.log(JSON.stringify(definition.view(state), null, 2))
