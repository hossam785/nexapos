function createCustomersRepo({ db, auditDB }) {
  return {
    getAll: () => db.prepare('SELECT * FROM customers WHERE COALESCE(is_active, 1) = 1 ORDER BY name COLLATE NOCASE').all(),

    getLookup: () =>
      db.prepare(`
        SELECT id, name, phone, balance, credit_limit
        FROM customers
        WHERE COALESCE(is_active, 1) = 1
        ORDER BY name COLLATE NOCASE
      `).all(),

    add: (data) => {
      const result = db.prepare(`
        INSERT INTO customers (name, phone, credit_limit, notes, balance, is_active)
        VALUES (@name, @phone, @credit_limit, @notes, @balance, 1)
      `).run({ ...data, balance: data.balance || 0 })
      try {
        auditDB.log({
          action: 'customer.create',
          entityType: 'customer',
          entityId: result.lastInsertRowid,
          entityName: data.name,
          details: { phone: data.phone, balance: data.balance || 0, credit_limit: data.credit_limit || 0 },
        })
      } catch (e) {}
      return result
    },

    update: (id, data) => {
      const old = db.prepare('SELECT name, phone, balance, credit_limit FROM customers WHERE id = ?').get(id)
      let result
      if (data.balance !== undefined) {
        result = db.prepare(`
          UPDATE customers SET name=@name, phone=@phone,
          credit_limit=@credit_limit, notes=@notes, balance=@balance WHERE id=@id
        `).run({ ...data, id, balance: data.balance })
      } else {
        result = db.prepare(`
          UPDATE customers SET name=@name, phone=@phone,
          credit_limit=@credit_limit, notes=@notes WHERE id=@id
        `).run({ ...data, id })
      }
      try {
        auditDB.log({
          action: 'customer.update',
          entityType: 'customer',
          entityId: id,
          entityName: data.name || old?.name,
          details: {
            name: data.name,
            phone: data.phone,
            credit_limit: data.credit_limit,
            balance: data.balance,
          },
        })
      } catch (e) {}
      return result
    },

    updateBalance: (id, amount) =>
      db.prepare('UPDATE customers SET balance = balance + ? WHERE id = ?').run(amount, id),

    payDebt: (id, amount, customNotes, userId) => {
      const requestedAmount = Number(amount) || 0
      if (requestedAmount <= 0) return { applied: 0 }

      const getUnpaid = db.prepare(`
        SELECT id, total, paid, payment_method, credit_amount FROM invoices
        WHERE customer_id = ?
          AND (
            (payment_method = 'credit' AND (total - paid) > 0.001)
            OR (payment_method = 'split' AND COALESCE(credit_amount, 0) > 0.001)
          )
        ORDER BY created_at ASC
      `)
      const getCustomerBalance = db.prepare('SELECT balance FROM customers WHERE id = ?')
      const updateInvoicePaid = db.prepare('UPDATE invoices SET paid = ? WHERE id = ?')
      const updateSplitInvoiceDebt = db.prepare('UPDATE invoices SET paid = ?, credit_amount = ? WHERE id = ?')
      const updateBalance = db.prepare('UPDATE customers SET balance = balance - ? WHERE id = ?')
      const insertPayment = db.prepare(`
        INSERT INTO customer_payments (customer_id, amount, applied_to_invoices, applied_to_balance, note, user_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `)

      const transaction = db.transaction(() => {
        const customer = getCustomerBalance.get(id)
        const currentBalance = Math.max(0, Number(customer?.balance || 0))
        const amountToApply = Math.min(requestedAmount, currentBalance)
        if (amountToApply <= 0) return { applied: 0 }

        const unpaid = getUnpaid.all(id)
        let remaining = amountToApply
        let appliedToInvoices = 0

        for (const inv of unpaid) {
          if (remaining <= 0) break
          const isSplitInvoice = inv.payment_method === 'split'
          const owing = isSplitInvoice ? Number(inv.credit_amount || 0) : inv.total - inv.paid
          const apply = Math.min(owing, remaining)
          if (isSplitInvoice) {
            updateSplitInvoiceDebt.run(inv.paid + apply, Math.max(0, owing - apply), inv.id)
          } else {
            updateInvoicePaid.run(inv.paid + apply, inv.id)
          }
          appliedToInvoices += apply
          remaining -= apply
        }

        const appliedToBalance = amountToApply - appliedToInvoices
        const autoNote = appliedToInvoices > 0.001 && appliedToBalance > 0.001
          ? 'تسديد مستحقات + تسوية رصيد سابق'
          : appliedToBalance > 0.001
            ? 'تسديد رصيد سابق / تسوية يدوية'
            : 'تسديد مستحقات'

        const paymentNote = customNotes ? `${autoNote} - ${customNotes}` : autoNote
        updateBalance.run(amountToApply, id)
        insertPayment.run(
          id,
          amountToApply,
          appliedToInvoices,
          appliedToBalance,
          paymentNote,
          userId || null
        )

        const summary = {
          applied: amountToApply,
          appliedToInvoices,
          appliedToBalance,
        }
        try {
          const customerRow = db.prepare('SELECT name FROM customers WHERE id = ?').get(id)
          auditDB.log({
            userId: userId || null,
            action: 'customer.payment',
            entityType: 'customer',
            entityId: id,
            entityName: customerRow?.name,
            details: {
              amount: amountToApply,
              applied_to_invoices: appliedToInvoices,
              applied_to_balance: appliedToBalance,
              note: paymentNote,
            },
          })
        } catch (e) {}
        return summary
      })

      return transaction()
    },

    delete: (id) => {
      const customer = db.prepare('SELECT name, balance FROM customers WHERE id = ?').get(id)
      if (!customer) return { changes: 0 }

      const balance = Number(customer.balance || 0)
      if (Math.abs(balance) > 0.001) {
        const error = new Error('CUSTOMER_HAS_BALANCE')
        error.code = 'CUSTOMER_HAS_BALANCE'
        error.balance = balance
        throw error
      }

      const result = db.prepare('UPDATE customers SET is_active = 0 WHERE id = ?').run(id)
      try {
        auditDB.log({
          action: 'customer.delete',
          entityType: 'customer',
          entityId: id,
          entityName: customer?.name,
          details: { soft_delete: true },
        })
      } catch (e) {}
      return result
    },
  }
}

module.exports = { createCustomersRepo }
