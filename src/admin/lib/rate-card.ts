/**
 * @module rate-card
 *
 * Token rate card — loads per-model pricing from a config file
 * and computes costs from token counts.
 *
 * Rates are in $/MTok (dollars per million tokens). The rate card
 * is the single source of truth for cost computation; OpenClaw's
 * per-message cost data is not used.
 *
 * Config dependencies: TOKEN_RATES_PATH from constants.ts.
 */

import { readJson } from '@karmaniverous/jeeves';

import { TOKEN_RATES_PATH } from '../../lib/constants.js';
import type { TokenCategory } from '../types/token-metrics.js';
import { TOKEN_CATEGORIES } from '../types/token-metrics.js';

/** Per-model rates in $/MTok. */
export type ModelRates = Record<TokenCategory, number>;

/** Full rate card config file schema. */
export interface RateCardConfig {
  updatedAt: string;
  source?: string;
  unit: string;
  models: Record<string, ModelRates>;
}

/** Singleton cache. */
let _rateCard: RateCardConfig | null = null;

/**
 * Load the rate card from disk. Cached after first load.
 * Call `resetRateCard()` to force a reload.
 */
export function loadRateCard(): RateCardConfig {
  if (!_rateCard) {
    const card = readJson<RateCardConfig | null>(TOKEN_RATES_PATH, null);
    if (!card) {
      throw new Error(
        `Token rate card not found at ${TOKEN_RATES_PATH}. ` +
          'Create it with per-model $/MTok rates.',
      );
    }
    _rateCard = card;
  }
  return _rateCard;
}

/** Clear cached rate card (for testing or after config update). */
export function resetRateCard(): void {
  _rateCard = null;
}

/**
 * Get rates for a specific model. Returns zero rates if the
 * model is not in the rate card (with a console warning).
 */
export function getModelRates(model: string): ModelRates {
  const card = loadRateCard();
  const rates = card.models[model] as ModelRates | undefined;
  if (rates) return rates;

  console.warn(`[rate-card] No rates for model "${model}", using zero`);
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

/**
 * Compute cost for a set of token counts using the rate card.
 *
 * @param model - Model key (e.g. "anthropic/claude-opus-4-6")
 * @param counts - Token counts per category
 * @returns Cost per category in dollars
 */
export function computeCosts(
  model: string,
  counts: Record<TokenCategory, number>,
): Record<TokenCategory, number> {
  const rates = getModelRates(model);
  const costs = {} as Record<TokenCategory, number>;

  for (const cat of TOKEN_CATEGORIES) {
    // rates are $/MTok, so divide by 1M to get per-token rate
    costs[cat] = (counts[cat] * rates[cat]) / 1_000_000;
  }

  return costs;
}
