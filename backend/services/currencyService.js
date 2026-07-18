/**
 * Canonical currency handling for Appointy.
 * Storage / APIs use uppercase ISO codes (e.g. PKR).
 * Stripe Checkout expects lowercase (e.g. pkr).
 */

const CURRENCY_ALIASES = {
  RS: 'PKR',
  'RS.': 'PKR',
  RUPEE: 'PKR',
  RUPEES: 'PKR',
}

export const getConfiguredCurrency = () => {
  const raw = process.env.CURRENCY || 'PKR'
  return normalizeCurrency(raw)
}

/**
 * Normalize any currency-like input to a canonical uppercase ISO code.
 * @param {unknown} input
 * @returns {string}
 */
export const normalizeCurrency = (input) => {
  if (input == null) {
    return getConfiguredCurrency()
  }

  const cleaned = String(input).trim().toUpperCase().replace(/\s+/g, '')
  if (!cleaned) {
    return getConfiguredCurrency()
  }

  return CURRENCY_ALIASES[cleaned] || cleaned
}

/**
 * Stripe API currency parameter (lowercase ISO).
 * @param {unknown} [input]
 * @returns {string}
 */
export const toStripeCurrency = (input) =>
  normalizeCurrency(input ?? getConfiguredCurrency()).toLowerCase()

/**
 * Compare two currency values after normalization.
 */
export const currenciesMatch = (a, b) =>
  normalizeCurrency(a) === normalizeCurrency(b)
