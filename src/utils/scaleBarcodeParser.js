export const DEFAULT_SCALE_BARCODE_SETTINGS = {
  enabled: true,
  barcodeLength: 13,
  prefix: '21',
  prefixStart: 0,
  prefixLength: 2,
  productCodeStart: 2,
  productCodeLength: 5,
  valueStart: 7,
  valueLength: 5,
  decimalPlaces: 3,
}

function readSetting(settings, names, fallback) {
  for (const name of names) {
    if (settings?.[name] !== undefined && settings[name] !== null && settings[name] !== '') {
      return settings[name]
    }
  }
  return fallback
}

function asInt(value, fallback, min = 0) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < min) return fallback
  return parsed
}

function asBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  return !['0', 'false', 'off', 'no'].includes(text)
}

export function getScaleBarcodeSettings(settings = {}) {
  const barcodeLength = asInt(
    readSetting(settings, ['scale_barcode_length', 'scaleBarcodeLength'], DEFAULT_SCALE_BARCODE_SETTINGS.barcodeLength),
    DEFAULT_SCALE_BARCODE_SETTINGS.barcodeLength,
    1
  )
  const prefix = String(
    readSetting(settings, ['scale_barcode_prefix', 'scaleBarcodePrefix'], DEFAULT_SCALE_BARCODE_SETTINGS.prefix)
  ).trim()

  return {
    enabled: asBool(
      readSetting(settings, ['scale_barcode_enabled', 'scaleBarcodeEnabled'], DEFAULT_SCALE_BARCODE_SETTINGS.enabled),
      DEFAULT_SCALE_BARCODE_SETTINGS.enabled
    ),
    barcodeLength,
    prefix,
    prefixStart: asInt(
      readSetting(settings, ['scale_prefix_start', 'scaleBarcodePrefixStart'], DEFAULT_SCALE_BARCODE_SETTINGS.prefixStart),
      DEFAULT_SCALE_BARCODE_SETTINGS.prefixStart
    ),
    prefixLength: asInt(
      readSetting(settings, ['scale_prefix_length', 'scaleBarcodePrefixLength'], prefix.length || DEFAULT_SCALE_BARCODE_SETTINGS.prefixLength),
      prefix.length || DEFAULT_SCALE_BARCODE_SETTINGS.prefixLength,
      1
    ),
    productCodeStart: asInt(
      readSetting(settings, ['scale_product_code_start', 'scaleProductCodeStart'], DEFAULT_SCALE_BARCODE_SETTINGS.productCodeStart),
      DEFAULT_SCALE_BARCODE_SETTINGS.productCodeStart
    ),
    productCodeLength: asInt(
      readSetting(settings, ['scale_product_code_length', 'scaleProductCodeLength'], DEFAULT_SCALE_BARCODE_SETTINGS.productCodeLength),
      DEFAULT_SCALE_BARCODE_SETTINGS.productCodeLength,
      1
    ),
    valueStart: asInt(
      readSetting(settings, ['scale_value_start', 'scaleValueStart'], DEFAULT_SCALE_BARCODE_SETTINGS.valueStart),
      DEFAULT_SCALE_BARCODE_SETTINGS.valueStart
    ),
    valueLength: asInt(
      readSetting(settings, ['scale_value_length', 'scaleValueLength'], DEFAULT_SCALE_BARCODE_SETTINGS.valueLength),
      DEFAULT_SCALE_BARCODE_SETTINGS.valueLength,
      1
    ),
    decimalPlaces: asInt(
      readSetting(settings, ['scale_decimal_places', 'scaleDecimalPlaces'], DEFAULT_SCALE_BARCODE_SETTINGS.decimalPlaces),
      DEFAULT_SCALE_BARCODE_SETTINGS.decimalPlaces
    ),
  }
}

export function validateCheckDigit(barcode) {
  const text = String(barcode || '').trim()
  if (!/^\d{2,}$/.test(text)) return false

  const digits = text.split('').map(Number)
  const check = digits.pop()
  const sum = digits.reverse().reduce((acc, digit, index) => (
    acc + (index % 2 === 0 ? digit * 3 : digit)
  ), 0)

  return (10 - (sum % 10)) % 10 === check
}

function hasValidSlices(config) {
  const ranges = [
    [config.prefixStart, config.prefixLength],
    [config.productCodeStart, config.productCodeLength],
    [config.valueStart, config.valueLength],
  ]
  return ranges.every(([start, length]) => (
    Number.isInteger(start) &&
    Number.isInteger(length) &&
    start >= 0 &&
    length > 0 &&
    start + length <= config.barcodeLength
  ))
}

export function parseScaleBarcode(barcode, settings = {}) {
  const raw = String(barcode || '').trim()
  const config = getScaleBarcodeSettings(settings)

  if (!config.enabled) return { isScaleBarcode: false, reason: 'disabled' }
  if (!/^\d+$/.test(raw)) return { isScaleBarcode: false, reason: 'non_numeric' }
  if (raw.length !== config.barcodeLength) return { isScaleBarcode: false, reason: 'invalid_length' }
  if (!hasValidSlices(config)) return { isScaleBarcode: false, reason: 'invalid_settings' }

  const prefixValue = raw.slice(config.prefixStart, config.prefixStart + config.prefixLength)
  if (prefixValue !== config.prefix) return { isScaleBarcode: false, reason: 'prefix_mismatch' }

  if (!validateCheckDigit(raw)) return { isScaleBarcode: false, reason: 'invalid_check_digit' }

  const productCode = raw.slice(config.productCodeStart, config.productCodeStart + config.productCodeLength)
  const valueText = raw.slice(config.valueStart, config.valueStart + config.valueLength)

  if (!/^\d+$/.test(productCode) || !productCode) {
    return { isScaleBarcode: false, reason: 'invalid_product_code' }
  }
  if (!/^\d+$/.test(valueText)) {
    return { isScaleBarcode: false, reason: 'invalid_value' }
  }

  const rawValue = Number.parseInt(valueText, 10)
  const weight = rawValue / Math.pow(10, config.decimalPlaces)
  if (!Number.isFinite(weight) || weight <= 0) {
    return { isScaleBarcode: false, reason: 'invalid_weight' }
  }

  return {
    isScaleBarcode: true,
    productCode,
    valueType: 'weight',
    weight,
    value: weight,
    rawValue: valueText,
    barcode: raw,
    config,
  }
}

export default parseScaleBarcode
