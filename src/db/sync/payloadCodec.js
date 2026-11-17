// Cold storage for replicated log payloads.
//
// Old log rows are kept (a device that was offline for months must still be able to catch up from
// them) but their JSON is stored compressed, which makes it about eight times smaller. A packed value is
// a BLOB that starts with a 3-byte marker; anything else is plain JSON text, so rows written before this
// existed, and rows that are still fresh, are read exactly as before.
//   NZ1  gzip                              (read only, kept for rows written by earlier builds)
//   NZ2  deflate with the preset dictionary in payloadDictionary.js (what pack() writes)
const zlib = require('zlib')
const DICTIONARY_V2 = require('./payloadDictionary')

const MAGIC_V1 = Buffer.from('NZ1')
const MAGIC_V2 = Buffer.from('NZ2')
const MARKER_LENGTH = 3

function hasMarker(value, marker) {
  return Buffer.isBuffer(value) && value.length > MARKER_LENGTH && value.subarray(0, MARKER_LENGTH).equals(marker)
}

function isPacked(value) {
  return hasMarker(value, MAGIC_V1) || hasMarker(value, MAGIC_V2)
}

function pack(jsonText) {
  const body = zlib.deflateSync(Buffer.from(String(jsonText), 'utf8'), { level: 9, dictionary: DICTIONARY_V2 })
  return Buffer.concat([MAGIC_V2, body])
}

/** @returns {string} the JSON text, whether the stored value is packed or plain */
function unpack(value) {
  if (hasMarker(value, MAGIC_V2)) return zlib.inflateSync(value.subarray(MARKER_LENGTH), { dictionary: DICTIONARY_V2 }).toString('utf8')
  if (hasMarker(value, MAGIC_V1)) return zlib.gunzipSync(value.subarray(MARKER_LENGTH)).toString('utf8')
  if (Buffer.isBuffer(value)) return value.toString('utf8')
  return String(value)
}

function parsePayload(value) {
  return JSON.parse(unpack(value))
}

module.exports = { pack, unpack, parsePayload, isPacked }
