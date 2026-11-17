const crypto = require('crypto')

// Prometheus metrics describe the whole fleet, so they are not public. A scraper sends
// `Authorization: Bearer <METRICS_TOKEN>`. Without a configured token only the server itself
// (loopback) may read them, which is the safe default for a forgotten setting.
function requireMetricsAccess(req, res, next) {
  const token = String(process.env.METRICS_TOKEN || '')
  if (token) {
    const sent = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    const a = Buffer.from(token)
    const b = Buffer.from(sent)
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next()
    return res.status(401).json({ success: false, message: 'Unauthorized' })
  }
  const ip = String(req.socket?.remoteAddress || '')
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return next()
  return res.status(403).json({ success: false, message: 'Metrics are restricted' })
}

module.exports = { requireMetricsAccess }
