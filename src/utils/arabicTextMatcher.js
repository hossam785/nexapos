/**
 * arabicTextMatcher.js
 * 
 * High-Performance Arabic Text Normalization & Fuzzy Similarity Matcher Engine.
 * 
 * Solves real-world phonetic, orthographic, and diacritic variations in Arabic product names:
 * 1. Alef Normalization: [أ, إ, آ, ٱ] -> ا
 * 2. Yaa Normalization: [ى, ئ] -> ي
 * 3. Taa Marbuta Normalization: ة -> ه
 * 4. Tashkeel / Diacritic & Tatweel Removal
 * 5. Number & Unit Separation: (50جم -> 50 جم)
 * 6. Order-Agnostic Token Matching
 * 7. Fast Linear-Time Sørensen-Dice Bigram Fuzzy Similarity
 */

import { normalizeDigits } from './reconciliationSanitizer.js'

/**
 * Common packaging/auxiliary stopwords in Arabic retail that do not define product essence.
 */
const COMMON_ARABIC_STOPWORDS = new Set([
  'كرتونة', 'كرتونه', 'كرتون', 'علبة', 'علبه', 'علب', 'كيس', 'اكياس', 'باكو', 'بواكي',
  'حبة', 'حبه', 'قطعة', 'قطعه', 'شريط', 'زجاجة', 'زجاجه', 'ازازة', 'ازازه', 'لتر',
  'كيلو', 'كيلوجرام', 'كجم', 'كغ', 'جم', 'جرام', 'مل', 'ملل'
])

/**
 * Normalizes Arabic text into a clean canonical form for deterministic comparison.
 * 
 * @param {any} text
 * @returns {string}
 */
export function canonicalizeArabicText(text) {
  if (text === null || text === undefined) return ''

  let str = normalizeDigits(text).trim().toLowerCase()
  if (!str) return ''

  // 1. Remove Unicode direction marks & zero-width chars
  str = str.replace(/[\u200e\u200f\u200b\ufeff\u202a-\u202e]/g, '')

  // 2. Remove Arabic diacritics (tashkeel & tanween)
  str = str.replace(/[\u064B-\u065F\u0670]/g, '')

  // 3. Remove Tatweel (kashida)
  str = str.replace(/\u0640/g, '')

  // 4. Normalize Alef variants [أ, إ, آ, ٱ] to bare Alef [ا]
  str = str.replace(/[أإآٱ]/g, 'ا')

  // 5. Normalize Yaa variants [ى, ئ] to [ي]
  str = str.replace(/[ىئ]/g, 'ي')

  // 6. Normalize Taa Marbuta [ة] to [ه]
  str = str.replace(/ة/g, 'ه')

  // 7. Separate digits and text boundaries (e.g., "50جم" -> "50 جم", "330ml" -> "330 ml")
  str = str.replace(/(\d+)([\p{L}])/gu, '$1 $2')
  str = str.replace(/([\p{L}])(\d+)/gu, '$1 $2')

  // 8. Replace punctuation, symbols, and underscores with space
  str = str.replace(/[_\-./\\#*+(),:;!?[\]{}<>"'`~@$%^&=|]+/g, ' ')

  // 9. Collapse multiple spaces
  str = str.replace(/\s+/g, ' ').trim()

  return str
}

/**
 * Splits canonical text into filtered, order-independent token keys.
 * 
 * @param {string} canonicalText
 * @param {boolean} [filterStopwords=false]
 * @returns {{ tokenList: string[], sortedKey: string, tokenSet: Set<string> }}
 */
export function tokenizeArabicText(canonicalText, filterStopwords = false) {
  if (!canonicalText) {
    return { tokenList: [], sortedKey: '', tokenSet: new Set() }
  }

  const rawTokens = canonicalText.split(' ').filter(Boolean)
  const tokenList = filterStopwords
    ? rawTokens.filter(t => !COMMON_ARABIC_STOPWORDS.has(t))
    : rawTokens

  const finalTokens = tokenList.length ? tokenList : rawTokens
  const tokenSet = new Set(finalTokens)
  const sortedKey = Array.from(tokenSet).sort().join(' ')

  return {
    tokenList: finalTokens,
    sortedKey,
    tokenSet
  }
}

/**
 * Extracts character bigrams from a string for Sørensen-Dice coefficient similarity.
 * 
 * @param {string} str
 * @returns {Set<string>}
 */
function getBigrams(str) {
  const bigrams = new Set()
  if (!str || str.length < 2) {
    if (str) bigrams.add(str)
    return bigrams
  }
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.add(str.slice(i, i + 2))
  }
  return bigrams
}

/**
 * Computes fast Sørensen-Dice similarity score between two strings [0.0 - 1.0].
 * Linear time complexity O(L1 + L2), zero memory thrashing.
 * 
 * @param {string} strA
 * @param {string} strB
 * @returns {number}
 */
export function computeBigramDiceSimilarity(strA, strB) {
  if (strA === strB) return 1.0
  if (!strA || !strB) return 0.0

  if (strA.length === 1 && strB.length === 1) {
    return strA === strB ? 1.0 : 0.0
  }

  const bigramsA = getBigrams(strA)
  const bigramsB = getBigrams(strB)

  let intersectionSize = 0
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) {
      intersectionSize++
    }
  }

  const total = bigramsA.size + bigramsB.size
  return total > 0 ? Number(((2 * intersectionSize) / total).toFixed(3)) : 0.0
}

/**
 * Computes Jaccard similarity between two token sets [0.0 - 1.0].
 * 
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number}
 */
export function computeTokenJaccardSimilarity(setA, setB) {
  if (!setA.size || !setB.size) return 0.0

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++
    }
  }

  const union = setA.size + setB.size - intersection
  return union > 0 ? Number((intersection / union).toFixed(3)) : 0.0
}

/**
 * Pre-indexes a collection of database products for multi-tier text matching.
 * 
 * @param {Array<Object>} products
 * @returns {Object} Optimized in-memory search index
 */
export function buildNameLookupIndex(products = []) {
  const canonicalMap = new Map() // canonicalName -> Product
  const sortedTokensMap = new Map() // sortedTokenKey -> Product
  const indexedList = []

  const list = Array.isArray(products)
    ? products
    : (products && typeof products === 'object' ? Object.values(products) : [])

  for (const p of list) {
    if (!p) continue
    const rawName = p.product_name || p.name
    if (!rawName) continue

    const canonical = canonicalizeArabicText(rawName)
    if (!canonical) continue

    // Tier 1 exact map
    if (!canonicalMap.has(canonical)) {
      canonicalMap.set(canonical, p)
    }

    // Tier 2 token sorted key
    const tokenized = tokenizeArabicText(canonical, true)
    if (tokenized.sortedKey && !sortedTokensMap.has(tokenized.sortedKey)) {
      sortedTokensMap.set(tokenized.sortedKey, p)
    }

    // Tier 3 candidate list
    indexedList.push({
      canonical,
      tokenSet: tokenized.tokenSet,
      bigrams: getBigrams(canonical),
      product: p
    })
  }

  // Tier 4 Inverted bigram index for sub-millisecond sparse lookup
  const bigramInvertedMap = new Map()
  for (let i = 0; i < indexedList.length; i++) {
    const item = indexedList[i]
    for (const bg of item.bigrams) {
      let bucket = bigramInvertedMap.get(bg)
      if (!bucket) {
        bucket = []
        bigramInvertedMap.set(bg, bucket)
      }
      bucket.push(i)
    }
  }

  return {
    canonicalMap,
    sortedTokensMap,
    indexedList,
    bigramInvertedMap,
    totalIndexed: indexedList.length
  }
}

/**
 * Matches a single Excel product name against the name lookup index.
 * 
 * Tier 1: Exact Canonical Match (Confidence: 1.0)
 * Tier 2: Token-Set Match (Confidence: 0.92 - 0.95)
 * Tier 3: Bigram Sørensen-Dice Fuzzy Match (Confidence: threshold - 0.95)
 * 
 * @param {string} rawName
 * @param {Object} lookupIndex
 * @param {number} [minFuzzyThreshold=0.80]
 * @returns {Object} Match resolution result
 */
export function matchSingleName(rawName, lookupIndex, minFuzzyThreshold = 0.80) {
  const canonical = canonicalizeArabicText(rawName)
  if (!canonical) {
    return {
      matched: false,
      reason: 'EMPTY_NAME',
      product: null,
      tier: null,
      confidence: 0
    }
  }

  const { canonicalMap, sortedTokensMap, indexedList } = lookupIndex

  // Tier 1: Exact Canonical Match
  if (canonicalMap.has(canonical)) {
    return {
      matched: true,
      product: canonicalMap.get(canonical),
      tier: 'EXACT_CANONICAL',
      matchField: 'name',
      confidence: 1.0,
      canonical
    }
  }

  // Tier 2: Order-Agnostic Token-Set Match
  const tokenized = tokenizeArabicText(canonical, true)
  if (tokenized.sortedKey && sortedTokensMap.has(tokenized.sortedKey)) {
    return {
      matched: true,
      product: sortedTokensMap.get(tokenized.sortedKey),
      tier: 'TOKEN_SET_MATCH',
      matchField: 'name_tokens',
      confidence: 0.94,
      canonical
    }
  }

  // Tier 3: Bigram Sørensen-Dice Similarity against candidates
  let bestScore = 0
  let bestProduct = null
  const targetBigrams = getBigrams(canonical)
  const targetSize = targetBigrams.size

  if (targetSize > 0) {
    if (lookupIndex.bigramInvertedMap) {
      const candidateIntersections = new Map()
      for (const bg of targetBigrams) {
        const bucket = lookupIndex.bigramInvertedMap.get(bg)
        if (bucket) {
          for (let j = 0; j < bucket.length; j++) {
            const idx = bucket[j]
            candidateIntersections.set(idx, (candidateIntersections.get(idx) || 0) + 1)
          }
        }
      }

      for (const [idx, intersection] of candidateIntersections.entries()) {
        const item = indexedList[idx]
        if (Math.abs(item.canonical.length - canonical.length) > 12) continue
        const score = (2 * intersection) / (targetSize + item.bigrams.size)
        if (score > bestScore) {
          bestScore = score
          bestProduct = item.product
          if (bestScore >= 0.95) break
        }
      }
    } else {
      for (let i = 0; i < indexedList.length; i++) {
        const item = indexedList[i]
        if (Math.abs(item.canonical.length - canonical.length) > 12) continue
        let intersection = 0
        for (const bg of targetBigrams) {
          if (item.bigrams.has(bg)) intersection++
        }
        const score = (2 * intersection) / (targetSize + item.bigrams.size)
        if (score > bestScore) {
          bestScore = score
          bestProduct = item.product
          if (bestScore >= 0.95) break
        }
      }
    }
  }

  if (bestScore >= minFuzzyThreshold && bestProduct) {
    return {
      matched: true,
      product: bestProduct,
      tier: 'FUZZY_BIGRAM',
      matchField: 'fuzzy_name',
      confidence: Number(bestScore.toFixed(3)),
      canonical
    }
  }

  return {
    matched: false,
    reason: 'NO_NAME_MATCH',
    product: null,
    tier: null,
    confidence: Number(bestScore.toFixed(3))
  }
}

/**
 * Resolves unmatched Excel rows using Arabic text normalization and fuzzy similarity.
 * 
 * @param {Array<Object>} unmatchedRows - Rows that failed barcode matching in Phase 5
 * @param {Object} nameLookupIndex - Result of buildNameLookupIndex
 * @param {number} [minFuzzyThreshold=0.80]
 * @returns {Object} Resolution report
 */
export function matchUnmatchedRowsByName(unmatchedRows = [], nameLookupIndex, minFuzzyThreshold = 0.80) {
  const tStart = performance.now()

  const resolvedRows = []
  const remainingUnmatchedRows = []

  let countCanonical = 0
  let countTokens = 0
  let countFuzzy = 0

  for (let i = 0; i < unmatchedRows.length; i++) {
    const row = unmatchedRows[i]
    if (!row) continue

    const resolution = matchSingleName(row.excelName || row.name, nameLookupIndex, minFuzzyThreshold)

    if (resolution.matched) {
      const p = resolution.product
      const packSize = p.dozen_enabled ? (Number(p.pack_size) || Number(p.dozen_quantity) || 1) : 1

      if (resolution.tier === 'EXACT_CANONICAL') countCanonical++
      else if (resolution.tier === 'TOKEN_SET_MATCH') countTokens++
      else if (resolution.tier === 'FUZZY_BIGRAM') countFuzzy++

      resolvedRows.push({
        ...row,
        matchedProduct: {
          product_id: p.product_id || p.id,
          product_name: p.product_name || p.name,
          barcode: p.barcode,
          dozen_barcode: p.dozen_barcode || null,
          scale_code: p.scale_code || null,
          unit: p.unit || 'piece',
          pack_size: packSize,
          sell_price: Number(p.sell_price) || 0,
          cost_price: Number(p.cost_price) || 0,
          system_quantity: Number(p.system_quantity) || 0,
          category_name: p.category_name || null,
          matchTier: resolution.tier,
          matchField: resolution.matchField,
          matchConfidence: resolution.confidence
        }
      })
    } else {
      remainingUnmatchedRows.push({
        ...row,
        unmatchedReason: resolution.reason || 'NO_NAME_OR_BARCODE_MATCH',
        closestConfidence: resolution.confidence || 0
      })
    }
  }

  const executionTimeMs = (performance.now() - tStart).toFixed(2)
  const totalProcessed = unmatchedRows.length
  const resolutionRatePercent = totalProcessed > 0
    ? Number(((resolvedRows.length / totalProcessed) * 100).toFixed(1))
    : 0

  return {
    success: true,
    totalProcessed,
    resolvedCount: resolvedRows.length,
    remainingUnmatchedCount: remainingUnmatchedRows.length,
    resolutionRatePercent,
    tierBreakdown: {
      exactCanonical: countCanonical,
      tokenSet: countTokens,
      fuzzyBigram: countFuzzy
    },
    resolvedRows,
    remainingUnmatchedRows,
    executionTimeMs: Number(executionTimeMs)
  }
}

/**
 * Finds top fuzzy candidates for an unmatched name with similarity above threshold.
 * 
 * @param {string} rawName
 * @param {Object} lookupIndex
 * @param {number} [limit=3]
 * @param {number} [minThreshold=0.60]
 * @returns {Array<{ product: Object, similarity: number }>}
 */
export function findTopFuzzyCandidates(rawName, lookupIndex, limit = 3, minThreshold = 0.60) {
  const canonical = canonicalizeArabicText(rawName)
  if (!canonical || !lookupIndex?.indexedList) return []

  const targetBigrams = getBigrams(canonical)
  const targetSize = targetBigrams.size
  if (targetSize === 0) return []

  const candidates = []

  if (lookupIndex.bigramInvertedMap) {
    const candidateIntersections = new Map()
    for (const bg of targetBigrams) {
      const bucket = lookupIndex.bigramInvertedMap.get(bg)
      if (bucket) {
        for (let j = 0; j < bucket.length; j++) {
          const idx = bucket[j]
          candidateIntersections.set(idx, (candidateIntersections.get(idx) || 0) + 1)
        }
      }
    }

    for (const [idx, intersection] of candidateIntersections.entries()) {
      const item = lookupIndex.indexedList[idx]
      if (Math.abs(item.canonical.length - canonical.length) > 15) continue
      const score = (2 * intersection) / (targetSize + item.bigrams.size)
      if (score >= minThreshold) {
        candidates.push({
          product: item.product,
          similarity: Number(score.toFixed(3))
        })
      }
    }
  } else {
    for (let i = 0; i < lookupIndex.indexedList.length; i++) {
      const item = lookupIndex.indexedList[i]
      if (Math.abs(item.canonical.length - canonical.length) > 15) continue
      let intersection = 0
      for (const bg of targetBigrams) {
        if (item.bigrams.has(bg)) intersection++
      }
      const score = (2 * intersection) / (targetSize + item.bigrams.size)
      if (score >= minThreshold) {
        candidates.push({
          product: item.product,
          similarity: Number(score.toFixed(3))
        })
      }
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity)
  return candidates.slice(0, limit)
}

export const buildArabicNameIndex = buildNameLookupIndex
export default matchUnmatchedRowsByName

