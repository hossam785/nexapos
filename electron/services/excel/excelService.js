const XLSX = require('xlsx')

function createExcelService({ dialog, productsDB, categoriesDB, auditDB }) {
  return {
    exportProducts: async () => {
      try {
        const products = productsDB.getAll()
        const data = products.map((p) => ({
          barcode: p.barcode || '',
          barcode_type: p.barcode_type || 'CODE128',
          dozen_barcode: p.dozen_barcode || '',
          scale_code: p.scale_code || '',
          name: p.name || '',
          category: p.category_name || '',
          sell_price: p.sell_price || 0,
          product_tax_type: p.product_tax_type || 'percent',
          product_tax_rate: p.product_tax_rate || 0,
          cost_price: p.cost_price || 0,
          quantity: p.quantity || 0,
          min_quantity: p.min_quantity || 0,
          unit: p.unit || 'piece',
          dozen_enabled: p.dozen_enabled ? 1 : 0,
          dozen_quantity: p.dozen_quantity || 0,
          dozen_price_same_as_unit: p.dozen_price_same_as_unit ? 1 : 0,
          dozen_price: p.dozen_price || 0,
        }))
        const worksheet = XLSX.utils.json_to_sheet(data)
        const workbook = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Products')

        const { filePath } = await dialog.showSaveDialog({
          title: 'تصدير المنتجات إلى Excel',
          defaultPath: `mgpos-products-${new Date().toISOString().slice(0, 10)}.xlsx`,
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        })

        if (!filePath) {
          try {
            auditDB.log({ action: 'product.export_excel', entityType: 'product', entityName: 'Products Export', details: { success: false, result: 'cancelled', cancelled: true } })
          } catch (e) {}
          return { success: false, cancelled: true }
        }

        XLSX.writeFile(workbook, filePath)
        try {
          auditDB.log({ action: 'product.export_excel', entityType: 'product', entityName: 'Products Export', details: { success: true, result: 'success', file_path: filePath, items_count: products.length } })
        } catch (e) {}

        return { success: true, path: filePath }
      } catch (error) {
        console.error('Export Excel Error:', error)
        try {
          auditDB.log({ action: 'product.export_excel', entityType: 'product', entityName: 'Products Export', details: { success: false, result: 'failed', error: error.message || 'unknown_error' } })
        } catch (e) {}
        return { success: false, error: error.message }
      }
    },

    importProducts: async () => {
      try {
        const { filePaths } = await dialog.showOpenDialog({
          title: 'استيراد المنتجات من Excel',
          filters: [{ name: 'Excel Files', extensions: ['xlsx', 'xls'] }],
          properties: ['openFile'],
        })

        if (!filePaths || !filePaths.length) {
          try {
            auditDB.log({ action: 'product.import_excel', entityType: 'product', entityName: 'Products Import', details: { success: false, result: 'cancelled', cancelled: true } })
          } catch (e) {}
          return { success: false, cancelled: true }
        }

        const filePath = filePaths[0]
        const workbook = XLSX.readFile(filePath)
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const rows = XLSX.utils.sheet_to_json(worksheet)

        const categories = categoriesDB.getAll()
        const categoryMap = {}
        categories.forEach((c) => {
          categoryMap[c.name.trim()] = c.id
        })

        let imported = 0
        let skipped = 0

        for (const row of rows) {
          const name = String(row.name || '').trim()
          if (!name) {
            skipped++
            continue
          }

          const categoryName = String(row.category || '???').trim()
          let categoryId = categoryMap[categoryName]

          if (!categoryId) {
            const result = categoriesDB.add(categoryName)
            categoryId = result.lastInsertRowid
            categoryMap[categoryName] = categoryId
          }

          const barcode = row.barcode ? String(row.barcode).trim() : null
          const dozenBarcode = row.dozen_barcode ? String(row.dozen_barcode).trim() : null
          const unit = String(row.unit || 'piece').trim()
          const scaleCode = unit === 'kg' && row.scale_code ? String(row.scale_code).trim() : null
          const hasExpiry = String(row.has_expiry || '').toLowerCase() === 'true' || String(row.has_expiry || '') === '1'
          const dozenEnabled = String(row.dozen_enabled || '').toLowerCase() === 'true' || String(row.dozen_enabled || '') === '1'
          const sameDozenPrice = String(row.dozen_price_same_as_unit || '').toLowerCase() === 'true' || String(row.dozen_price_same_as_unit || '') === '1'

          try {
            productsDB.add({
              name,
              barcode: barcode || null,
              barcode_type: String(row.barcode_type || 'CODE128').trim(),
              dozen_barcode: dozenEnabled && dozenBarcode ? dozenBarcode : null,
              scale_code: scaleCode || null,
              category_id: categoryId,
              sell_price: parseFloat(row.sell_price) || 0,
              product_tax_type: String(row.product_tax_type || 'percent').trim() === 'fixed' ? 'fixed' : 'percent',
              product_tax_rate: parseFloat(row.product_tax_rate) || 0,
              cost_price: parseFloat(row.cost_price) || 0,
              store_quantity: parseFloat(row.store_quantity) || parseFloat(row.quantity) || 0,
              main_quantity: parseFloat(row.main_quantity) || 0,
              min_quantity: parseFloat(row.min_quantity) || 0,
              unit,
              has_expiry: hasExpiry ? 1 : 0,
              dozen_enabled: dozenEnabled ? 1 : 0,
              dozen_quantity: dozenEnabled ? (parseFloat(row.dozen_quantity) || 0) : 0,
              dozen_price_same_as_unit: dozenEnabled ? (sameDozenPrice ? 1 : 0) : 1,
              dozen_price: dozenEnabled && !sameDozenPrice ? (parseFloat(row.dozen_price) || 0) : 0,
            })
            imported++
          } catch (err) {
            skipped++
          }
        }

        const response = { success: true, imported, skipped }
        try {
          auditDB.log({ action: 'product.import_excel', entityType: 'product', entityName: 'Products Import', details: { success: true, result: 'success', file_path: filePath, imported, skipped } })
        } catch (e) {}
        return response
      } catch (error) {
        console.error('Import Excel Error:', error)
        try {
          auditDB.log({ action: 'product.import_excel', entityType: 'product', entityName: 'Products Import', details: { success: false, result: 'failed', error: error.message || 'unknown_error' } })
        } catch (e) {}
        return { success: false, error: error.message }
      }
    },
  }
}

module.exports = { createExcelService }
