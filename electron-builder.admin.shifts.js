const base = require('./electron-builder.admin')

module.exports = {
  ...base,
  directories: {
    output: 'release/admin-shifts',
  },
}
