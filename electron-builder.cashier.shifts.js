const base = require('./electron-builder.cashier')

module.exports = {
  ...base,
  directories: {
    output: 'release/cashier-shifts',
  },
}
