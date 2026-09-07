/**
 * dsh-context-show browser half: the collapsible context occupancy panel in
 * the conversation session header utilities row, plus the pricing settings
 * card in the web Settings plugin-configuration section.
 *
 * @module dsh-context-show/client
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import { type ContextShowKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The context-show panel and settings copy. */
        'context-show': ContextShowKey;
    }
}
/** Required services: slots (ui-renderer), locale, and the settings scope binder. */
export declare const inject: string[];
/**
 * Mount the meter entry and the pricing settings card.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
