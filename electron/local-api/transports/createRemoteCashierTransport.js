function createRemoteCashierTransport({ cashierConnectionService }) {
  return {
    invoke(channel, event, ...args) {
      return cashierConnectionService.invoke(channel, args)
    },
  }
}

module.exports = { createRemoteCashierTransport }
