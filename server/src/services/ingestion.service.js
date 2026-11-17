const { withBoundTransaction, withBoundSavepoint, query } = require('../config/db')
const catalogModel = require('../models/catalog.model')
const inventoryModel = require('../models/inventory.model')
const invoiceModel = require('../models/invoice.model')
const customerModel = require('../models/customer.model')
const supplierModel = require('../models/supplier.model')
const expenseModel = require('../models/expense.model')
const closingModel = require('../models/closing.model')
const logger = require('../utils/logger')
const { telemetryService } = require('./telemetry.service')

// جدول الأسبقية السببية لترتيب الأحداث ومنع أخطاء الاعتماديات (Causal Dependency Order)
const CAUSAL_ORDER = {
  category: 1,
  categories: 1,
  product: 2,
  products: 2,
  warehouse: 3,
  warehouses: 3,
  warehouse_inventory: 4,
  batch: 5,
  batches: 5,
  customer: 6,
  customers: 6,
  supplier: 7,
  suppliers: 7,
  purchase_invoice: 8,
  invoice: 9,
  invoices: 9,
  sale: 9,
  sales: 9,
  customer_payment: 10,
  supplier_payment: 11,
  expense_category: 12,
  expense: 13,
  closing: 14,
  closings: 14,
  stock_movement: 15,
}

function normalizeEntityType(rawType = '') {
  const lower = String(rawType).toLowerCase().trim()
  if (lower.startsWith('cat') || lower.includes('category')) return 'category'
  if (lower.startsWith('prod') || lower.includes('product')) return 'product'
  if (lower.includes('warehouse_inv') || lower.includes('warehouse_stock')) return 'warehouse_inventory'
  if (lower.startsWith('ware') || lower.includes('warehouse')) return 'warehouse'
  if (lower.startsWith('batch')) return 'batch'
  if (lower.includes('cust_pay') || lower.includes('customer_payment')) return 'customer_payment'
  if (lower.startsWith('cust') || lower.includes('customer')) return 'customer'
  if (lower.includes('supp_pay') || lower.includes('supplier_payment')) return 'supplier_payment'
  if (lower.includes('purch') || lower.includes('purchase_invoice')) return 'purchase_invoice'
  if (lower.startsWith('supp') || lower.includes('supplier')) return 'supplier'
  if (lower.includes('return') || lower.includes('invoice_return')) return 'invoice_return'
  if (lower.startsWith('inv') || lower.startsWith('sale') || lower.includes('invoice')) return 'invoice'
  if (lower.includes('expense_cat')) return 'expense_category'
  if (lower.startsWith('exp') || lower.includes('expense')) return 'expense'
  if (lower.startsWith('close') || lower.includes('closing') || lower.includes('shift')) return 'closing'
  if (lower.includes('stock_mov') || lower.includes('stock_movement')) return 'stock_movement'
  return lower || 'unknown'
}

const ingestionService = {
  // 1. معالجة دفعة أحداث مزامنة سحابية مجمعة (Stream Batch Ingestion Engine)
  async processBatch(tenantId, deviceId, events = [], clientVersion = '2.2.2', meta = {}) {
    if (!tenantId) throw new Error('TENANT_ID_REQUIRED')
    if (!deviceId) throw new Error('DEVICE_ID_REQUIRED')

    if (!Array.isArray(events) || events.length === 0) {
      return {
        success: true,
        processedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        lastSyncedOutboxId: 0,
      }
    }

    // 1. تسوية وتصنيف الأحداث
    const normalizedEvents = events.map((e) => {
      const outboxId = Number(e.outboxId !== undefined ? e.outboxId : e.id) || 0
      const eventUuid = String(e.eventUuid || e.eventId || e.event_id || '').trim()
      const rawEntityType = e.entityType || e.eventType || e.event_type || 'unknown'
      const entityType = normalizeEntityType(rawEntityType)
      const payload = typeof e.payload === 'object' && e.payload !== null ? e.payload : {}
      // الحذف قد يأتي داخل الـ payload أو كلاحقة لنوع الحدث (مثل EXPENSE_DELETED)
      const rawAction = e.action || payload.action || (/_DELETED$/i.test(String(rawEntityType)) ? 'delete' : 'sync')

      return {
        outboxId,
        eventUuid,
        rawEntityType,
        entityType,
        action: String(rawAction).toLowerCase(),
        payload,
        createdAt: e.createdAt || e.created_at || new Date().toISOString(),
      }
    })

    // 2. الفرز السببي (Causal Ordering)
    normalizedEvents.sort((a, b) => {
      const orderA = CAUSAL_ORDER[a.entityType] || 99
      const orderB = CAUSAL_ORDER[b.entityType] || 99
      if (orderA !== orderB) return orderA - orderB
      return a.outboxId - b.outboxId
    })

    // 3. تقسيم الحزمة إلى Chunks بحد أقصى 100 حدث لمنع قفل قاعدة البيانات والذاكرة
    const CHUNK_SIZE = 100
    let totalProcessed = 0
    let totalSkipped = 0
    let totalFailed = 0
    let maxOutboxId = 0

    for (let i = 0; i < normalizedEvents.length; i += CHUNK_SIZE) {
      const chunk = normalizedEvents.slice(i, i + CHUNK_SIZE)

      await withBoundTransaction(async (client) => {
        const chunkUuids = [...new Set(chunk.map((evt) => evt.eventUuid).filter(Boolean))]
        const seen = new Set()
        if (chunkUuids.length) {
          const existing = await client.query(
            `SELECT event_uuid FROM cloud_processed_events
             WHERE tenant_id = $1 AND device_id = $2 AND event_uuid = ANY($3::text[])`,
            [tenantId, deviceId, chunkUuids]
          )
          for (const row of existing.rows) seen.add(String(row.event_uuid))
        }
        // معالجة كل حدث داخل الـ Chunk باستخدام Savepoints لعزل الأحداث الفاسدة
        for (const evt of chunk) {
          if (evt.outboxId > maxOutboxId) {
            maxOutboxId = evt.outboxId
          }

          if (evt.eventUuid && seen.has(evt.eventUuid)) {
            totalSkipped++
            continue
          }
          const outcome = await withBoundSavepoint(async () => {
            if (!evt.eventUuid) {
              await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [String(tenantId), `${deviceId}:${evt.outboxId}`])
              const existing = await client.query('SELECT 1 FROM cloud_processed_events WHERE tenant_id = $1 AND device_id = $2 AND outbox_id = $3 AND event_uuid IS NULL LIMIT 1', [tenantId, deviceId, evt.outboxId])
              if (existing.rows.length) return false
            }
            const claim = await client.query(
              `INSERT INTO cloud_processed_events (
                tenant_id, device_id, outbox_id, event_uuid, entity_type, action
              ) VALUES ($1, $2, $3, $4, $5, $6)
              ON CONFLICT (tenant_id, device_id, event_uuid) DO NOTHING RETURNING 1`,
              [tenantId, deviceId, evt.outboxId, evt.eventUuid || null, evt.entityType, evt.action]
            )
            if (!claim.rows.length) return false
            // فحص نافذة قبول التوقيت المستقبلي (الحد الأقصى للتفاوت 5 دقائق)
            const eventTimeMs = new Date(evt.createdAt).getTime()
            const serverNowMs = Date.now()
            const MAX_FUTURE_TOLERANCE_MS = 5 * 60 * 1000 // 5 minutes
            if (!isNaN(eventTimeMs) && eventTimeMs - serverNowMs > MAX_FUTURE_TOLERANCE_MS) {
              throw new Error(`FUTURE_TIMESTAMP_REJECTED: Event timestamp [${evt.createdAt}] exceeds 5-minute future tolerance window`)
            }
            await this.dispatchEvent(tenantId, deviceId, evt, client, meta)
            return true
          })
          if (!outcome.failed) {
            if (evt.eventUuid) seen.add(evt.eventUuid)
            if (outcome.value) totalProcessed++
            else totalSkipped++
          } else {
            const eventErr = outcome.error
            totalFailed++

            logger.error(`[SYNC-EVENT-FAIL] Poison pill isolated in sync batch`, {
              tenantId,
              deviceId,
              outboxId: evt.outboxId,
              entityType: evt.entityType,
              error: eventErr.message,
              traceId: meta?.traceId,
            })

            // تسجيل الحدث الفاسد في سجل الأعطال دون إسقاط الدفعة
            await client.query(
              `INSERT INTO cloud_sync_failures (
                tenant_id, device_id, outbox_id, event_uuid, entity_type, payload, error_message
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [tenantId, deviceId, evt.outboxId, evt.eventUuid || null, evt.entityType, JSON.stringify(evt.payload), eventErr.message]
            )
          }
        }

        // تحديث حالة مزامنة الجهاز اللحظية
        if (maxOutboxId > 0) {
          await client.query(
            `INSERT INTO cloud_device_sync_state (
              tenant_id, device_id, last_outbox_id, last_sync_time, client_version
            ) VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
            ON CONFLICT (tenant_id, device_id)
            DO UPDATE SET
              last_outbox_id = GREATEST(cloud_device_sync_state.last_outbox_id, EXCLUDED.last_outbox_id),
              last_sync_time = CURRENT_TIMESTAMP,
              client_version = EXCLUDED.client_version`,
            [tenantId, deviceId, maxOutboxId, clientVersion]
          )
        }
      }, meta)
    }

    logger.info(`[SYNC-BATCH-SUCCESS] Batch processed for tenant [${tenantId}] device [${deviceId}]`, {
      tenantId,
      deviceId,
      totalEvents: events.length,
      processed: totalProcessed,
      skipped: totalSkipped,
      failed: totalFailed,
      lastSyncedOutboxId: maxOutboxId,
      traceId: meta?.traceId,
    })

    // رصد إحصائيات المزامنة لحظياً في محرك القياسات (Zero-Overhead In-Memory Metrics)
    if (totalProcessed > 0) telemetryService.recordSyncEvents(totalProcessed, true)
    if (totalFailed > 0) telemetryService.recordSyncEvents(totalFailed, false)

    return {
      success: true,
      processedCount: totalProcessed,
      skippedCount: totalSkipped,
      failedCount: totalFailed,
      lastSyncedOutboxId: maxOutboxId,
    }
  },

  // 2. موجه الأحداث حسب الكيان (Domain Event Dispatcher)
  async dispatchEvent(tenantId, deviceId, evt, client, meta = {}) {
    const { entityType, payload } = evt

    switch (entityType) {
      case 'category':
        return await catalogModel.upsertCategory({
          tenantId,
          localCategoryId: payload.localCategoryId !== undefined ? payload.localCategoryId : (payload.local_category_id !== undefined ? payload.local_category_id : payload.id),
          name: payload.name,
          visibleInCashier: payload.visibleInCashier !== undefined ? payload.visibleInCashier : payload.visible_in_cashier,
        }, meta)

      case 'product':
        return await catalogModel.upsertProduct({
          tenantId,
          localProductId: payload.localProductId !== undefined ? payload.localProductId : (payload.local_product_id !== undefined ? payload.local_product_id : payload.id),
          name: payload.name,
          brand: payload.brand,
          barcode: payload.barcode,
          dozenBarcode: payload.dozenBarcode || payload.dozen_barcode,
          scaleCode: payload.scaleCode || payload.scale_code,
          categoryId: payload.categoryId || payload.category_id,
          sellPrice: payload.sellPrice || payload.sell_price,
          costPrice: payload.costPrice || payload.cost_price,
          wholesalePrice: payload.wholesalePrice || payload.wholesale_price,
          minSellPrice: payload.minSellPrice || payload.min_sell_price,
          quantity: payload.quantity,
          minQuantity: payload.minQuantity || payload.min_quantity,
          unit: payload.unit,
          dozenEnabled: payload.dozenEnabled || payload.dozen_enabled,
          dozenQuantity: payload.dozenQuantity || payload.dozen_quantity,
          dozenPrice: payload.dozenPrice || payload.dozen_price,
          isUnlimitedStock: payload.isUnlimitedStock || payload.is_unlimited_stock,
          hasExpiry: payload.hasExpiry || payload.has_expiry,
          isActive: payload.isActive !== undefined ? payload.isActive : payload.is_active,
        }, meta)

      case 'warehouse':
        return await inventoryModel.upsertWarehouse({
          tenantId,
          localWarehouseId: payload.localWarehouseId !== undefined ? payload.localWarehouseId : (payload.local_warehouse_id !== undefined ? payload.local_warehouse_id : payload.id),
          name: payload.name,
          type: payload.type,
          isDefault: payload.isDefault || payload.is_default,
          isPosSource: payload.isPosSource || payload.is_pos_source,
          color: payload.color,
          isActive: payload.isActive !== undefined ? payload.isActive : payload.is_active,
        }, meta)

      case 'warehouse_inventory':
        return await inventoryModel.updateWarehouseStock({
          tenantId,
          warehouseId: payload.warehouseId || payload.warehouse_id,
          productId: payload.productId || payload.product_id,
          quantity: payload.quantity,
        }, meta)

      case 'batch':
        return await inventoryModel.upsertBatch({
          tenantId,
          localBatchId: payload.localBatchId !== undefined ? payload.localBatchId : payload.id,
          productId: payload.productId || payload.product_id,
          warehouseId: payload.warehouseId || payload.warehouse_id,
          batchNumber: payload.batchNumber || payload.batch_number,
          productionDate: payload.productionDate || payload.production_date,
          expiryDate: payload.expiryDate || payload.expiry_date,
          shelfLifeDays: payload.shelfLifeDays || payload.shelf_life_days,
          quantity: payload.quantity,
          remainingQuantity: payload.remainingQuantity || payload.remaining_quantity,
          purchasePrice: payload.purchasePrice || payload.purchase_price,
          status: payload.status,
          notes: payload.notes,
        }, meta)

      case 'customer':
        return await customerModel.upsertCustomer({
          tenantId,
          localCustomerId: payload.localCustomerId !== undefined ? payload.localCustomerId : payload.id,
          name: payload.name,
          phone: payload.phone,
          creditLimit: payload.creditLimit || payload.credit_limit,
          balance: payload.balance,
          notes: payload.notes,
          isActive: payload.isActive !== undefined ? payload.isActive : payload.is_active,
        }, meta)

      case 'customer_payment':
        return await customerModel.recordCustomerPayment({
          tenantId,
          deviceId,
          localPaymentId: payload.localPaymentId !== undefined ? payload.localPaymentId : payload.id,
          customerId: payload.customerId || payload.customer_id,
          amount: payload.amount,
          appliedToInvoices: payload.appliedToInvoices || payload.applied_to_invoices,
          appliedToBalance: payload.appliedToBalance || payload.applied_to_balance,
          paymentMethod: payload.paymentMethod || payload.payment_method,
          receivedBy: payload.receivedBy || payload.received_by,
          notes: payload.notes,
        }, meta)

      case 'supplier':
        return await supplierModel.upsertSupplier({
          tenantId,
          localSupplierId: payload.localSupplierId !== undefined ? payload.localSupplierId : payload.id,
          name: payload.name,
          phone: payload.phone,
          company: payload.company,
          balance: payload.balance,
          isActive: payload.isActive !== undefined ? payload.isActive : payload.is_active,
        }, meta)

      case 'supplier_payment':
        return await supplierModel.recordSupplierPayment({
          tenantId,
          supplierId: payload.supplierId || payload.supplier_id,
          purchaseInvoiceId: payload.purchaseInvoiceId || payload.purchase_invoice_id,
          amount: payload.amount,
          paymentMethod: payload.paymentMethod || payload.payment_method,
          paidBy: payload.paidBy || payload.paid_by,
          notes: payload.notes,
        }, meta)

      case 'purchase_invoice':
        return await supplierModel.upsertPurchaseInvoice({
          tenantId,
          supplierId: payload.supplierId || payload.supplier_id,
          localPurchaseId: payload.localPurchaseId !== undefined ? payload.localPurchaseId : payload.id,
          invoiceNumber: payload.invoiceNumber || payload.invoice_number,
          invoiceDate: payload.invoiceDate || payload.invoice_date,
          total: payload.total,
          paid: payload.paid,
          remaining: payload.remaining,
          status: payload.status,
          notes: payload.notes,
        }, meta)

      case 'invoice':
        return await invoiceModel.upsertInvoice({
          tenantId,
          deviceId,
          localInvoiceId: payload.localInvoiceId !== undefined ? payload.localInvoiceId : payload.id,
          dailyInvoiceNumber: payload.dailyInvoiceNumber || payload.daily_invoice_number,
          businessDate: payload.businessDate || payload.business_date,
          customerId: payload.customerId || payload.customer_id,
          userId: payload.userId || payload.user_id,
          cashierName: payload.cashierName || payload.cashier_name,
          total: payload.total,
          subtotal: payload.subtotal,
          discount: payload.discount,
          manualDiscount: payload.manualDiscount || payload.manual_discount,
          taxAmount: payload.taxAmount || payload.tax_amount,
          paid: payload.paid,
          cashAmount: payload.cashAmount || payload.cash_amount,
          cardAmount: payload.cardAmount || payload.card_amount,
          creditAmount: payload.creditAmount || payload.credit_amount,
          returnedTotal: payload.returnedTotal || payload.returned_total,
          netTotal: payload.netTotal || payload.net_total,
          paymentMethod: payload.paymentMethod || payload.payment_method,
          status: payload.status,
          notes: payload.notes,
          deviceCreatedAt: payload.deviceCreatedAt || payload.device_created_at || payload.createdAt || payload.created_at || new Date().toISOString(),
          items: payload.items || [],
        }, meta)

      case 'invoice_return':
        return await invoiceModel.processReturn({
          tenantId,
          deviceId,
          // الجهاز يرسل رقم الفاتورة المحلي، والخادم يحوله لرقم الفاتورة السحابية
          localInvoiceId: payload.originalInvoiceId || payload.original_invoice_id,
          returnItems: payload.returnItems || payload.return_items || [],
          refundAmount: payload.refundAmount || payload.refund_amount,
          reason: payload.reason,
          processedBy: payload.processedBy || payload.processed_by,
        }, meta)

      case 'expense_category':
        return await expenseModel.upsertExpenseCategory({
          tenantId,
          name: payload.name,
          isActive: payload.isActive !== undefined ? payload.isActive : payload.is_active,
        }, meta)

      case 'expense':
        if (evt.action === 'delete') {
          return await expenseModel.deleteExpense({
            tenantId,
            deviceId,
            localExpenseId: payload.localExpenseId !== undefined ? payload.localExpenseId : (payload.local_expense_id !== undefined ? payload.local_expense_id : payload.id),
          }, meta)
        }
        return await expenseModel.recordExpense({
          tenantId,
          deviceId,
          localExpenseId: payload.localExpenseId !== undefined ? payload.localExpenseId : payload.id,
          categoryId: payload.categoryId || payload.category_id,
          amount: payload.amount,
          description: payload.description,
          expenseDate: payload.expenseDate || payload.expense_date,
          spentBy: payload.spentBy || payload.spent_by,
          closingId: payload.closingId || payload.closing_id,
        }, meta)

      case 'closing':
        return await closingModel.upsertDayClosing({
          tenantId,
          deviceId,
          localClosingId: payload.localClosingId !== undefined ? payload.localClosingId : payload.id,
          businessDate: payload.businessDate || payload.business_date,
          shiftNumber: payload.shiftNumber || payload.shift_number,
          openedAt: payload.openedAt || payload.opened_at,
          closedAt: payload.closedAt || payload.closed_at,
          closedBy: payload.closedBy || payload.closed_by,
          totalSales: payload.totalSales || payload.total_sales,
          totalReturns: payload.totalReturns || payload.total_returns,
          netSales: payload.netSales || payload.net_sales,
          cashSales: payload.cashSales || payload.cash_sales,
          cardSales: payload.cardSales || payload.card_sales,
          creditSales: payload.creditSales || payload.credit_sales,
          expenses: payload.expenses,
          openingCash: payload.openingCash || payload.opening_cash,
          expectedCash: payload.expectedCash || payload.expected_cash,
          actualCash: payload.actualCash || payload.actual_cash,
          difference: payload.difference,
          invoicesCount: payload.invoicesCount || payload.invoices_count,
          notes: payload.notes,
        }, meta)

      case 'stock_movement':
        return await inventoryModel.recordStockMovement({
          tenantId,
          productId: payload.productId || payload.product_id,
          type: payload.type,
          quantity: payload.quantity,
          balanceAfter: payload.balanceAfter || payload.balance_after,
          reason: payload.reason,
          createdByName: payload.createdByName || payload.created_by_name || payload.username,
        }, meta)

      default:
        logger.warn(`[SYNC-UNKNOWN-ENTITY] Skipping unrecognized sync entity [${entityType}]`, {
          tenantId,
          deviceId,
          outboxId: evt.outboxId,
        })
        return null
    }
  },

  // 3. جلب حالة آخر مزامنة لجهاز كاشير
  async getDeviceSyncState(tenantId, deviceId, meta = {}) {
    if (!tenantId || !deviceId) return null
    const res = await query(
      `SELECT * FROM cloud_device_sync_state WHERE tenant_id = $1 AND device_id = $2 LIMIT 1`,
      [tenantId, deviceId],
      meta
    )
    return res.rows[0] || null
  },
}

module.exports = ingestionService
