/**
 * Host-side settings bridge for dsh-context-show.
 *
 * Serves the `context-show` settings namespace over a same-origin,
 * loopback-only HTTP pair because the rc.6 host-apiproxy refuses every
 * third-party namespace at the RPC boundary. The handlers ride the host
 * settings seam (ctx.settings), which keeps the official schema validation,
 * revision fencing, persistence, and event emission for free; the bridge only
 * adds the per-namespace gate the apiproxy normally provides. Error codes
 * mirror the official RPC codes so the client controller treats refusals
 * exactly like an apiproxy answer.
 *
 * @module dsh-context-show/bridge
 */
import { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import { CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX, } from "./bridge-protocol.js";
/** Cap on JSON request bodies (a single mutate is tiny). */
const MAX_JSON_BODY_BYTES = 64 * 1024;
/** The only namespace this bridge serves. */
const BRIDGE_NAMESPACE = 'context-show';
/** Loopback literal check plus browser same-origin markers (mirrors the dsh-ssh route fence). */
function isLoopbackRequest(request) {
    const address = request.socket.remoteAddress;
    if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1')
        return false;
    const host = request.headers.host;
    if (typeof host !== 'string')
        return false;
    let hostUrl;
    try {
        hostUrl = new URL('http://' + host);
    }
    catch {
        return false;
    }
    if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]')
        return false;
    if (request.headers['sec-fetch-site'] === 'cross-site')
        return false;
    const origin = request.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === hostUrl.host;
    }
    catch {
        return false;
    }
}
/** One JSON response. */
function writeJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' });
    res.end(payload);
}
/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > MAX_JSON_BODY_BYTES)
            return undefined;
        chunks.push(buffer);
    }
    try {
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    catch {
        return undefined;
    }
}
/** Project one settings descriptor onto the bridge wire view. */
function toView(descriptor) {
    return {
        ns: String(descriptor.ns),
        value: descriptor.value,
        ...descriptor.base === undefined ? {} : { base: descriptor.base },
        ...descriptor.user === undefined ? {} : { user: descriptor.user },
        revision: descriptor.revision,
    };
}
/** Map a seam failure onto the official-shaped refusal envelope. */
function failureOf(error) {
    if (error instanceof SettingsConflictError) {
        return { ok: false, code: 'settings-conflict', message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/is not registered/.test(message)) {
        return { ok: false, code: 'settings-rejected', message };
    }
    return { ok: false, code: 'settings-rejected', message };
}
/**
 * Build the loopback-only bridge routes.
 * @param deps - the settings seam and the llm catalog seam.
 * @returns the exact-path route registrations.
 */
export function makeBridgeRoutes(deps) {
    const { settings, llm } = deps;
    const namespace = BRIDGE_NAMESPACE;
    const describe = () => {
        const descriptor = settings.describe({ redactSecrets: true }).find(candidate => String(candidate.ns) === BRIDGE_NAMESPACE);
        return {
            ok: true,
            value: {
                view: descriptor === undefined ? null : toView(descriptor),
                writable: settings.writable !== false,
            },
        };
    };
    const mutate = async (request) => {
        const body = request;
        if (body === null || typeof body !== 'object' || body.op === null || typeof body.op !== 'object') {
            return { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' };
        }
        const op = body.op;
        if (op.op !== 'set' && op.op !== 'unset') {
            return { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' };
        }
        if (!Array.isArray(op.path) || op.path.some(part => typeof part !== 'string')) {
            return { ok: false, code: 'settings-rejected', message: 'malformed bridge settings request' };
        }
        const expectedRevision = typeof body.expectedRevision === 'number' ? body.expectedRevision : undefined;
        try {
            await settings.mutate(namespace, [op], expectedRevision);
        }
        catch (error) {
            return failureOf(error);
        }
        const descriptor = settings.describe({ redactSecrets: true }).find(candidate => String(candidate.ns) === BRIDGE_NAMESPACE);
        if (descriptor === undefined) {
            return { ok: false, code: 'internal', message: 'settings namespace "' + BRIDGE_NAMESPACE + '" was disposed after the mutate' };
        }
        return { ok: true, value: toView(descriptor) };
    };
    const guard = (req, res) => {
        if (!isLoopbackRequest(req)) {
            writeJson(res, 403, { error: 'loopback requests only' });
            return false;
        }
        if (req.method !== 'POST') {
            writeJson(res, 405, { error: 'method not allowed: ' + (req.method ?? '') });
            return false;
        }
        return true;
    };
    const models = async () => {
        try {
            const providers = llm.listProviders();
            const groups = [];
            for (const provider of providers) {
                try {
                    const entries = await llm.listModels(provider.id);
                    groups.push({ provider: provider.id, name: provider.name, models: entries.map(entry => entry.id) });
                }
                catch {
                    // A provider whose catalog read fails is skipped, not fatal.
                }
            }
            return { ok: true, value: { groups } };
        }
        catch (error) {
            return { ok: false, code: 'internal', message: error instanceof Error ? error.message : String(error) };
        }
    };
    return [
        {
            kind: 'exact',
            path: CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/describe',
            handler: async (req, res) => {
                if (!guard(req, res))
                    return;
                writeJson(res, 200, describe());
            },
        },
        {
            kind: 'exact',
            path: CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/mutate',
            handler: async (req, res) => {
                if (!guard(req, res))
                    return;
                const body = await readJsonBody(req);
                if (body === undefined) {
                    writeJson(res, 400, { ok: false, code: 'settings-rejected', message: 'unreadable JSON body' });
                    return;
                }
                writeJson(res, 200, await mutate(body));
            },
        },
        {
            kind: 'exact',
            path: CONTEXT_SHOW_SETTINGS_BRIDGE_PREFIX + '/models',
            handler: async (req, res) => {
                if (!guard(req, res))
                    return;
                writeJson(res, 200, await models());
            },
        },
    ];
}
