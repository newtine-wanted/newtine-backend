import type { InterestEventType } from './interest.model.js';

/** Returns the current contribution for an explicit issue action. */
export function interactionActionScore(action: InterestEventType | null): number {
  if (action === 'LIKE') return 2;
  if (action === 'SKIP') return -3;
  return 0;
}

/** Returns only the transition delta so repeated actions are idempotent. */
export function interactionActionDelta(
  previous: InterestEventType | null,
  next: InterestEventType,
): number {
  return interactionActionScore(next) - interactionActionScore(previous);
}

/** Maps cumulative active detail time to the bounded recommendation contribution. */
export function detailDwellScore(activeMilliseconds: number): 0 | 0.5 | 1 {
  if (activeMilliseconds >= 30_000) return 1;
  if (activeMilliseconds >= 10_000) return 0.5;
  return 0;
}

/**
 * Adds only the newly accepted time from one detail view to the member/issue
 * aggregate. Each view reports a monotonic value, while the contribution is
 * capped across all views at thirty seconds.
 */
export function detailDwellContribution(
  storedCreditedMilliseconds: number,
  currentViewMilliseconds: number,
  acceptedViewMilliseconds: number,
): { readonly creditedMilliseconds: number; readonly dwellScore: 0 | 0.5 | 1 } {
  const stored = Math.max(
    0,
    Number.isFinite(storedCreditedMilliseconds) ? storedCreditedMilliseconds : 0,
  );
  const current = Math.max(
    0,
    Number.isFinite(currentViewMilliseconds) ? currentViewMilliseconds : 0,
  );
  const accepted = Math.max(
    0,
    Number.isFinite(acceptedViewMilliseconds) ? acceptedViewMilliseconds : 0,
  );
  const viewDelta = Math.max(0, accepted - current);
  const creditedMilliseconds = Math.min(30_000, stored + viewDelta);
  return { creditedMilliseconds, dwellScore: detailDwellScore(creditedMilliseconds) };
}
