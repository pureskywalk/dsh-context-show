/**
 * Durable per-Session daily spend ledger.
 *
 * The bridge can only read Sessions attached to the running host, so a restart
 * would shrink "today / all sessions" to whatever happens to be loaded. This
 * ledger keeps the last observed day per Session on disk: every observation is
 * idempotent (the newest value for a Session wins), so the host restores the
 * day without replaying any log.
 *
 * @module dsh-context-show/spend-ledger
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
/** Fresh empty ledger. */
export const emptyLedger = () => ({ version: 1, entries: {} });
const ZERO_TOTAL = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
function finiteOr(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function parseRoutes(raw) {
    if (!Array.isArray(raw))
        return [];
    const rows = [];
    for (const candidate of raw) {
        if (typeof candidate !== 'object' || candidate === null)
            continue;
        const row = candidate;
        if (typeof row.provider !== 'string' || typeof row.model !== 'string')
            continue;
        rows.push({ provider: row.provider, model: row.model, cost: finiteOr(row.cost) });
    }
    return rows;
}
/**
 * Forgiving read: an unknown, older, or damaged document degrades to an empty
 * ledger instead of failing the bridge.
 * @param raw - parsed JSON of the ledger file (or anything).
 * @returns a well-formed ledger document.
 */
export function parseLedgerDoc(raw) {
    if (typeof raw !== 'object' || raw === null)
        return emptyLedger();
    const doc = raw;
    if (doc.version !== 1 || typeof doc.entries !== 'object' || doc.entries === null)
        return emptyLedger();
    const entries = {};
    for (const [id, value] of Object.entries(doc.entries)) {
        if (typeof value !== 'object' || value === null)
            continue;
        const entry = value;
        if (typeof entry.date !== 'string')
            continue;
        entries[id] = {
            date: entry.date,
            ...(typeof entry.cwd === 'string' ? { cwd: entry.cwd } : {}),
            cost: finiteOr(entry.cost),
            routes: parseRoutes(entry.routes),
            cumulative: finiteOr(entry.cumulative),
        };
    }
    return { version: 1, entries };
}
/**
 * Record one observation. The newest value for a Session wins; a Session that
 * reports only its cumulative spend keeps the day it was last seen on.
 * @param doc - ledger before the observation.
 * @param sessionId - the observed Session.
 * @param sample - its today cell and cumulative spend.
 * @param date - the billing day the observation was taken on.
 * @returns the updated ledger (same reference when nothing changed).
 */
export function observeSession(doc, sessionId, sample, date) {
    const previous = doc.entries[sessionId];
    if (sample.today === undefined && sample.cumulative === undefined)
        return doc;
    const entry = {
        date: sample.today?.date ?? previous?.date ?? date,
        ...(sample.cwd === undefined ? (previous?.cwd === undefined ? {} : { cwd: previous.cwd }) : { cwd: sample.cwd }),
        cost: sample.today?.cost ?? previous?.cost ?? 0,
        routes: sample.today === undefined
            ? previous?.routes ?? []
            : sample.today.routes.map(route => ({ provider: route.provider, model: route.model, cost: route.cost })),
        cumulative: sample.cumulative ?? previous?.cumulative ?? 0,
    };
    return { ...doc, entries: { ...doc.entries, [sessionId]: entry } };
}
/**
 * Samples the ledger contributes to the spend fold (every Session it knows).
 * @param doc - ledger document.
 * @returns one sample per recorded Session.
 */
export function ledgerSamples(doc) {
    return Object.values(doc.entries).map(entry => ({
        cwd: entry.cwd,
        today: {
            date: entry.date,
            cost: entry.cost,
            total: ZERO_TOTAL,
            routes: entry.routes.map(route => ({ provider: route.provider, model: route.model, cost: route.cost, total: ZERO_TOTAL })),
        },
        cumulative: entry.cumulative,
    }));
}
/**
 * Read the ledger file, tolerating a missing or damaged document.
 * @param path - absolute ledger path.
 * @returns the parsed ledger, or an empty one.
 */
export async function readLedgerFile(path) {
    try {
        return parseLedgerDoc(JSON.parse(await readFile(path, 'utf8')));
    }
    catch {
        return emptyLedger();
    }
}
/**
 * Publish the ledger atomically (temp file + rename beside the target).
 * @param path - absolute ledger path.
 * @param doc - document to publish.
 */
export async function writeLedgerFile(path, doc) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = path + ".tmp";
    await writeFile(temporary, JSON.stringify(doc, null, 2), 'utf8');
    await rename(temporary, path);
}
/**
 * Build the debounced in-memory ledger over a save callback.
 * @param save - publishes a document (errors are swallowed: a failed write
 *   must never break the bridge).
 * @param delayMs - debounce window.
 * @returns the ledger writer.
 */
export function createLedger(save, delayMs = 1000) {
    let doc = emptyLedger();
    let timer;
    const publish = () => {
        timer = undefined;
        void Promise.resolve(save(doc)).catch(() => { });
    };
    const schedule = () => {
        if (timer !== undefined)
            return;
        timer = setTimeout(publish, delayMs);
        timer.unref?.();
    };
    return {
        samples: () => ledgerSamples(doc),
        observe: (sessionId, sample, date) => {
            const next = observeSession(doc, sessionId, sample, date);
            if (next === doc)
                return;
            doc = next;
            schedule();
        },
        hydrate: (loaded) => { doc = loaded; },
        flush: async () => {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
            await save(doc);
        },
        document: () => doc,
    };
}
