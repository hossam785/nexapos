import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const MAX_OPEN_INVOICES = 8
export const SALE_SEQUENCE_STORAGE_KEY = 'cashier_sale_sequence'

export const EMPTY_SPLIT_PAYMENT = {
  cash: '',
  card: '',
  credit: '',
  cardSubType: null,
  cardNumber: '',
}

export function getLocalBusinessDate(d = new Date()) {
  const dateObj = d instanceof Date ? d : new Date(d)
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function generateInvoiceId() {
  return `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
}

/**
 * Returns the lowest available basket/session slot number (1..8)
 * Ensures that closing a tab makes that basket slot available again
 * without affecting the sequential invoice counter.
 */
export function getNextAvailableTabSlot(invoices = []) {
  const usedSlots = new Set(
    invoices
      .map((inv) => Number(inv.tabSlot || inv.saleNumber))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= MAX_OPEN_INVOICES)
  )
  for (let i = 1; i <= MAX_OPEN_INVOICES; i++) {
    if (!usedSlots.has(i)) return i
  }
  return 1
}

export function getNextAvailableSaleNumber(invoices = [], baseNumber = 1) {
  return getNextAvailableTabSlot(invoices)
}

/**
 * Ensures all open invoices have strictly unique, valid tabSlot (1..MAX_OPEN_INVOICES).
 * Deduplicates IDs and reallocates slot collisions to the lowest available free slots.
 */
export function normalizeInvoiceSlots(invoices = []) {
  if (!Array.isArray(invoices) || invoices.length === 0) {
    return [createInitialInvoice(1, [])]
  }

  // 1. Deduplicate by ID
  const seenIds = new Set()
  const uniqueInvoices = []
  for (const inv of invoices) {
    if (!inv || typeof inv !== 'object') continue
    const id = inv.id ? String(inv.id) : generateInvoiceId()
    if (!seenIds.has(id)) {
      seenIds.add(id)
      uniqueInvoices.push({ ...inv, id })
    }
  }

  if (uniqueInvoices.length === 0) {
    return [createInitialInvoice(1, [])]
  }

  // Cap at MAX_OPEN_INVOICES
  const trimmed = uniqueInvoices.slice(0, MAX_OPEN_INVOICES)

  // 2. Resolve slots: Assign valid unique slots [1..MAX_OPEN_INVOICES]
  const usedSlots = new Set()
  const result = []

  // Pass 1: Keep already valid unique slots
  for (const inv of trimmed) {
    const rawSlot = Number(inv.tabSlot || inv.saleNumber)
    if (Number.isFinite(rawSlot) && rawSlot >= 1 && rawSlot <= MAX_OPEN_INVOICES && !usedSlots.has(rawSlot)) {
      usedSlots.add(rawSlot)
      result.push({
        ...inv,
        tabSlot: rawSlot,
        saleNumber: rawSlot,
      })
    } else {
      result.push({ ...inv, tabSlot: null, saleNumber: null })
    }
  }

  // Pass 2: Reassign any unassigned (null) slots to lowest free slots
  for (let i = 0; i < result.length; i++) {
    if (result[i].tabSlot === null) {
      let nextFree = 1
      while (usedSlots.has(nextFree) && nextFree <= MAX_OPEN_INVOICES) {
        nextFree++
      }
      usedSlots.add(nextFree)
      result[i].tabSlot = nextFree
      result[i].saleNumber = nextFree
    }
  }

  return result
}

export function createInitialInvoice(tabSlot = null, existingInvoices = []) {
  const slot = tabSlot || getNextAvailableTabSlot(existingInvoices)
  return {
    id: generateInvoiceId(),
    tabSlot: slot,
    saleNumber: slot, // Keep as alias for backwards compatibility
    status: 'active', // 'active' | 'suspended' | 'payment_pending' | 'completed'
    cart: [],
    customer: null,
    quickCustomer: true,
    customerName: '',
    customerPhone: '',
    discount: { type: 'percent', value: 0 },
    paymentMethod: 'cash',
    cardSubType: null,
    cardNumber: '',
    paid: '',
    splitPayment: { ...EMPTY_SPLIT_PAYMENT },
    backdatedInvoiceDate: '',

    // === FIRST-CLASS RETURN SESSION STATE ===
    isReturnMode: false,
    originalInvoiceId: null,
    returnSourceInvoice: null,
    returnRefundMethod: 'cash', // 'cash' | 'credit' | 'card'
    returnReason: '',
    returnSupervisorAuth: null,
    originalRefundMeta: null,
    // ========================================

    promotionEvaluation: { applications: [], total_discount: 0 },
    loyaltyPreview: null,
    loyaltyRedeemPoints: '',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

let syncTimer = null

export function syncDraftToSqlite(invoice, userId = 1, immediate = false) {
  if (typeof window === 'undefined' || !window.mgpos?.db?.saveDraft || !invoice) return
  if (syncTimer) clearTimeout(syncTimer)

  const performSave = () => {
    try {
      const cartItems = Array.isArray(invoice.cart) ? invoice.cart : []
      if (cartItems.length === 0) {
        deleteDraftFromSqlite(invoice.id)
        return
      }
      const draftPayload = {
        id: invoice.id,
        user_id: Number(userId || 1),
        sale_number: Number(invoice.tabSlot || invoice.saleNumber || 1),
        status: String(invoice.status || 'active'),
        title: invoice.customerName ? `سلة ${invoice.tabSlot || invoice.saleNumber || 1} - ${invoice.customerName}` : `سلة ${invoice.tabSlot || invoice.saleNumber || 1}`,
        customer_id: invoice.customer?.id || null,
        customer_name: invoice.customerName || invoice.customer?.name || null,
        customer_phone: invoice.customerPhone || invoice.customer?.phone || null,
        cart: invoice.cart || [],
        meta: {
          quickCustomer: invoice.quickCustomer,
          discount: invoice.discount,
          paymentMethod: invoice.paymentMethod,
          cardSubType: invoice.cardSubType,
          cardNumber: invoice.cardNumber,
          splitPayment: invoice.splitPayment,
          notes: invoice.notes,
          isReturnMode: Boolean(invoice.isReturnMode),
          originalInvoiceId: invoice.originalInvoiceId || null,
          returnSourceInvoice: invoice.returnSourceInvoice || null,
          returnRefundMethod: invoice.returnRefundMethod || 'cash',
          returnReason: invoice.returnReason || '',
          returnSupervisorAuth: invoice.returnSupervisorAuth || null,
          originalRefundMeta: invoice.originalRefundMeta || null,
        },
        total: (invoice.cart || []).reduce((acc, item) => {
          const sign = item.isReturn ? -1 : 1
          const qty = Number(item.sale_units_count ?? item.qty ?? 1) || 1
          const price = Number(item.sale_price ?? item.sell_price ?? item.price ?? 0)
          return acc + sign * qty * price
        }, 0),
      }
      window.mgpos.db.saveDraft(draftPayload).catch(() => {})
    } catch (_) {}
  }

  if (immediate) {
    performSave()
  } else {
    syncTimer = setTimeout(performSave, 200)
  }
}

export function deleteDraftFromSqlite(draftId) {
  if (typeof window === 'undefined' || !window.mgpos?.db?.deleteDraft || !draftId) return
  window.mgpos.db.deleteDraft(draftId).catch(() => {})
}

export const usePosStore = create(
  persist(
    (set, get) => ({
      invoices: [createInitialInvoice(1, [])],
      activeInvoiceId: null, // Will be set to first invoice id
      dailyInvoiceNumber: 1,
      lastBusinessDate: getLocalBusinessDate(),
      isShiftLocked: false,
      lockedUser: null,
      isSubmittingCheckout: false,

      // ==========================================
      // Daily Counter & Midnight Reset Actions
      // ==========================================
      setDailyInvoiceNumber: (num) => {
        const parsed = Number(num)
        set({ dailyInvoiceNumber: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 })
      },

      checkAndResetDailyCounter: () => {
        // Continuous invoice sequence across all days without 24h reset
        return false
      },

      syncDailyInvoiceNumber: async () => {
        const currentDate = getLocalBusinessDate()
        if (typeof window !== 'undefined' && window.mgpos?.db?.getNextDailyInvoiceNumber) {
          try {
            const nextNum = await window.mgpos.db.getNextDailyInvoiceNumber(currentDate)
            const resolved = Math.max(1, Number(nextNum || 1))
            set({
              dailyInvoiceNumber: resolved,
              lastBusinessDate: currentDate,
            })
            return resolved
          } catch (err) {
            console.warn('syncDailyInvoiceNumber error:', err)
          }
        }
        return get().dailyInvoiceNumber
      },

      // ==========================================
      // Selectors & Computed Helpers
      // ==========================================
      getActiveInvoice: () => {
        const { invoices, activeInvoiceId } = get()
        const found = invoices.find((inv) => inv.id === activeInvoiceId)
        if (found) return found
        return invoices[0] || null
      },

      getActiveCart: () => {
        const active = get().getActiveInvoice()
        return Array.isArray(active?.cart) ? active.cart : []
      },

      isReturnActive: () => {
        const active = get().getActiveInvoice()
        return Boolean(active?.isReturnMode || active?.originalInvoiceId)
      },

      getActiveReturnDetails: () => {
        const active = get().getActiveInvoice()
        if (!active || (!active.isReturnMode && !active.originalInvoiceId)) return null
        return {
          isReturnMode: Boolean(active.isReturnMode),
          originalInvoiceId: active.originalInvoiceId || null,
          returnSourceInvoice: active.returnSourceInvoice || null,
          returnRefundMethod: active.returnRefundMethod || 'cash',
          returnReason: active.returnReason || '',
          returnSupervisorAuth: active.returnSupervisorAuth || null,
          originalRefundMeta: active.originalRefundMeta || null,
        }
      },

      // ==========================================
      // Tab Management Actions
      // ==========================================
      createNewInvoiceTab: () => {
        const { invoices } = get()
        const currentNormalized = normalizeInvoiceSlots(invoices)
        if (currentNormalized.length >= MAX_OPEN_INVOICES) {
          return { success: false, error: 'MAX_INVOICES_REACHED', max: MAX_OPEN_INVOICES }
        }

        const nextNum = getNextAvailableSaleNumber(currentNormalized)
        const newInvoice = createInitialInvoice(nextNum, currentNormalized)
        set((state) => {
          const currentInvoices = normalizeInvoiceSlots(state.invoices)
          if (currentInvoices.length >= MAX_OPEN_INVOICES) {
            return state
          }
          const actualNextSlot = getNextAvailableSaleNumber(currentInvoices)
          const actualNewInvoice = {
            ...newInvoice,
            tabSlot: actualNextSlot,
            saleNumber: actualNextSlot,
          }

          // Suspend any current active invoices that have items
          const updatedInvoices = currentInvoices.map((inv) => {
            if (inv.id === state.activeInvoiceId && inv.cart.length > 0) {
              return { ...inv, status: 'suspended', updatedAt: new Date().toISOString() }
            }
            return inv
          })

          return {
            invoices: [...updatedInvoices, actualNewInvoice],
            activeInvoiceId: actualNewInvoice.id,
          }
        })

        return { success: true, invoice: newInvoice }
      },

      switchInvoiceTab: (invoiceId) => {
        const { invoices, activeInvoiceId } = get()
        if (invoiceId === activeInvoiceId) return

        const target = invoices.find((inv) => inv.id === invoiceId)
        if (!target) return

        set((state) => ({
          invoices: state.invoices.map((inv) => {
            if (inv.id === state.activeInvoiceId && inv.cart.length > 0) {
              return { ...inv, status: 'suspended', updatedAt: new Date().toISOString() }
            }
            if (inv.id === invoiceId) {
              const hasReturnItems = Array.isArray(inv.cart) && inv.cart.some((it) => it?.isReturn || Number(it?.qty || 0) < 0)
              return {
                ...inv,
                status: 'active',
                isReturnMode: hasReturnItems ? Boolean(inv.isReturnMode) : false,
                originalInvoiceId: hasReturnItems ? (inv.originalInvoiceId || null) : null,
                returnSourceInvoice: hasReturnItems ? (inv.returnSourceInvoice || null) : null,
                originalRefundMeta: hasReturnItems ? (inv.originalRefundMeta || null) : null,
                updatedAt: new Date().toISOString(),
              }
            }
            return inv
          }),
          activeInvoiceId: invoiceId,
        }))
      },

      suspendActiveInvoice: () => {
        const { invoices, activeInvoiceId } = get()
        const active = invoices.find((inv) => inv.id === activeInvoiceId)
        if (!active || active.cart.length === 0) {
          return { success: false, error: 'EMPTY_CART' }
        }

        // Check if there is already an empty invoice to switch to
        const emptyInvoice = invoices.find((inv) => inv.id !== activeInvoiceId && inv.cart.length === 0)
        if (emptyInvoice) {
          set((state) => ({
            invoices: state.invoices.map((inv) => {
              if (inv.id === activeInvoiceId) {
                return { ...inv, status: 'suspended', updatedAt: new Date().toISOString() }
              }
              if (inv.id === emptyInvoice.id) {
                return { ...inv, status: 'active', updatedAt: new Date().toISOString() }
              }
              return inv
            }),
            activeInvoiceId: emptyInvoice.id,
          }))
          return { success: true, nextInvoiceId: emptyInvoice.id }
        }

        // Otherwise create a new invoice tab
        if (invoices.length >= MAX_OPEN_INVOICES) {
          return { success: false, error: 'MAX_INVOICES_REACHED', max: MAX_OPEN_INVOICES }
        }

        const nextNum = getNextAvailableSaleNumber(invoices)
        const newInvoice = createInitialInvoice(nextNum, invoices)
        set((state) => ({
          invoices: [
            ...state.invoices.map((inv) =>
              inv.id === activeInvoiceId
                ? { ...inv, status: 'suspended', updatedAt: new Date().toISOString() }
                : inv
            ),
            newInvoice,
          ],
          activeInvoiceId: newInvoice.id,
        }))

        return { success: true, nextInvoiceId: newInvoice.id }
      },

      resumeSuspendedInvoice: (invoiceId) => {
        get().switchInvoiceTab(invoiceId)
      },

      closeInvoiceTab: (invoiceId, force = false) => {
        const { invoices, activeInvoiceId } = get()
        const target = invoices.find((inv) => inv.id === invoiceId)
        if (!target) return { success: false }

        if (!force && target.cart.length > 0) {
          return {
            success: false,
            requiresConfirmation: true,
            itemsCount: target.cart.length,
            tabSlot: target.tabSlot || target.saleNumber || 1,
            saleNumber: target.tabSlot || target.saleNumber || 1,
          }
        }

        set((state) => {
          const remaining = state.invoices.filter((inv) => inv.id !== invoiceId)
          if (remaining.length === 0) {
            const fresh = createInitialInvoice(1, [])
            return {
              invoices: [fresh],
              activeInvoiceId: fresh.id,
            }
          }

          let nextActiveId = state.activeInvoiceId
          if (state.activeInvoiceId === invoiceId) {
            nextActiveId = remaining[0].id
          }

          return {
            invoices: remaining.map((inv) =>
              inv.id === nextActiveId ? { ...inv, status: 'active' } : inv
            ),
            activeInvoiceId: nextActiveId,
          }
        })

        deleteDraftFromSqlite(invoiceId)
        return { success: true }
      },

      // ==========================================
      // Active Invoice Mutation Actions
      // ==========================================
      updateActiveInvoice: (patch) => {
        set((state) => {
          const activeId = state.activeInvoiceId || state.invoices[0]?.id
          if (!activeId) return state

          return {
            invoices: state.invoices.map((inv) => {
              if (inv.id === activeId) {
                return {
                  ...inv,
                  ...patch,
                  updatedAt: new Date().toISOString(),
                }
              }
              return inv
            }),
          }
        })
        const active = get().getActiveInvoice()
        if (active) syncDraftToSqlite(active, active.userId || 1)
      },

      setCart: (cartOrUpdater) => {
        set((state) => {
          const activeId = state.activeInvoiceId || state.invoices[0]?.id
          if (!activeId) return state

          return {
            invoices: state.invoices.map((inv) => {
              if (inv.id === activeId) {
                const nextCart =
                  typeof cartOrUpdater === 'function' ? cartOrUpdater(inv.cart || []) : cartOrUpdater
                return {
                  ...inv,
                  cart: Array.isArray(nextCart) ? nextCart : [],
                  updatedAt: new Date().toISOString(),
                }
              }
              return inv
            }),
          }
        })
        const active = get().getActiveInvoice()
        if (active) syncDraftToSqlite(active, active.userId || 1)
      },

      setCustomer: (customerData) => {
        get().updateActiveInvoice({
          customer: customerData?.customer ?? null,
          quickCustomer: Boolean(customerData?.quickCustomer ?? true),
          customerName: customerData?.customerName ?? '',
          customerPhone: customerData?.customerPhone ?? '',
        })
      },

      setDiscount: (discount) => {
        get().updateActiveInvoice({ discount })
      },

      setPaymentMethod: (paymentMethod) => {
        get().updateActiveInvoice({ paymentMethod })
      },

      setPaymentDetails: (patch) => {
        get().updateActiveInvoice(patch)
      },

      setPromotionEvaluation: (evaluation) => {
        get().updateActiveInvoice({ promotionEvaluation: evaluation })
      },

      setLoyaltyData: ({ preview = null, redeemPoints = '' } = {}) => {
        get().updateActiveInvoice({
          loyaltyPreview: preview,
          loyaltyRedeemPoints: redeemPoints,
        })
      },

      setBackdatedInvoiceDate: (date) => {
        get().updateActiveInvoice({ backdatedInvoiceDate: date })
      },

      setOriginalInvoiceDetails: ({ originalInvoiceId = null, originalRefundMeta = null } = {}) => {
        get().updateActiveInvoice({ originalInvoiceId, originalRefundMeta })
      },

      clearActiveCart: () => {
        get().updateActiveInvoice({
          cart: [],
          customer: null,
          quickCustomer: true,
          customerName: '',
          customerPhone: '',
          discount: { type: 'percent', value: 0 },
          paymentMethod: 'cash',
          cardSubType: null,
          cardNumber: '',
          paid: '',
          splitPayment: { ...EMPTY_SPLIT_PAYMENT },
          backdatedInvoiceDate: '',
          isReturnMode: false,
          originalInvoiceId: null,
          returnSourceInvoice: null,
          returnRefundMethod: 'cash',
          returnReason: '',
          returnSupervisorAuth: null,
          originalRefundMeta: null,
          promotionEvaluation: { applications: [], total_discount: 0 },
          loyaltyPreview: null,
          loyaltyRedeemPoints: '',
          notes: '',
        })
      },

      initiateReturnTab: ({ invoice, items = [], supervisorAuth = null, reason = '', refundMethod = null }) => {
        const { invoices, activeInvoiceId } = get()
        const currentNormalized = normalizeInvoiceSlots(invoices)
        const activeInv = currentNormalized.find((inv) => inv.id === activeInvoiceId) || currentNormalized[0]

        // 1. Determine target tab:
        let targetInvoiceId = null
        let needsNewTab = false

        if (activeInv && (!activeInv.cart || activeInv.cart.length === 0) && !activeInv.isReturnMode) {
          targetInvoiceId = activeInv.id
        } else {
          // Look for an existing empty tab
          const emptyTab = currentNormalized.find(
            (inv) => inv.id !== activeInvoiceId && (!inv.cart || inv.cart.length === 0) && !inv.isReturnMode
          )
          if (emptyTab) {
            targetInvoiceId = emptyTab.id
          } else {
            // Check capacity
            if (currentNormalized.length >= MAX_OPEN_INVOICES) {
              return { success: false, error: 'MAX_INVOICES_REACHED', max: MAX_OPEN_INVOICES }
            }
            needsNewTab = true
          }
        }

        const resolvedRefundMethod = refundMethod || (invoice?.payment_method === 'credit' ? 'credit' : 'cash')
        const normalizedItems = (Array.isArray(items) ? items : []).map((item) => {
          const origQty = Number(item.original_quantity ?? item.quantity ?? item.qty ?? 1)
          const prevReturned = Number(item.previously_returned_qty ?? item.returned_qty ?? 0)
          const rawRemaining = Math.max(0, origQty - prevReturned)
          const packSize = Number(item.sale_pack_size || 1) || 1
          const maxReturnable = item.sale_mode === 'dozen'
            ? Math.max(1, rawRemaining / packSize)
            : (item.maxReturnableQty != null ? Number(item.maxReturnableQty) : rawRemaining)
          const currentQty = Math.min(Number(item.qty || maxReturnable), maxReturnable)
          return {
            ...item,
            isReturn: true,
            original_quantity: origQty,
            previously_returned_qty: prevReturned,
            maxReturnableQty: maxReturnable,
            qty: currentQty,
            sale_units_count: currentQty,
          }
        })

        const returnPatch = {
          isReturnMode: true,
          originalInvoiceId: invoice?.id || null,
          returnSourceInvoice: invoice || null,
          returnRefundMethod: resolvedRefundMethod,
          returnReason: reason || '',
          returnSupervisorAuth: supervisorAuth || null,
          originalRefundMeta: {
            originalInvoiceId: invoice?.id || null,
            originalTotal: invoice?.total || 0,
            originalPaid: invoice?.paid || 0,
            paymentMethod: invoice?.payment_method || 'cash',
          },
          cart: normalizedItems,
          customer: invoice?.customer || (invoice?.customer_id ? { id: invoice.customer_id, name: invoice.customer_name, phone: invoice.customer_phone } : null),
          quickCustomer: Boolean(!invoice?.customer_id),
          customerName: invoice?.customer_name || invoice?.customer?.name || '',
          customerPhone: invoice?.customer_phone || invoice?.customer?.phone || '',
          discount: { type: 'percent', value: 0 },
          splitPayment: { ...EMPTY_SPLIT_PAYMENT },
          updatedAt: new Date().toISOString(),
        }

        if (needsNewTab) {
          const nextSlot = getNextAvailableSaleNumber(currentNormalized)
          const newInvoice = {
            ...createInitialInvoice(nextSlot, currentNormalized),
            ...returnPatch,
            status: 'active',
          }

          set((state) => {
            const currentInvs = normalizeInvoiceSlots(state.invoices)
            const updated = currentInvs.map((inv) => {
              if (inv.id === state.activeInvoiceId && inv.cart.length > 0) {
                return { ...inv, status: 'suspended', updatedAt: new Date().toISOString() }
              }
              return inv
            })
            return {
              invoices: [...updated, newInvoice],
              activeInvoiceId: newInvoice.id,
            }
          })
          syncDraftToSqlite(newInvoice, newInvoice.userId || 1, true)
          return { success: true, invoiceId: newInvoice.id, createdNewTab: true }
        }

        // Updating existing empty tab
        set((state) => ({
          invoices: state.invoices.map((inv) => {
            if (inv.id === state.activeInvoiceId && inv.id !== targetInvoiceId && inv.cart.length > 0) {
              return { ...inv, status: 'suspended', updatedAt: new Date().toISOString() }
            }
            if (inv.id === targetInvoiceId) {
              return {
                ...inv,
                ...returnPatch,
                status: 'active',
              }
            }
            return inv
          }),
          activeInvoiceId: targetInvoiceId,
        }))

        const target = get().invoices.find((inv) => inv.id === targetInvoiceId)
        if (target) syncDraftToSqlite(target, target.userId || 1, true)
        return { success: true, invoiceId: targetInvoiceId, createdNewTab: false }
      },

      cancelReturnMode: (invoiceId = null) => {
        const { invoices, activeInvoiceId } = get()
        const targetId = invoiceId || activeInvoiceId
        const target = invoices.find((inv) => inv.id === targetId)
        if (!target) return { success: false }

        const resetPatch = {
          isReturnMode: false,
          originalInvoiceId: null,
          returnSourceInvoice: null,
          returnRefundMethod: 'cash',
          returnReason: '',
          returnSupervisorAuth: null,
          originalRefundMeta: null,
          cart: [],
          customer: null,
          quickCustomer: true,
          customerName: '',
          customerPhone: '',
          discount: { type: 'percent', value: 0 },
          paymentMethod: 'cash',
          cardSubType: null,
          cardNumber: '',
          paid: '',
          splitPayment: { ...EMPTY_SPLIT_PAYMENT },
          backdatedInvoiceDate: '',
          promotionEvaluation: { applications: [], total_discount: 0 },
          loyaltyPreview: null,
          loyaltyRedeemPoints: '',
          notes: '',
          updatedAt: new Date().toISOString(),
        }

        set((state) => ({
          invoices: state.invoices.map((inv) =>
            inv.id === targetId ? { ...inv, ...resetPatch } : inv
          ),
        }))

        deleteDraftFromSqlite(targetId)
        return { success: true }
      },

      updateReturnDetails: (patch = {}) => {
        const active = get().getActiveInvoice()
        if (!active) return
        const safePatch = {}
        if (patch.returnRefundMethod !== undefined) safePatch.returnRefundMethod = patch.returnRefundMethod
        if (patch.returnReason !== undefined) safePatch.returnReason = patch.returnReason
        if (patch.returnSupervisorAuth !== undefined) safePatch.returnSupervisorAuth = patch.returnSupervisorAuth
        get().updateActiveInvoice(safePatch)
      },

      updateReturnItemQty: (cartKeyOrId, newQty) => {
        set((state) => {
          const activeId = state.activeInvoiceId || state.invoices[0]?.id
          if (!activeId) return state

          return {
            invoices: state.invoices.map((inv) => {
              if (inv.id !== activeId) return inv
              const updatedCart = (inv.cart || [])
                .map((item) => {
                  if ((item.cartKey || item.id) !== cartKeyOrId && item.id !== cartKeyOrId) return item
                  const maxAllowed = Number(item.maxReturnableQty ?? item.quantity ?? 999999)
                  const targetQty = Number(newQty)
                  const clampedQty = Math.min(Math.max(0, targetQty), maxAllowed)
                  return {
                    ...item,
                    qty: clampedQty,
                    sale_units_count: clampedQty,
                  }
                })
                .filter((item) => item.qty > 0)

              return {
                ...inv,
                cart: updatedCart,
                updatedAt: new Date().toISOString(),
              }
            }),
          }
        })
        const active = get().getActiveInvoice()
        if (active) syncDraftToSqlite(active, active.userId || 1)
      },

      removeReturnItem: (cartKeyOrId) => {
        set((state) => {
          const activeId = state.activeInvoiceId || state.invoices[0]?.id
          if (!activeId) return state

          return {
            invoices: state.invoices.map((inv) => {
              if (inv.id !== activeId) return inv
              const updatedCart = (inv.cart || []).filter(
                (item) => (item.cartKey || item.id) !== cartKeyOrId && item.id !== cartKeyOrId
              )
              return {
                ...inv,
                cart: updatedCart,
                updatedAt: new Date().toISOString(),
              }
            }),
          }
        })
        const active = get().getActiveInvoice()
        if (active) syncDraftToSqlite(active, active.userId || 1)
      },

      completeActiveInvoice: (completedInvoiceId = null, nextDailyInvoiceNumber = null) => {
        const { invoices, activeInvoiceId, dailyInvoiceNumber } = get()
        const matched = invoices.find((inv) => inv.id === completedInvoiceId)
        const targetInvoice = matched || invoices.find((inv) => inv.id === activeInvoiceId) || invoices[0]
        const targetId = targetInvoice?.id || activeInvoiceId

        // Zero-Burn Invoice Sequence Preservation:
        // If the completed transaction is a return, do NOT burn a daily sales invoice number!
        const isReturn = Boolean(targetInvoice?.isReturnMode || targetInvoice?.originalInvoiceId)
        const resolvedNextDaily = isReturn
          ? dailyInvoiceNumber
          : (nextDailyInvoiceNumber ? Math.max(1, Number(nextDailyInvoiceNumber)) : dailyInvoiceNumber + 1)

        set((state) => {
          const remaining = state.invoices.filter((inv) => inv.id !== targetId)
          if (remaining.length === 0) {
            const fresh = createInitialInvoice(1, [])
            return {
              invoices: [fresh],
              activeInvoiceId: fresh.id,
              dailyInvoiceNumber: resolvedNextDaily,
              isSubmittingCheckout: false,
            }
          }

          const nextInvoice = remaining[0]
          return {
            invoices: remaining.map((inv) =>
              inv.id === nextInvoice.id ? { ...inv, status: 'active' } : inv
            ),
            activeInvoiceId: nextInvoice.id,
            dailyInvoiceNumber: resolvedNextDaily,
            isSubmittingCheckout: false,
          }
        })
        deleteDraftFromSqlite(targetId)
        if (completedInvoiceId && completedInvoiceId !== targetId) {
          deleteDraftFromSqlite(completedInvoiceId)
        }
      },

      hydrateFromSqlite: async (userId) => {
        if (typeof window === 'undefined' || !window.mgpos?.db?.getDrafts || !userId) return
        try {
          const drafts = await window.mgpos.db.getDrafts(userId)
          if (Array.isArray(drafts) && drafts.length > 0) {
            const nonEmptyDrafts = drafts.filter((d) => {
              const hasItems = Array.isArray(d.cart) && d.cart.length > 0
              if (!hasItems) {
                deleteDraftFromSqlite(d.id)
              }
              return hasItems
            })

            if (nonEmptyDrafts.length === 0) return

            const rawLoaded = nonEmptyDrafts.map((d) => ({
              id: String(d.id),
              tabSlot: Number(d.sale_number || 1),
              saleNumber: Number(d.sale_number || 1),
              status: d.status || 'suspended',
              cart: Array.isArray(d.cart) ? d.cart : [],
              customer: d.customer_id ? { id: d.customer_id, name: d.customer_name, phone: d.customer_phone } : null,
              quickCustomer: d.meta?.quickCustomer ?? true,
              customerName: d.customer_name || '',
              customerPhone: d.customer_phone || '',
              discount: d.meta?.discount || { type: 'percent', value: 0 },
              paymentMethod: d.meta?.paymentMethod || 'cash',
              cardSubType: d.meta?.cardSubType || null,
              cardNumber: d.meta?.cardNumber || '',
              paid: '',
              splitPayment: d.meta?.splitPayment || { ...EMPTY_SPLIT_PAYMENT },
              backdatedInvoiceDate: '',
              isReturnMode: Boolean(d.meta?.isReturnMode),
              originalInvoiceId: d.meta?.originalInvoiceId || null,
              returnSourceInvoice: d.meta?.returnSourceInvoice || null,
              returnRefundMethod: d.meta?.returnRefundMethod || 'cash',
              returnReason: d.meta?.returnReason || '',
              returnSupervisorAuth: d.meta?.returnSupervisorAuth || null,
              originalRefundMeta: d.meta?.originalRefundMeta || null,
              promotionEvaluation: { applications: [], total_discount: 0 },
              loyaltyPreview: null,
              loyaltyRedeemPoints: '',
              notes: d.meta?.notes || '',
              createdAt: d.created_at || new Date().toISOString(),
              updatedAt: d.updated_at || new Date().toISOString(),
            }))

            // Normalize and resolve any slot collisions from legacy or identical SQLite drafts!
            const loadedInvoices = normalizeInvoiceSlots(rawLoaded)

            let hasActive = loadedInvoices.some((inv) => inv.status === 'active')
            if (!hasActive && loadedInvoices.length > 0) {
              loadedInvoices[0].status = 'active'
            }
            const activeOne = loadedInvoices.find((inv) => inv.status === 'active') || loadedInvoices[0]

            set({
              invoices: loadedInvoices,
              activeInvoiceId: activeOne.id,
            })
          }
        } catch (err) {
          console.warn('Failed to hydrate drafts from SQLite:', err)
        }
      },

      // ==========================================
      // Temporary Shift Lock Actions
      // ==========================================
      lockShift: (user) => {
        set({
          isShiftLocked: true,
          lockedUser: user
            ? {
                id: user.id,
                username: user.username,
                fullName: user.full_name || user.name || user.username || 'كاشير',
                role: user.role || 'cashier',
              }
            : null,
        })
      },

      unlockShift: () => {
        set({
          isShiftLocked: false,
          lockedUser: null,
        })
      },

      // ==========================================
      // Concurrency & Mutex Controls
      // ==========================================
      setIsSubmittingCheckout: (submitting) => {
        set({ isSubmittingCheckout: Boolean(submitting) })
      },
    }),
    {
      name: 'nexa_pos_active_session_v1',
      version: 1,
      // Only persist safe transaction and session states, NEVER sensitive passwords
      partialize: (state) => ({
        invoices: state.invoices,
        activeInvoiceId: state.activeInvoiceId,
        dailyInvoiceNumber: state.dailyInvoiceNumber,
        lastBusinessDate: state.lastBusinessDate,
        isShiftLocked: state.isShiftLocked,
        lockedUser: state.lockedUser,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const today = getLocalBusinessDate()
        if (state.lastBusinessDate !== today) {
          state.dailyInvoiceNumber = 1
          state.lastBusinessDate = today
        }
        // Ensure at least 1 valid invoice exists and slots are strictly unique upon hydration
        const normalized = normalizeInvoiceSlots(state.invoices)
        // Clean up any stale return flags on tabs that don't have return items
        normalized.forEach((inv) => {
          const hasReturn = Array.isArray(inv.cart) && inv.cart.some((it) => it?.isReturn || Number(it?.qty || 0) < 0)
          if (!hasReturn) {
            inv.isReturnMode = false
            inv.originalInvoiceId = null
            inv.returnSourceInvoice = null
            inv.originalRefundMeta = null
          }
        })
        state.invoices = normalized

        // If activeInvoiceId is invalid, point to the first invoice
        const exists = state.invoices.some((inv) => inv.id === state.activeInvoiceId)
        if (!exists) {
          state.activeInvoiceId = state.invoices[0].id
        }
        // Always reset in-flight submit flag on startup/reload
        state.isSubmittingCheckout = false
      },
    }
  )
)
