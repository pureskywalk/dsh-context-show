/**
 * The context-show session header entry: a compact occupancy trigger that
 * toggles a draggable panel with the context composition sources, the
 * per-tool usage, estimated USD cost, and token usage.
 *
 * The panel has two modes: compact (key figures only — occupancy, total
 * cost, top tools) and detailed (composition, tool usage table, per-provider
 * cost with official pricing links, token usage). It is persistent (focus
 * changes never close it) and can be dragged anywhere by its grip handle;
 * once dragged it floats freely until closed.
 *
 * All figures are reactive: the session projections (`contextPressure`,
 * `contextBreakdown`, `tokenUsage`, `contextUsage`) are pushed live by the
 * host, and the conversation snapshot re-renders the tool list, so the
 * panel stays current while a turn streams.
 *
 * @module dsh-context-show/ContextShowMeter
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-conversation SlotMap merge (header utilities seat)
// and the token-meter projection keys.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { ContextBreakdownProjection, ContextPressureProjection, TokenUsageProjection } from '@deepseek-ai/dsh-token-meter/client'
// Type-only: pulls the contextUsage projection key into the client program.
import type {} from '../projection.ts'
import type { ContextUsageProjection } from '../projection.ts'
import { toolUsage } from './estimate.ts'
import { billedInputTokens, cacheHitPercent, formatMoney, formatTokens, totalTokensOf } from './formats.ts'
import type { ContextShowKey } from './locales.ts'
import styles from './ContextShowMeter.module.css'

/** Props supplied by the session header utilities seat plus the locale seat. */
export interface ContextShowMeterProps
  extends PropsRuntime<'conversation.session.header.utilities'>,
    PropsLocale<'context-show'> {}

/** Ring geometry: 14px viewBox, 2px stroke, matching the shipped meter. */
const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/** How many tools the detailed table lists. */
const TOP_TOOLS = 6

/** Minimum panel corner kept inside the viewport while dragging. */
const DRAG_MARGIN = 8
const DRAG_MIN_VISIBLE = 120

/** Composition legend rows, in bar-segment order; each class carries the tint. */
const COMPOSITION_ROWS: ReadonlyArray<{
  key: keyof ContextBreakdownProjection
  label: ContextShowKey
  color: string
}> = [
  { key: 'systemTokens', label: 'context.system', color: styles.colorSystem ?? '' },
  { key: 'toolsTokens', label: 'context.tools', color: styles.colorTools ?? '' },
  { key: 'messageTokens', label: 'context.messages', color: styles.colorMessages ?? '' },
]

/** Occupancy ring fill severity by used share. */
function ringTone(percent: number): string {
  if (percent >= 90) return styles.ringHigh ?? ''
  if (percent >= 70) return styles.ringMid ?? ''
  return styles.ringLow ?? ''
}

/** Approximate occupancy with its numerator and denominator, or null. */
function contextOccupancy(pressure: ContextPressureProjection | undefined): { percent: number; usedTokens: number; contextWindow: number } | null {
  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  if (usedTokens === undefined || pressure?.contextWindow === undefined) return null
  return {
    percent: Math.min(100, Math.round((usedTokens / pressure.contextWindow) * 100)),
    usedTokens,
    contextWindow: pressure.contextWindow,
  }
}

/** Clamp a dragged coordinate so most of the panel stays on screen. */
function clampDrag(value: number, limit: number): number {
  return Math.min(Math.max(value, DRAG_MARGIN), limit - DRAG_MARGIN - DRAG_MIN_VISIBLE)
}

/**
 * The header utility: ring trigger + toggled draggable panel.
 * @param props - framework kit plus the context-show locale seat.
 * @returns the meter entry, always visible so the panel stays reachable.
 */
export const ContextShowMeter = memo(function ContextShowMeter(props: ContextShowMeterProps) {
  const { useSession, useProjection, t } = props
  const nodes = useSession((snapshot) => snapshot.chat.legacy.nodes)
  const pressure = useProjection('contextPressure')
  const breakdown = useProjection('contextBreakdown')
  const usage = useProjection('tokenUsage')
  const providerUsage = useProjection('contextUsage')
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const rootRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  const occupancy = contextOccupancy(pressure)
  const toolRows = useMemo(() => toolUsage(nodes, TOP_TOOLS), [nodes])

  // Persistent panel: Escape is the only automatic dismissal (explicit, not
  // focus loss). Clicking the trigger toggles; clicking elsewhere leaves the
  // panel open so it keeps showing while the user reads the chat.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Dragging the grip handle floats the panel (position: fixed). The handle
  // captures the pointer, so move/up arrive there even outside the panel.
  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const panel = panelRef.current
    if (panel === null) return
    event.preventDefault()
    const rect = panel.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const moveDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    setPosition({
      left: clampDrag(event.clientX - drag.offsetX, window.innerWidth),
      top: clampDrag(event.clientY - drag.offsetY, window.innerHeight),
    })
  }
  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const compositionTotal = breakdown === undefined
    ? 0
    : breakdown.systemTokens + breakdown.toolsTokens + breakdown.messageTokens
  const usageTotal = usage === undefined ? 0 : totalTokensOf(usage)
  const cacheHit = usage === undefined ? null : cacheHitPercent(usage)
  const segments = breakdown === undefined || compositionTotal === 0
    ? (occupancy === null ? [] : [{ key: 'total', color: '', width: occupancy.percent }])
    : COMPOSITION_ROWS.map((row) => ({
      key: row.key,
      color: row.color,
      width: occupancy === null ? 0 : occupancy.percent * breakdown[row.key] / compositionTotal,
    })).filter((segment) => segment.width > 0)

  const unattributedTokens = providerUsage === undefined ? 0 : totalTokensOf(providerUsage.unattributed)
  const hasProviderRows = providerUsage !== undefined
    && (providerUsage.providers.length > 0 || unattributedTokens > 0)
  const totalCost = providerUsage?.totalCost ?? 0
  const peakLabel = providerUsage?.peakHours === undefined || providerUsage.peakHours.length === 0
    ? null
    : providerUsage.peakHours.map((range) => range.start + '-' + range.end).join('、')

  const triggerLabel = occupancy === null
    ? (usageTotal > 0 ? t('context.usageTotal', { total: formatTokens(usageTotal) }) : '—')
    : t('context.occupancySummary', {
      percent: String(occupancy.percent),
      used: formatTokens(occupancy.usedTokens),
      window: formatTokens(occupancy.contextWindow),
    })
  const triggerPercent = occupancy === null ? null : occupancy.percent
  const anyData = occupancy !== null || compositionTotal > 0 || toolRows.length > 0
    || usageTotal > 0 || totalCost > 0
  const modelsByCost = providerUsage === undefined
    ? []
    : [...providerUsage.providers].sort((left, right) => right.cost - left.cost)
  const currency = providerUsage?.currency ?? 'CNY'

  return (
    <span ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={t('context.toggle')}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={triggerLabel}
        onClick={() => { setOpen(!open) }}
      >
        <svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">
          <circle className={styles.ringTrack} cx="7" cy="7" r={RING_RADIUS} />
          {triggerPercent !== null && (
            <circle
              className={ringTone(triggerPercent)}
              cx="7"
              cy="7"
              r={RING_RADIUS}
              strokeDasharray={`${RING_CIRCUMFERENCE * triggerPercent / 100} ${RING_CIRCUMFERENCE}`}
              transform="rotate(-90 7 7)"
            />
          )}
        </svg>
        <span className={styles.triggerText}>{triggerPercent === null ? '·' : triggerPercent + '%'}</span>
      </button>
      {open && (
        <div
          className={styles.panel}
          ref={panelRef}
          role="dialog"
          aria-label={t('context.occupancy')}
          style={position === null ? undefined : {
            position: 'fixed',
            left: position.left + 'px',
            top: position.top + 'px',
            right: 'auto',
            bottom: 'auto',
            margin: 0,
          }}
        >
          <div className={styles.panelHeader}>
            <button
              type="button"
              className={styles.dragHandle}
              aria-label={t('context.drag')}
              title={t('context.drag')}
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <svg viewBox="0 0 8 12" width="8" height="12" aria-hidden="true">
                <circle cx="2" cy="2" r="1.1" /><circle cx="6" cy="2" r="1.1" />
                <circle cx="2" cy="6" r="1.1" /><circle cx="6" cy="6" r="1.1" />
                <circle cx="2" cy="10" r="1.1" /><circle cx="6" cy="10" r="1.1" />
              </svg>
            </button>
            <span className={styles.headline}>{t('context.occupancy')}</span>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={detail ? t('context.compactMode') : t('context.detailMode')}
              title={detail ? t('context.compactMode') : t('context.detailMode')}
              onClick={() => { setDetail(!detail) }}
            >
              {detail ? '▴' : '▾'}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              aria-label={t('context.close')}
              title={t('context.close')}
              onClick={() => { setOpen(false) }}
            >
              ✕
            </button>
          </div>

          <div className={styles.keyFigures}>
            <span className={styles.figures}>
              {occupancy !== null
                ? t('context.occupancySummary', {
                  percent: String(occupancy.percent),
                  used: formatTokens(occupancy.usedTokens),
                  window: formatTokens(occupancy.contextWindow),
                })
                : usageTotal > 0 ? t('context.usageTotal', { total: formatTokens(usageTotal) }) : '—'}
            </span>
            {hasProviderRows && providerUsage !== undefined && (
              <span className={styles.costInline}>{formatMoney(totalCost, providerUsage.currency)}</span>
            )}
          </div>

          {!detail ? (
            <>
              {!anyData && <p className={styles.empty}>{t('context.noUsage')}</p>}
            </>
          ) : (
            <>
              {segments.length > 0 && (
                <div
                  className={styles.bar}
                  role="img"
                  aria-label={breakdown === undefined ? triggerLabel : t('context.composition')}
                >
                  {segments.map((segment) => (
                    <span
                      key={segment.key}
                      className={segment.color === '' ? styles.segment : styles.segment + ' ' + segment.color}
                      style={{ width: segment.width + '%' }}
                    />
                  ))}
                </div>
              )}

              {breakdown !== undefined && compositionTotal > 0 && (
                <div className={styles.rows}>
                  {COMPOSITION_ROWS.map((row) => (
                    <div className={styles.row} key={row.key}>
                      <dt><span className={styles.swatch + ' ' + row.color} aria-hidden="true" />{t(row.label)}</dt>
                      <dd>≈{formatTokens(breakdown[row.key])}</dd>
                    </div>
                  ))}
                </div>
              )}

              {toolRows.length > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>{t('context.toolUsage')}</h3>
                  <div className={styles.toolHeader} aria-hidden="true">
                    <span className={styles.toolName}>{t('context.toolHeader')}</span>
                    <span className={styles.toolCalls}>{t('context.callsHeader')}</span>
                    <span className={styles.toolTokens}>{t('context.tokensHeader')}</span>
                  </div>
                  <ul className={styles.toolList}>
                    {toolRows.map((tool) => (
                      <li className={styles.toolRow} key={tool.name}>
                        <span className={styles.toolName} title={tool.name}>{tool.name}</span>
                        <span className={styles.toolCalls}>{t('context.toolCalls', { calls: String(tool.calls) })}</span>
                        <span className={styles.toolTokens} title={t('context.tokensHint')}>
                          ≈{formatTokens(tool.tokens)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {hasProviderRows && providerUsage !== undefined && (
                <>
                  <h3 className={styles.sectionTitle}>
                    {t('context.cost')}
                    <span className={styles.sectionHint}>
                      {t('context.costEstimated')}
                      {peakLabel !== null && providerUsage.timeZone !== undefined && (
                        ' · ' + t('context.peakHours', { hours: peakLabel, timeZone: providerUsage.timeZone })
                      )}
                    </span>
                  </h3>
                  <div className={styles.providerList}>
                    {modelsByCost.map((model) => (
                      <div className={styles.providerCard} key={model.provider + '\u0000' + model.model}>
                        <div className={styles.providerLine}>
                          <span className={styles.providerName}>{model.model}</span>
                          <span className={styles.providerModel}>{model.provider}</span>
                          <span className={styles.providerCost}>{formatMoney(model.cost, currency)}</span>
                        </div>
                        <div className={styles.providerTokensLine}>
                          <span className={styles.providerTokens}>
                            {t('context.providerUsage', {
                              input: formatTokens(billedInputTokens(model)),
                              output: formatTokens(model.outputTokens),
                            })}
                          </span>
                          {model.priceUrl !== undefined && (
                            <a
                              className={styles.priceLink}
                              href={model.priceUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(event) => { event.stopPropagation() }}
                            >{t('context.officialPrice')}</a>
                          )}
                        </div>
                      </div>
                    ))}
                    {unattributedTokens > 0 && (
                      <div className={styles.providerCard}>
                        <div className={styles.providerLine}>
                          <span className={styles.providerName}>{t('context.unattributed')}</span>
                          <span className={styles.providerCost}>{formatMoney(providerUsage.unattributedCost, currency)}</span>
                        </div>
                        <div className={styles.providerTokensLine}>
                          <span className={styles.providerTokens}>
                            {t('context.providerUsage', {
                              input: formatTokens(billedInputTokens(providerUsage.unattributed)),
                              output: formatTokens(providerUsage.unattributed.outputTokens),
                            })}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <p className={styles.priceNote}>{t('context.priceNote')}</p>
                </>
              )}

              {usage !== undefined && usageTotal > 0 && (
                <>
                  <h3 className={styles.sectionTitle}>{t('context.tokens')}</h3>
                  <div className={styles.rows}>
                    <div className={styles.row}>
                      <dt>{t('context.usageInput')}</dt>
                      <dd>{formatTokens(billedInputTokens(usage))}</dd>
                    </div>
                    <div className={styles.row}>
                      <dt>{t('context.usageOutput')}</dt>
                      <dd>{formatTokens(usage.outputTokens)}</dd>
                    </div>
                    {cacheHit !== null && (
                      <div className={styles.row}>
                        <dt>{t('context.cacheHit', { percent: String(cacheHit) })}</dt>
                        <dd>{formatTokens(usage.cacheReadTokens)}</dd>
                      </div>
                    )}
                  </div>
                </>
              )}

              {!anyData && <p className={styles.empty}>{t('context.noUsage')}</p>}
            </>
          )}
        </div>
      )}
    </span>
  )
})
