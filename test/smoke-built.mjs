// Ad-hoc smoke: fold a synthetic log through the BUILT host artifact.
import {
  createContextUsageProjectionDefinition,
  createPricingSpec,
} from '../lib/usage-fold.js'

const spec = createPricingSpec({
  currency: 'CNY',
  prices: {
    'deepseek-official': { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 2 },
  },
  defaultPrice: { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 2 },
})
const definition = createContextUsageProjectionDefinition(spec)

const events = [
  { type: 'request/header', seq: 0, time: 1, data: { reason: 'initial', header: { config: { provider: 'deepseek-official', model: 'deepseek-v4-flash' } } } },
  { type: 'assistant/chunk', seq: 1, time: 1, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 1000, outputTokens: 200 } } } },
  { type: 'assistant/message', seq: 2, time: 1, data: { turn: 1, step: 1, message: { id: 'm', role: 'assistant', content: [] }, usage: { inputTokens: 1100, outputTokens: 210 } } },
  { type: 'request/context', seq: 3, time: 1, data: { provider: 'openai', model: 'gpt-4o', contextWindow: 128000 } },
  { type: 'assistant/message', seq: 4, time: 1, data: { turn: 2, step: 1, message: { id: 'm2', role: 'assistant', content: [] }, usage: { inputTokens: 500, outputTokens: 80, cacheReadTokens: 300 } } },
]
let state = definition.init()
for (const event of events) state = definition.apply(state, event)
console.log(JSON.stringify(definition.view(state), null, 2))
