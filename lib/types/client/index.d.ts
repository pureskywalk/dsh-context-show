/**
 * dsh-context-show browser half: the collapsible context occupancy panel in
 * the conversation session header utilities row, plus the pricing settings
 * card in the web Settings plugin-configuration section.
 *
 * @module dsh-context-show/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type ContextShowKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** The context-show panel and settings copy. */
        'context-show': ContextShowKey;
    }
}
/** Required services: slots, locale, the settings scope binder, and its wire. */
export declare const inject: string[];
/**
 * Mount the meter entry and the pricing settings card.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
