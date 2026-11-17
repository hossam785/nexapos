/**
 * NEXA POS Clock Drift Guard & Monotonic Ordering Engine
 * 
 * Architectural Responsibilities:
 * 1. Authoritative Server Drift Offset Tracking: Calculates delta between local machine and cloud server timestamps.
 * 2. Hybrid Logical Clock (HLC) & Strict Monotonicity: Guarantees newly generated event timestamps strictly advance (T[n] > T[n-1]).
 * 3. Clock Tampering & Rollback Detection: Flags machine when OS clock is rolled back > 60s, emitting alerts and telemetry.
 * 4. Future Timestamp Boundary Validation: Protects ingestion pipeline by enforcing 5-minute future tolerance boundaries.
 * 5. Cold-Boot Persistence: Persists drift offset, last monotonic timestamp, and tampering flags in settingsDB.
 */

const { EventEmitter } = require('events')

class ClockDriftGuard extends EventEmitter {
  constructor({
    settingsDB = null,
    logger = console,
    backwardJumpThresholdMs = 60000, // 60 seconds rollback tolerance
    futureToleranceMs = 300000,      // 5 minutes future tolerance
  } = {}) {
    super()

    this.settingsDB = settingsDB
    this.logger = logger
    this.backwardJumpThresholdMs = backwardJumpThresholdMs
    this.futureToleranceMs = futureToleranceMs

    // State initialization
    this.driftOffsetMs = 0
    this.lastAuthoritativeServerTimeMs = 0
    this.lastMonotonicTimestampMs = 0
    this.lastMonotonicSeq = 0
    this.isClockCompromised = false

    this._hydrateFromSettings()
  }

  _hydrateFromSettings() {
    if (!this.settingsDB) return

    try {
      const getVal = (k) => {
        if (typeof this.settingsDB.get === 'function') {
          const row = this.settingsDB.get(k)
          return row?.value !== undefined ? row.value : row
        }
        return null
      }

      const savedDrift = getVal('clock_drift_offset_ms')
      if (savedDrift !== null && savedDrift !== undefined && !isNaN(Number(savedDrift))) {
        this.driftOffsetMs = Number(savedDrift)
      }

      const savedServerTime = getVal('clock_last_authoritative_server_time')
      if (savedServerTime && !isNaN(Number(savedServerTime))) {
        this.lastAuthoritativeServerTimeMs = Number(savedServerTime)
      }

      const savedMonotonic = getVal('clock_last_monotonic_timestamp')
      if (savedMonotonic && !isNaN(Number(savedMonotonic))) {
        this.lastMonotonicTimestampMs = Number(savedMonotonic)
      }

      const savedSeq = getVal('clock_last_monotonic_seq')
      if (savedSeq && !isNaN(Number(savedSeq))) {
        this.lastMonotonicSeq = Number(savedSeq)
      }

      const savedCompromised = getVal('clock_tampering_detected')
      if (savedCompromised === '1' || savedCompromised === 1 || savedCompromised === true) {
        this.isClockCompromised = true
      }
    } catch (err) {
      this.logger.warn?.('[ClockDriftGuard] Failed to hydrate clock state from settingsDB:', err.message)
    }
  }

  _persist(key, value) {
    if (!this.settingsDB || typeof this.settingsDB.set !== 'function') return
    try {
      this.settingsDB.set(key, String(value))
    } catch (err) {
      this.logger.warn?.(`[ClockDriftGuard] Failed to persist ${key}:`, err.message)
    }
  }

  /**
   * Ingests authoritative server timestamp from heartbeat or sync API responses.
   * @param {string|number|Date} serverTime - Authoritative server time
   * @param {number} localReferenceMs - Optional local timestamp (defaults to Date.now())
   */
  recordServerTime(serverTime, localReferenceMs = Date.now()) {
    if (!serverTime) return { driftOffsetMs: this.driftOffsetMs, isClockCompromised: this.isClockCompromised }

    const serverMs = new Date(serverTime).getTime()
    if (isNaN(serverMs)) return { driftOffsetMs: this.driftOffsetMs, isClockCompromised: this.isClockCompromised }

    const calculatedDrift = serverMs - localReferenceMs
    this.driftOffsetMs = calculatedDrift
    this._persist('clock_drift_offset_ms', calculatedDrift)

    if (serverMs > this.lastAuthoritativeServerTimeMs) {
      this.lastAuthoritativeServerTimeMs = serverMs
      this._persist('clock_last_authoritative_server_time', serverMs)
    }

    // Tampering / Rollback Detection:
    // If local physical time is significantly earlier than our last recorded monotonic point minus threshold
    if (this.lastMonotonicTimestampMs > 0) {
      const rollbackDelta = this.lastMonotonicTimestampMs - (localReferenceMs + this.driftOffsetMs)
      if (rollbackDelta > this.backwardJumpThresholdMs) {
        this.isClockCompromised = true
        this._persist('clock_tampering_detected', '1')

        const alertData = {
          localTime: new Date(localReferenceMs).toISOString(),
          serverTime: new Date(serverMs).toISOString(),
          lastMonotonicTime: new Date(this.lastMonotonicTimestampMs).toISOString(),
          rollbackDeltaMs: rollbackDelta,
        }

        this.logger.warn?.('[ClockDriftGuard] System clock rollback or tampering detected:', alertData)
        this.emit('clock-rollback-detected', alertData)
      }
    }

    return {
      driftOffsetMs: this.driftOffsetMs,
      isClockCompromised: this.isClockCompromised,
      serverTime: new Date(serverMs).toISOString(),
    }
  }

  /**
   * Generates a strictly monotonically increasing timestamp and sequence number.
   * Hybrid Logical Clock guarantee: T[next] >= max(local + drift, T[prev] + 1)
   */
  getMonotonicTimestamp(localReferenceMs = Date.now()) {
    const candidateMs = localReferenceMs + this.driftOffsetMs

    let monotonicMs = candidateMs
    let isAdjusted = false

    if (candidateMs <= this.lastMonotonicTimestampMs) {
      monotonicMs = this.lastMonotonicTimestampMs + 1
      isAdjusted = true
    }

    this.lastMonotonicTimestampMs = monotonicMs
    this.lastMonotonicSeq += 1

    this._persist('clock_last_monotonic_timestamp', monotonicMs)
    this._persist('clock_last_monotonic_seq', this.lastMonotonicSeq)

    return {
      timestamp: new Date(monotonicMs).toISOString(),
      timestampMs: monotonicMs,
      monotonicSeq: this.lastMonotonicSeq,
      isAdjusted,
    }
  }

  /**
   * Calculates estimated server time given a local Date or timestamp.
   */
  getAdjustedServerTime(localDateOrMs = Date.now()) {
    const ms = localDateOrMs instanceof Date ? localDateOrMs.getTime() : Number(localDateOrMs)
    const safeMs = !isNaN(ms) ? ms : Date.now()
    return new Date(safeMs + this.driftOffsetMs).toISOString()
  }

  /**
   * Validates whether a timestamp conforms to server acceptance boundaries.
   */
  validateTimestamp(timestamp, serverReferenceMs = null) {
    const timeMs = new Date(timestamp).getTime()
    if (isNaN(timeMs)) {
      return { isValid: false, reason: 'INVALID_TIMESTAMP', deltaMs: null }
    }

    const refMs = serverReferenceMs !== null ? Number(serverReferenceMs) : (Date.now() + this.driftOffsetMs)

    // Check future tolerance (reject > 5 minutes in future)
    if (timeMs - refMs > this.futureToleranceMs) {
      return {
        isValid: false,
        reason: 'FUTURE_TIMESTAMP_EXCEEDED',
        deltaMs: timeMs - refMs,
      }
    }

    // Check historical sanity boundary (prior to year 2020)
    if (timeMs < 1577836800000) {
      return {
        isValid: false,
        reason: 'PAST_TIMESTAMP_EXCEEDED',
        deltaMs: refMs - timeMs,
      }
    }

    return {
      isValid: true,
      deltaMs: timeMs - refMs,
    }
  }

  /**
   * Normalizes an event's timestamp so it is monotonic and within server acceptance windows.
   */
  sanitizeEventTimestamp(rawTimestamp, localReferenceMs = Date.now()) {
    let targetMs = rawTimestamp ? new Date(rawTimestamp).getTime() : NaN

    // If invalid or missing, derive from monotonic clock
    if (isNaN(targetMs)) {
      return this.getMonotonicTimestamp(localReferenceMs).timestamp
    }

    // Apply drift offset if event timestamp was created locally
    const validation = this.validateTimestamp(targetMs)
    if (!validation.isValid) {
      // Future timestamp exceeded or severe rollback: force monotonic progression
      return this.getMonotonicTimestamp(localReferenceMs).timestamp
    }

    // Enforce monotonic progression even for valid raw timestamps
    if (targetMs <= this.lastMonotonicTimestampMs) {
      targetMs = this.lastMonotonicTimestampMs + 1
      this.lastMonotonicTimestampMs = targetMs
      this._persist('clock_last_monotonic_timestamp', targetMs)
    } else {
      this.lastMonotonicTimestampMs = targetMs
      this._persist('clock_last_monotonic_timestamp', targetMs)
    }

    return new Date(targetMs).toISOString()
  }

  getStatus() {
    return {
      driftOffsetMs: this.driftOffsetMs,
      lastAuthoritativeServerTime: this.lastAuthoritativeServerTimeMs ? new Date(this.lastAuthoritativeServerTimeMs).toISOString() : null,
      lastMonotonicTimestamp: this.lastMonotonicTimestampMs ? new Date(this.lastMonotonicTimestampMs).toISOString() : null,
      lastMonotonicSeq: this.lastMonotonicSeq,
      isClockCompromised: this.isClockCompromised,
      futureToleranceMs: this.futureToleranceMs,
      backwardJumpThresholdMs: this.backwardJumpThresholdMs,
    }
  }

  reset() {
    this.driftOffsetMs = 0
    this.lastAuthoritativeServerTimeMs = 0
    this.lastMonotonicTimestampMs = 0
    this.lastMonotonicSeq = 0
    this.isClockCompromised = false
  }
}

function createClockDriftGuard(dependencies) {
  return new ClockDriftGuard(dependencies)
}

module.exports = {
  ClockDriftGuard,
  createClockDriftGuard,
}
