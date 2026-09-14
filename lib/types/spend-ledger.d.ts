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
import type { SpendRouteRow, SpendSample } from './spend-protocol.ts';
/** One Session last observed day plus its cumulative spend. */
export interface LedgerEntry {
    /** Billing day (YYYY-MM-DD in the pricing timezone) this entry describes. */
    date: string;
    /** Working directory of the Session, when recorded. */
    cwd?: string;
    /** Spend of `date` for this Session. */
    cost: number;
    /** Per-route breakdown of `date`. */
    routes: SpendRouteRow[];
    /** Cumulative spend of the Session. */
    cumulative: number;
}
/** On-disk ledger document. */
export interface LedgerDoc {
    version: 1;
    entries: Record<string, LedgerEntry>;
}
/** Fresh empty ledger. */
export declare const emptyLedger: () => LedgerDoc;
/**
 * Forgiving read: an unknown, older, or damaged document degrades to an empty
 * ledger instead of failing the bridge.
 * @param raw - parsed JSON of the ledger file (or anything).
 * @returns a well-formed ledger document.
 */
export declare function parseLedgerDoc(raw: unknown): LedgerDoc;
/**
 * Record one observation. The newest value for a Session wins; a Session that
 * reports only its cumulative spend keeps the day it was last seen on.
 * @param doc - ledger before the observation.
 * @param sessionId - the observed Session.
 * @param sample - its today cell and cumulative spend.
 * @param date - the billing day the observation was taken on.
 * @returns the updated ledger (same reference when nothing changed).
 */
export declare function observeSession(doc: LedgerDoc, sessionId: string, sample: SpendSample, date: string): LedgerDoc;
/**
 * Samples the ledger contributes to the spend fold (every Session it knows).
 * @param doc - ledger document.
 * @returns one sample per recorded Session.
 */
export declare function ledgerSamples(doc: LedgerDoc): SpendSample[];
/**
 * Read the ledger file, tolerating a missing or damaged document.
 * @param path - absolute ledger path.
 * @returns the parsed ledger, or an empty one.
 */
export declare function readLedgerFile(path: string): Promise<LedgerDoc>;
/**
 * Publish the ledger atomically (temp file + rename beside the target).
 * @param path - absolute ledger path.
 * @param doc - document to publish.
 */
export declare function writeLedgerFile(path: string, doc: LedgerDoc): Promise<void>;
/** In-memory ledger face the host wires into the collector. */
export interface LedgerWriter {
    /** Samples for the spend fold (every recorded Session). */
    samples(): readonly SpendSample[];
    /** Record one observation and schedule a save. */
    observe(sessionId: string, sample: SpendSample, date: string): void;
    /** Adopt a document read from disk. */
    hydrate(doc: LedgerDoc): void;
    /** Save now (dispose path). */
    flush(): Promise<void>;
    /** Current document (diagnostics). */
    document(): LedgerDoc;
}
/**
 * Build the debounced in-memory ledger over a save callback.
 * @param save - publishes a document (errors are swallowed: a failed write
 *   must never break the bridge).
 * @param delayMs - debounce window.
 * @returns the ledger writer.
 */
export declare function createLedger(save: (doc: LedgerDoc) => void | Promise<void>, delayMs?: number): LedgerWriter;
