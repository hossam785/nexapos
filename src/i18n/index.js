import { EN_TRANSLATIONS } from './en'
import { EN_SHELL_TRANSLATIONS } from './en-shell'
import { EN_CASHIER_TRANSLATIONS } from './en-cashier'
import { EN_PRODUCTS_TRANSLATIONS } from './en-products'
import { EN_SETTINGS_TRANSLATIONS } from './en-settings'
import { EN_COMMERCE_TRANSLATIONS } from './en-commerce'
import { EN_REPORTS_TRANSLATIONS } from './en-reports'
import { EN_OPERATIONS_TRANSLATIONS } from './en-operations'
import { EN_FINAL_TRANSLATIONS } from './en-final'
import { EN_FRAGMENT_TRANSLATIONS } from './en-fragments'
import { EN_LAST_TRANSLATIONS } from './en-last'
import { EN_AUDIT_TRANSLATIONS } from './en-audit'
import { EN_LOYALTY_TRANSLATIONS } from './en-loyalty'

const TRANSLATIONS = {
  ...EN_TRANSLATIONS,
  ...EN_SHELL_TRANSLATIONS,
  ...EN_CASHIER_TRANSLATIONS,
  ...EN_PRODUCTS_TRANSLATIONS,
  ...EN_SETTINGS_TRANSLATIONS,
  ...EN_COMMERCE_TRANSLATIONS,
  ...EN_REPORTS_TRANSLATIONS,
  ...EN_OPERATIONS_TRANSLATIONS,
  ...EN_FINAL_TRANSLATIONS,
  ...EN_FRAGMENT_TRANSLATIONS,
  ...EN_LAST_TRANSLATIONS,
  ...EN_AUDIT_TRANSLATIONS,
  ...EN_LOYALTY_TRANSLATIONS,
}

export const LANGUAGE_STORAGE_KEY = 'mgpos.language'
export const DEFAULT_LANGUAGE = 'ar'

let currentLanguage = DEFAULT_LANGUAGE
let observer = null
const originalText = new WeakMap()
const translatedText = new WeakMap()
const originalAttributes = new WeakMap()

const ENGLISH_CURRENCY_SYMBOLS = Object.freeze({
  'ج.م': 'EGP',
  'ر.س': 'SAR',
  'د.إ': 'AED',
  'د.ك': 'KWD',
  'د.أ': 'JOD',
  'ر.ع': 'OMR',
  'ر.ق': 'QAR',
  'د.ب': 'BHD',
  'ر.ي': 'YER',
  '﷼': 'YER',
  'د.ج': 'DZD',
  'د.ت': 'TND',
  'ل.ل': 'LBP',
  'د.ل': 'LYD',
  'د.م': 'MAD',
})

function translateCurrencySymbols(value, language = currentLanguage) {
  if (normalizeLanguage(language) !== 'en' || typeof value !== 'string') return value

  let translated = value
  for (const [symbol, code] of Object.entries(ENGLISH_CURRENCY_SYMBOLS)) {
    translated = translated.split(symbol).join(code)
  }
  return translated
}

export function getCurrencyDisplay(value, language = currentLanguage) {
  const source = String(value ?? '')
  if (normalizeLanguage(language) !== 'en') return source
  return ENGLISH_CURRENCY_SYMBOLS[source.trim()] || source
}

const DYNAMIC_TRANSLATIONS = [
  [/^حتى\s+(\d+(?:\.\d+)?)\s+نقطة$/u, (_, value) => 'Up to ' + value + (Number(value) === 1 ? ' point' : ' points')],
  [/^(.+)\s+-\s+(\d+(?:\.\d+)?)\s+نقطة$/u, (_, name, value) => name + ' - ' + value + (Number(value) === 1 ? ' point' : ' points')],
  [/^الرصيد\s+(\d+(?:\.\d+)?)$/u, (_, value) => 'Balance ' + value],
  [/^(\d+(?:\.\d+)?)\s+نقطة$/u, (_, value) => value + (Number(value) === 1 ? ' point' : ' points')],
  [/^(\d+)\s+عميل$/u, (_, value) => value + (Number(value) === 1 ? ' customer' : ' customers')],
  [/^(\d+)\s+حركة$/u, (_, value) => value + (Number(value) === 1 ? ' transaction' : ' transactions')],
  [/^(\d+)\s+مستويات$/u, (_, value) => value + (Number(value) === 1 ? ' level' : ' levels')],
  [/^(\d+)\s+استبدال$/u, (_, value) => value + (Number(value) === 1 ? ' redemption' : ' redemptions')],
  [/^تم استبدالها\s+(\d+)\s+مرة$/u, (_, value) => 'Redeemed ' + value + (Number(value) === 1 ? ' time' : ' times')],
  [/^\u0625\u0636\u0627\u0641\u0629\s+(.+)$/u, (_, value) => 'Add ' + value],
  [/^\u0633\.\u062a:\s*(.+)$/u, (_, value) => 'C.R.: ' + value],
  [/^\u0645\u0646\u062a\u0647\u064a\u0629 \u0645\u0646\u0630\s+(\d+)\s+\u064a\u0648\u0645$/u, (_, days) => 'Expired ' + days + ' days ago'],
  [/^\u0627\u0646\u062a\u0647\u062a \u0645\u0646\u0630\s+(\d+)\s+\u064a\u0648\u0645$/u, (_, days) => 'Expired ' + days + ' days ago'],
  [/^\u26a0\ufe0f \u0645\u0646\u062a\u0647\u064a\u0629 \u0627\u0644\u0635\u0644\u0627\u062d\u064a\u0629 \u0645\u0646\u0630\s+(\d+)\s+\u064a\u0648\u0645$/u, (_, days) => '\u26a0\ufe0f Expired ' + days + ' days ago'],
  [/^\u0645\u062a\u0628\u0642\u064a\s+(\d+)\s+(?:\u064a\u0648\u0645|\u0623\u064a\u0627\u0645)$/u, (_, days) => days + ' days remaining'],
  [/^\u0645\u062a\u0628\u0642\u064a\s+(\d+)\s+(?:\u064a\u0648\u0645|\u0623\u064a\u0627\u0645) \u0642\u0628\u0644 \u0627\u0644\u062d\u0627\u062c\u0629 \u0625\u0644\u0649 \u0627\u0644\u062a\u0641\u0639\u064a\u0644\.$/u, (_, days) => days + ' days remaining before activation is required.'],
  [/^\u0646\u0633\u062e\u0629 \u062a\u062c\u0631\u064a\u0628\u064a\u0629\u060c \u0645\u062a\u0628\u0642\u064a\s+(\d+)\s+\u064a\u0648\u0645$/u, (_, days) => 'Trial version - ' + days + ' days remaining'],
  [/^\u0641\u0627\u062a\u0648\u0631\u0629 \u0634\u0631\u0627\u0621\s*#(.+)$/u, (_, value) => 'Purchase Invoice #' + value],
  [/^\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a\s*#(.+)$/u, (_, value) => 'Sales Invoice #' + value],
  [/^\u062f\u0641\u0639\u0629 \u0639\u0644\u0649 \u0641\u0627\u062a\u0648\u0631\u0629\s*#(.+)$/u, (_, value) => 'Payment for Invoice #' + value],
  [/^\u062a\u0645 \u062a\u0639\u0644\u064a\u0642 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0631\u0642\u0645\s*#(.+)$/u, (_, value) => 'Invoice #' + value + ' was held'],
  [/^\u0644\u0627 \u062a\u0648\u062c\u062f \u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0639\u0644\u0642\u0629 \u0628\u0631\u0642\u0645\s*#(.+)\.$/u, (_, value) => 'No held invoice was found with number #' + value + '.'],
  [/^\u062a\u0645 \u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0631\u0642\u0645\s*#(.+)$/u, (_, value) => 'Invoice #' + value + ' was restored'],
  [/^\u0644\u0627 \u062a\u0648\u062c\u062f \u0641\u0627\u062a\u0648\u0631\u0629 \u0628\u0631\u0642\u0645\s*#(.+)$/u, (_, value) => 'No invoice was found with number #' + value],
  [/^\u0645\u0631\u062a\u062c\u0639\s*#([^\s]+)(?:\s*-\s*(.+))?$/u, (_, value, reason) => 'Return #' + value + (reason ? ' - ' + reason : '')],
  [/^\u062a\u0639\u062f\u064a\u0644 \u0645\u0631\u062a\u062c\u0639\s*#([^\s]+)(?:\s*-\s*(.+))?$/u, (_, value, reason) => 'Edit Return #' + value + (reason ? ' - ' + reason : '')],
  [/^\u0645\u0631\u062a\u062c\u0639 \u0645\u0634\u062a\u0631\u064a\u0627\u062a(?:\s*-)?\s*\u0644?\u0641\u0627\u062a\u0648\u0631\u0629\s*#([^\s]+)(?:\s*-\s*(.+))?$/u, (_, value, reason) => 'Purchase Return - Invoice #' + value + (reason ? ' - ' + reason : '')],
  [/^\u0646\u0642\u0644 \u0645\u0646\s+(.+)\s+\u0625\u0644\u0649\s+(.+)$/u, (_, from, to) => 'Transfer from ' + from + ' to ' + to],
  [/^\u0627\u0644\u0645\u0646\u062a\u062c\s+"(.+)"\s+\u063a\u064a\u0631 \u0645\u0641\u0639\u0644$/u, (_, name) => 'Product "' + name + '" is inactive'],
  [/^\u0627\u0643\u062a\u0628 \u0643\u0645\u064a\u0629 \u0635\u062d\u064a\u062d\u0629 \u0644\u0644\u0645\u0646\u062a\u062c\s+(.+)$/u, (_, name) => 'Enter a valid quantity for product ' + name],
  [/^\u0627\u0644\u0645\u0646\u062a\u062c\s+"(.+)"\s+\u064a\u0628\u0627\u0639 \u0628\u0627\u0644\u0642\u0637\u0639\u0629\u060c \u0644\u0627 \u064a\u0645\u0643\u0646 \u0625\u062f\u062e\u0627\u0644 \u0643\u0645\u064a\u0629 \u0639\u0634\u0631\u064a\u0629$/u, (_, name) => 'Product "' + name + '" is sold by unit; a decimal quantity cannot be entered'],
  [/^\u0627\u0644\u0645\u0646\u062a\u062c\s+"(.+)"\s+\u0645\u0643\u0631\u0631 \u062f\u0627\u062e\u0644 \u0627\u0644\u0633\u0646\u062f$/u, (_, name) => 'Product "' + name + '" is duplicated in the voucher'],
  [/^\u0631\u0635\u064a\u062f\s+"(.+)"\s+\u0641\u064a\s+(.+)\s+\u063a\u064a\u0631 \u0643\u0627\u0641\u064a\. \u0627\u0644\u0645\u062a\u0627\u062d\s+(.+)$/u, (_, name, location, available) => 'Insufficient balance for "' + name + '" at ' + location + '. Available: ' + available],
  [/^\u0644\u0627 \u064a\u0645\u0643\u0646 \u062d\u0630\u0641 \u0627\u0644\u0645\u062e\u0632\u0646 - \u064a\u062d\u062a\u0648\u064a \u0639\u0644\u0649\s+(.+)\s+\u0648\u062d\u062f\u0629\. \u0642\u0645 \u0628\u0646\u0642\u0644 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0623\u0648\u0644\u0627\u064b\.$/u, (_, value) => 'The warehouse cannot be deleted because it contains ' + value + ' units. Transfer the stock first.'],
  [/^\u0627\u0644\u0648\u0632\u0646 \u0627\u0644\u0645\u0637\u0644\u0648\u0628 \((.+) \u0643\u062c\u0645\) \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u0645\u062a\u0627\u062d \((.+) \u0643\u062c\u0645\)\.$/u, (_, requested, available) => 'Requested weight (' + requested + ' kg) exceeds available stock (' + available + ' kg).'],
  [/^\u062a\u0645\u062a \u0625\u0636\u0627\u0641\u0629\s+(.+)\s+\u0628\u0648\u0632\u0646\s+(.+)\s+\u0643\u062c\u0645$/u, (_, name, weight) => 'Added ' + name + ' at ' + weight + ' kg'],
  [/^\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0645\u0646\u062a\u062c \u0628\u0643\u0648\u062f \u0645\u064a\u0632\u0627\u0646\s+(.+)\.$/u, (_, value) => 'No product was found with scale code ' + value + '.'],
  [/^\u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062f \((.+)\) \u062e\u0627\u0635 \u0628\u0645\u0646\u062a\u062c \u0645\u0648\u062c\u0648\u062f \u0628\u0627\u0644\u0641\u0639\u0644 \((.+)\)(?:\. \u0628\u0631\u062c\u0627\u0621 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0628\u0627\u0631\u0643\u0648\u062f \u0622\u062e\u0631 \u0623\u0648 \u062a\u0631\u0643\u0647 \u0641\u0627\u0631\u063a\u0627\u064b)?$/u, (_, barcode, name) => 'Barcode (' + barcode + ') is already assigned to an existing product (' + name + ').'],
  [/^\u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u062d\u062f\u062f\u0629 \u0644\u0644\u0645\u0646\u062a\u062c\s+"(.+)"\s+\u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629\.$/u, (_, name) => 'The selected quantity for product "' + name + '" is invalid.'],
  [/^\u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0631\u062c\u0639\u0629 \u0644\u0644\u0645\u0646\u062a\u062c\s+"(.+)"\s+\u0644\u0627 \u064a\u0645\u0643\u0646 \u0623\u0646 \u062a\u062a\u062c\u0627\u0648\u0632 \u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0634\u062a\u0631\u0627\u0629 \u0641\u064a \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \((.+)\)\.$/u, (_, name, value) => 'The returned quantity for product "' + name + '" cannot exceed the purchased quantity (' + value + ').'],
  [/^\u0627\u0644\u0643\u0645\u064a\u0629 \u0627\u0644\u0645\u0631\u062c\u0639\u0629 \u0644\u0644\u0645\u0646\u062a\u062c\s+"(.+)"\s+\u0644\u0627 \u064a\u0645\u0643\u0646 \u0623\u0646 \u062a\u062a\u062c\u0627\u0648\u0632 \u0627\u0644\u0645\u062e\u0632\u0648\u0646 \u0627\u0644\u062d\u0627\u0644\u064a \u0627\u0644\u0645\u062a\u0627\u062d \((.+)\)\.$/u, (_, name, value) => 'The returned quantity for product "' + name + '" cannot exceed the available stock (' + value + ').'],
  [/^\u062a\u0645 \u0627\u0633\u062a\u064a\u0631\u0627\u062f\s+(\d+)\s+\u0645\u0646\u062a\u062c \u0628\u0646\u062c\u0627\u062d(?:\s+-\s+\u062a\u0645 \u062a\u062e\u0637\u064a\s+(\d+)\s+\u0635\u0641)?$/u, (_, imported, skipped) => 'Imported ' + imported + ' products successfully' + (skipped ? ' - skipped ' + skipped + ' rows' : '')],
  [/^\u0628\u0627\u0631\u0643\u0648\u062f:\s*(.+)$/u, (_, value) => 'Barcode: ' + value],
  [/^\u0636\u0631\u064a\u0628\u0629 \u0627\u0644\u0642\u064a\u0645\u0629 \u0627\u0644\u0645\u0636\u0627\u0641\u0629 \((.+)\)$/u, (_, value) => 'Value Added Tax (' + value + ')'],
  [/^(\d+)\s+\u0633\s+(\d+)\s+\u062f$/u, (_, hours, minutes) => hours + 'h ' + minutes + 'm'],
  [/^\u0642\u0628\u0644:\s*(.+)\s*\/\s*\u0628\u0639\u062f:\s*(.+)$/u, (_, before, after) => 'Before: ' + before + ' / After: ' + after],
  [/^(\d+(?:\.\d+)?)\s+\u062f\u0633\u062a\u0629(?:\s*[\u00d7x]?\s*(\d+))?$/u, (_, packs, units) => packs + ' pack(s)' + (units ? ' \u00d7 ' + units + ' units' : '')],
  [/^\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0636\u0631\u064a\u0628\u064a:\s*(.+)$/u, (_, value) => 'Tax ID: ' + value],
  [/^\u0627\u0644\u0627\u0633\u0645:\s*(.+)$/u, (_, value) => 'Name: ' + value],
  [/^\u0627\u0644\u0647\u0627\u062a\u0641:\s*(.+)$/u, (_, value) => 'Phone: ' + value],
  [/^\u0627\u0644\u0645\u0648\u0631\u062f:\s*(.+)$/u, (_, value) => 'Supplier: ' + value],
  [/^\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645:\s*(.+)$/u, (_, value) => 'User: ' + value],
  [/^\u0628\u0648\u0627\u0633\u0637\u0629:\s*(.+)$/u, (_, value) => 'By: ' + value],
  [/^\u0637\u064f\u0628\u0639 \u0628\u0648\u0627\u0633\u0637\u0629\s+(.+)$/u, (_, value) => 'Printed by ' + value],
  [/^\u062a\u0627\u0631\u064a\u062e \u0627\u0644\u0625\u0635\u062f\u0627\u0631:\s*(.+?)\s+-\s+\u0637\u064f\u0628\u0639 \u0628\u0648\u0627\u0633\u0637\u0629\s+(.+)$/u, (_, date, store) => 'Issue Date: ' + date + ' - Printed by ' + store],
  [/^\u0627\u0644\u0641\u062a\u0631\u0629:\s*(.+?)\s+\u0625\u0644\u0649\s+(.+)$/u, (_, from, to) => 'Period: ' + from + ' to ' + to],
  [/^\u0643\u0634\u0641 \u062d\u0633\u0627\u0628\s+-\s+(.+)$/u, (_, value) => 'Statement - ' + value],
  [/^\u062a\u0641\u0627\u0635\u064a\u0644 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629\s*#(.+)$/u, (_, value) => 'Invoice Details #' + value],
  [/^\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0631\u062f:\s*(.+)$/u, (_, value) => 'Supplier No.: ' + value],
  [/^\u0645\u062e\u0632\u0646:\s*(.+)$/u, (_, value) => 'Warehouse: ' + value],
  [/^\u0645\u0644\u0627\u062d\u0638\u0627\u062a:\s*(.+)$/u, (_, value) => 'Notes: ' + value],
  [/^\u0643\u0634\u0641 \u062d\u0633\u0627\u0628 \u0645\u0648\u0631\u062f\s+-\s+(.+)$/u, (_, value) => 'Supplier Statement - ' + value],
  [/^\u0641\u0648\u0627\u062a\u064a\u0631 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645\s+-\s+(.+)$/u, (_, value) => 'User Invoices - ' + value],
  [/^\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0634\u062a\u0631\u064a\u0627\u062a\s+(.+)$/u, (_, value) => 'Purchase Invoice ' + value],
  [/^\u0633\u062c\u0644 \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629\s*#(.+)$/u, (_, value) => 'Invoice Change History #' + value],
  [/^\u0646\u0642\u062f\u064a:\s*(.+)$/u, (_, value) => 'Cash: ' + value],
  [/^\u0622\u062c\u0644:\s*(.+)$/u, (_, value) => 'Credit: ' + value],
  [/^\u0628\u0637\u0627\u0642\u0629:\s*(.+)$/u, (_, value) => 'Card: ' + value],
  [/^\u062a\u0642\u0633\u064a\u0645 \u0645\u0628\u0644\u063a\s+\u2014\s+\u0646\u0642\u062f\u064a\s+(.+)\s+\/\s+\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a\s+(.+)\s+\/\s+\u0622\u062c\u0644\s+(.+)$/u, (_, cash, electronic, credit) => 'Split Payment - Cash ' + cash + ' / Electronic ' + electronic + ' / Credit ' + credit],
  [/^\u062a\u0642\u0633\u064a\u0645 \u0627\u0644\u0645\u0628\u0644\u063a\s+-\s+(.+)$/u, (_, value) => 'Split Payment - ' + value.replace(/\u0646\u0642\u062f\u064a/g, 'Cash').replace(/\u0625\u0644\u0643\u062a\u0631\u0648\u0646\u064a/g, 'Electronic').replace(/\u0622\u062c\u0644/g, 'Credit')],
  [/^\u0645\u062f\u0641\u0648\u0639 \u0628\u0627\u0644\u0643\u0627\u0645\u0644\s+(.+)$/u, (_, value) => 'Paid in Full - ' + translateText(value, 'en')],
  [/^\u0644\u0627 \u064a\u0645\u0643\u0646 \u0639\u0645\u0644 \u0641\u0627\u062a\u0648\u0631\u0629 \u0622\u062c\u0644\. \u0627\u0644\u0639\u0645\u064a\u0644 \u0648\u0635\u0644 \u0644\u0623\u0642\u0635\u0649 \u062d\u062f \u0627\u0626\u062a\u0645\u0627\u0646: \u0627\u0644\u062d\u062f\s+(.+)\u060c \u0648\u0627\u0644\u0645\u062f\u064a\u0648\u0646\u064a\u0629 \u0628\u0639\u062f \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0633\u062a\u0643\u0648\u0646\s+(.+)\.$/u, (_, limit, balance) => 'A credit invoice cannot be created. Credit limit: ' + limit + '; balance after invoice: ' + balance + '.'],
  [/^\u0627\u0644\u0645\u062f\u064a\u0648\u0646\u064a\u0629 \u0627\u0644\u062d\u0627\u0644\u064a\u0629 \((.+)\) \u0623\u0643\u0628\u0631 \u0645\u0646 \u062d\u062f \u0627\u0644\u0627\u0626\u062a\u0645\u0627\u0646 \u0627\u0644\u0645\u062d\u062f\u062f \((.+)\)$/u, (_, balance, limit) => 'Current debt (' + balance + ') exceeds the specified credit limit (' + limit + ')'],
  [/^\u0627\u0644\u0645\u0628\u0644\u063a \u0623\u0643\u0628\u0631 \u0645\u0646 \u0625\u062c\u0645\u0627\u0644\u064a \u0627\u0644\u062f\u064a\u0646 \((.+)\)$/u, (_, value) => 'The amount exceeds the total debt (' + value + ')'],
  [/^\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0633\u062c\u064a\u0644 \u0643\u0645\u064a\u0629 \u0645\u0631\u062a\u062c\u0639 \u0623\u0643\u0628\u0631 \u0645\u0646 \u0627\u0644\u0645\u062a\u0627\u062d \u062d\u0627\u0644\u064a\u064b\u0627\. \u0627\u0644\u0645\u062a\u0627\u062d:\s*(.+)$/u, (_, value) => 'The return quantity cannot exceed the currently available quantity. Available: ' + value],
  [/^\u0641\u0634\u0644 \u0627\u0644\u0625\u0635\u0644\u0627\u062d:\s*(.+)$/u, (_, value) => 'Repair failed: ' + value],
  [/^\u0633\u0639\u0631\s+(.+)$/u, (_, value) => 'Price ' + value],
  [/^\u0645\u0646\u062a\u062c\s*#(.+)$/u, (_, value) => 'Product #' + value],
  [/^\u0631\u0642\u0645\s+(.+)$/u, (_, value) => 'Number ' + translateText(value, 'en')],
  [/^\u0645\u0631\u062a\u062c\u0639 \u0644\u0645\u0648\u0631\u062f\s*#(.+?):\s*(.*)$/u, (_, supplier, reason) => 'Supplier Return #' + supplier + (reason ? ': ' + reason : '')],
  [/^(.+)\s+-\s+\u0645\u0646\s+(.+)\s+\u0625\u0644\u0649\s+(.+)\s+-\s+(.+)$/u, (_, voucher, from, to, reason) => voucher + ' - from ' + from + ' to ' + to + ' - ' + reason],
  [/^(.+)\s+-\s+\u0625\u0644\u0649\s+(.+)\s+-\s+(.+)$/u, (_, voucher, to, reason) => voucher + ' - to ' + to + ' - ' + reason],
  [/^(.+)\s+-\s+\u0645\u0646\s+(.+)\s+-\s+(.+)$/u, (_, voucher, from, reason) => voucher + ' - from ' + from + ' - ' + reason],
  [/^(?:\u0636\u0631\u064a\u0628\u064a|\u0631\u0642\u0645 \u0636\u0631\u064a\u0628\u064a):\s*(.+)$/u, (_, value) => 'Tax ID: ' + value],
  [/^(\d+)\u0633\s+(\d+)\u062f$/u, (_, hours, minutes) => hours + 'h ' + minutes + 'm'],
  [/^فاتورة\s*#?\s*(\d+)$/u, (_, value) => 'Invoice #' + value],
  [/^فاتورة رقم:\s*#?\s*(\d+)$/u, (_, value) => 'Invoice No.: #' + value],
  [/^فاتورة رقم\s*#?\s*(\d+)$/u, (_, value) => 'Invoice No. ' + value],
  [/^عدد مرات التطبيق\s*[×x]\s*(\d+)$/u, (_, value) => 'Applied × ' + value],
  [/^تطبيق العرض\s*[×x]\s*(\d+)$/u, (_, value) => 'Applied × ' + value],
  [/^متاح:\s*(.+)$/u, (_, value) => 'Available: ' + value],
  [/^الكمية:\s*(.+)$/u, (_, value) => 'Quantity: ' + value],
  [/^الإجمالي:\s*(.+)$/u, (_, value) => 'Total: ' + value],
  [/^المتبقي:\s*(.+)$/u, (_, value) => 'Remaining: ' + value],
  [/^الرصيد الحالي:\s*(.+)$/u, (_, value) => 'Current Balance: ' + value],
  [/^آخر تحديث\s+(.+)$/u, (_, value) => 'Last updated ' + value],
  [/^(\d+)\s+فاتورة$/u, (_, value) => value + ' invoices'],
  [/^(\d+)\s+منتج$/u, (_, value) => value + ' products'],
  [/^(\d+)\s+عملية$/u, (_, value) => value + ' transactions'],
  [/^(\d+)\s+يوم$/u, (_, value) => value + ' days'],
  [/^اليوم،\s*(.+)$/u, (_, value) => 'Today, ' + value],
  [/^شكراً لاختياركم\s+(.+)$/u, (_, value) => 'Thank you for choosing ' + value],
  [/^مرحباً\s+(.+)$/u, (_, value) => 'Welcome, ' + value],
  [/^خصم\s+(.+)$/u, (_, value) => 'Discount ' + value],
  [/^الضريبة\s+(.+)$/u, (_, value) => 'Tax ' + value],
  [/^وفر\s+(.+)$/u, (_, value) => 'Save ' + value],
  [/^إجمالي\s+(.+)$/u, (_, value) => 'Total ' + value],
  [/^\u0637\u064f\u0628\u0639 \u0628\u0648\u0627\u0633\u0637\u0629 \u0646\u0638\u0627\u0645\s+(.+)$/u, (_, value) => 'Printed by ' + value],
  [/^\u0627\u0644\u0641\u0631\u0642\s+\((.+)\)$/u, (_, value) => 'Difference (' + translateText(value, 'en') + ')'],
  [/^\u0633\u062c\u0644 \u0627\u0644\u0641\u0648\u0627\u062a\u064a\u0631\s+(.+)\s+-\s+(.+)$/u, (_, from, to) => 'Invoice History ' + from + ' - ' + to],
  [/^\u062a\u0645 \u0627\u0644\u0625\u0635\u062f\u0627\u0631 \u0628\u0648\u0627\u0633\u0637\u0629\s+(.+)$/u, (_, value) => 'Generated by ' + value],
  [/^(\d+(?:\.\d+)?)\s+\u062f\u0633\u062a\u0629/u, (_, value) => value + ' pack(s)'],
  [/^(\d+)\s+\u0639\u0646\u0635\u0631 \u0641\u064a \u0627\u0644\u0633\u0644\u0629$/u, (_, value) => value + ' cart items'],
  [/^(.+)\s+\u2022\s+\u062e\u0635\u0645\s+(.+)$/u, (_, name, value) => name + ' - Discount ' + value],
  [/^(.+)\s+\u2022\s+(\d+)\s+\u0628\u0627\u0642\u0629 \u0628\u0633\u0639\u0631 \u062e\u0627\u0635$/u, (_, name, count) => name + ' - ' + count + ' bundle(s) at a special price'],
]

const ATTRIBUTE_NAMES = ['placeholder', 'title', 'aria-label', 'data-tooltip']
const SKIP_SELECTOR = [
  '[data-no-translate]',
  '[translate="no"]',
  'script',
  'style',
  'code',
  'pre',
].join(',')

export function normalizeLanguage(value) {
  return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'ar'
}

export function getCurrentLanguage() {
  return currentLanguage
}

export function isEnglish() {
  return currentLanguage === 'en'
}

export function getDirection(language = currentLanguage) {
  return normalizeLanguage(language) === 'en' ? 'ltr' : 'rtl'
}

export function getLocale(language = currentLanguage) {
  return normalizeLanguage(language) === 'en' ? 'en-US' : 'ar-EG'
}

export function getStoredLanguage() {
  try {
    const storedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return storedLanguage ? normalizeLanguage(storedLanguage) : null
  } catch {
    return null
  }
}

function readStoredLanguage() {
  return getStoredLanguage() || DEFAULT_LANGUAGE
}

function applyDocumentLanguage(language) {
  const lang = normalizeLanguage(language)
  const direction = getDirection(lang)
  document.documentElement.lang = lang
  document.documentElement.dir = direction
  document.documentElement.dataset.language = lang
  if (document.body) {
    document.body.dir = direction
    document.body.dataset.language = lang
  }
}

export function translateText(value, language = currentLanguage) {
  if (normalizeLanguage(language) !== 'en' || typeof value !== 'string') return value

  const leading = value.match(/^\s*/u)?.[0] || ''
  const trailing = value.match(/\s*$/u)?.[0] || ''
  const source = value.trim()
  if (!source) return value

  const exact = TRANSLATIONS[source]
  if (exact) return leading + translateCurrencySymbols(exact, 'en') + trailing

  for (const [pattern, translate] of DYNAMIC_TRANSLATIONS) {
    const match = source.match(pattern)
    if (match) return leading + translateCurrencySymbols(translate(...match), 'en') + trailing
  }

  return leading + translateCurrencySymbols(source, 'en') + trailing
}

export function tr(arabic, english) {
  if (!isEnglish()) return arabic
  return english || translateText(arabic, 'en')
}

function isSkipped(element) {
  return Boolean(element?.closest?.(SKIP_SELECTOR))
}

function localizeTextNode(node) {
  if (!node?.parentElement || isSkipped(node.parentElement)) return

  if (currentLanguage === 'en') {
    const liveValue = node.nodeValue || ''
    if (/[\u0600-\u06ff]/u.test(liveValue) || translateCurrencySymbols(liveValue, 'en') !== liveValue) {
      originalText.set(node, liveValue)
    } else if (originalText.has(node) && liveValue !== translatedText.get(node)) {
      originalText.delete(node)
      translatedText.delete(node)
      return
    }

    const source = originalText.get(node) ?? liveValue
    const translated = translateText(source, 'en')
    translatedText.set(node, translated)
    if (translated !== liveValue) node.nodeValue = translated
    return
  }

  if (originalText.has(node)) {
    const source = originalText.get(node)
    if (node.nodeValue !== source) node.nodeValue = source
  }
  translatedText.delete(node)
}

function getAttributeStore(element) {
  let store = originalAttributes.get(element)
  if (!store) {
    store = new Map()
    originalAttributes.set(element, store)
  }
  return store
}

function localizeAttributes(element) {
  if (!element?.getAttribute || isSkipped(element)) return
  const store = getAttributeStore(element)

  for (const name of ATTRIBUTE_NAMES) {
    if (!element.hasAttribute(name)) continue
    const liveValue = element.getAttribute(name) || ''

    if (currentLanguage === 'en') {
      if (/[\u0600-\u06ff]/u.test(liveValue) || translateCurrencySymbols(liveValue, 'en') !== liveValue) store.set(name, liveValue)
      const source = store.get(name) ?? liveValue
      const translated = translateText(source, 'en')
      if (translated !== liveValue) element.setAttribute(name, translated)
    } else if (store.has(name)) {
      const source = store.get(name)
      if (liveValue !== source) element.setAttribute(name, source)
    }
  }
}

function localizeTree(root) {
  if (!root) return

  if (root.nodeType === Node.TEXT_NODE) {
    localizeTextNode(root)
    return
  }

  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) localizeAttributes(root)

  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  )

  let node = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node)
    else localizeAttributes(node)
    node = walker.nextNode()
  }
}

function queueLocalization(root = document.body) {
  queueMicrotask(() => localizeTree(root))
}

export function setCurrentLanguage(value, options = {}) {
  const nextLanguage = normalizeLanguage(value)
  const changed = currentLanguage !== nextLanguage
  currentLanguage = nextLanguage

  if (options.persist !== false) {
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage)
    } catch {}
  }

  applyDocumentLanguage(nextLanguage)
  if (document.body) queueLocalization(document.body)

  if (changed || options.notify) {
    window.dispatchEvent(new CustomEvent('mgpos:language-change', {
      detail: { language: nextLanguage, direction: getDirection(nextLanguage) },
    }))
  }

  return nextLanguage
}

export function installLocalization() {
  setCurrentLanguage(readStoredLanguage(), { persist: false })

  if (observer || !document.documentElement) return
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') {
        localizeTextNode(mutation.target)
        continue
      }

      if (mutation.type === 'attributes') {
        localizeAttributes(mutation.target)
        continue
      }

      for (const node of mutation.addedNodes || []) localizeTree(node)
    }
  })

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTE_NAMES,
  })

  window.addEventListener('storage', (event) => {
    if (event.key === LANGUAGE_STORAGE_KEY) {
      setCurrentLanguage(event.newValue || DEFAULT_LANGUAGE, { persist: false, notify: true })
    }
  })

  if (document.body) queueLocalization(document.body)
}

export function localizeHtml(html, language = currentLanguage) {
  const lang = normalizeLanguage(language)
  if (lang !== 'en' || typeof html !== 'string') return html

  if (typeof DOMParser === 'undefined') {
    return html
      .replace(/<html([^>]*)\sdir=(["'])rtl\2([^>]*)>/gi, '<html$1 dir="ltr"$3>')
      .replace(/<html([^>]*)\slang=(["'])ar\2([^>]*)>/gi, '<html$1 lang="en"$3>')
      .replace(/\bdirection\s*:\s*rtl\b/gi, 'direction: ltr')
  }

  const parser = new DOMParser()
  const documentNode = parser.parseFromString(html, 'text/html')
  documentNode.documentElement.lang = 'en'
  documentNode.documentElement.dir = 'ltr'
  documentNode.body.style.direction = 'ltr'

  const walker = documentNode.createTreeWalker(documentNode.documentElement, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    const parent = node.parentElement
    if (!parent?.closest?.('[translate="no"], [data-no-translate], script, style, code, pre')) {
      node.nodeValue = translateText(node.nodeValue || '', 'en')
    }
    node = walker.nextNode()
  }

  return '<!DOCTYPE html>' + documentNode.documentElement.outerHTML
}
