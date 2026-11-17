const express = require('express')
const { storeMeshService, StoreMeshError } = require('../services/store-mesh.service')
const { requireSuperAdmin } = require('../middlewares/super-admin.middleware')
const { deviceAnnounceLimiter, generalApiLimiter, createRateLimiter } = require('../middlewares/rate-limit.middleware')
const logger = require('../utils/logger')

function sendError(res, req, error) {
  if (error instanceof StoreMeshError) {
    return res.status(error.status).json({ success: false, error: error.code, message: error.message, traceId: req.traceId })
  }
  logger.error('[STORE-MESH] unexpected error', { error: error.message, traceId: req.traceId })
  return res.status(500).json({ success: false, error: 'STORE_MESH_ERROR', message: 'Internal error', traceId: req.traceId })
}

const wrap = (handler) => async (req, res) => {
  try {
    await handler(req, res)
  } catch (error) {
    sendError(res, req, error)
  }
}

async function requireStoreDevice(req, res, next) {
  try {
    const header = String(req.headers.authorization || '')
    if (!header.startsWith('Bearer ')) throw new StoreMeshError('TOKEN_REQUIRED', 'Device token required', 401)
    req.storeDevice = await storeMeshService.authorizeDevice(header.slice(7), { traceId: req.traceId })
    next()
  } catch (error) {
    sendError(res, req, error)
  }
}

// Per device (from its verified token), not per IP: several devices of a shop share one router,
// and a device joining a big store uploads/downloads many pages in its first minutes.
const deviceLogLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => `${req.storeDevice?.deviceUuid || req.ip}_mesh_log`,
  code: 'SYNC_RATE_LIMIT_EXCEEDED',
})

// ---- devices ----
const deviceRouter = express.Router()

deviceRouter.post('/announce', deviceAnnounceLimiter, wrap(async (req, res) => {
  const b = req.body || {}
  const result = await storeMeshService.announce({
    storeUuid: b.storeUuid, keyHash: b.keyHash, deviceUuid: b.deviceUuid, deviceCode: b.deviceCode,
    machineId: b.machineId, appVersion: b.appVersion, storeName: b.storeName, ip: req.ip,
  }, { traceId: req.traceId })
  res.json({ success: true, ...result })
}))

deviceRouter.post('/log', requireStoreDevice, deviceLogLimiter, wrap(async (req, res) => {
  const result = await storeMeshService.pushLog({ ...req.storeDevice, events: req.body?.events }, { traceId: req.traceId })
  res.json({ success: true, ...result })
}))

deviceRouter.get('/log', requireStoreDevice, deviceLogLimiter, wrap(async (req, res) => {
  const result = await storeMeshService.pullLog({ storeUuid: req.storeDevice.storeUuid, deviceUuid: req.storeDevice.deviceUuid, since: req.query.since, limit: req.query.limit }, { traceId: req.traceId })
  res.json({ success: true, ...result })
}))

// ---- platform owner dashboard ----
const fleetRouter = express.Router()
fleetRouter.use(generalApiLimiter)
fleetRouter.use(requireSuperAdmin)

fleetRouter.get('/', wrap(async (req, res) => {
  res.json({ success: true, stores: await storeMeshService.listStores({ traceId: req.traceId }) })
}))

fleetRouter.patch('/:storeUuid', wrap(async (req, res) => {
  const b = req.body || {}
  res.json({ success: true, store: await storeMeshService.updateStore(req.params.storeUuid, b, { traceId: req.traceId }) })
}))

fleetRouter.patch('/:storeUuid/devices/:deviceUuid', wrap(async (req, res) => {
  const b = req.body || {}
  res.json({ success: true, device: await storeMeshService.updateDevice(req.params.storeUuid, req.params.deviceUuid, b, { traceId: req.traceId }) })
}))

module.exports = { deviceRouter, fleetRouter }
