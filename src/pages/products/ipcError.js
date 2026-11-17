// Turns an error from the backend into a message a person can read: removes Electron's
// "Error invoking remote method 'x': Error: " prefix and reads the message out of a JSON body when there is one.
export function cleanIpcError(error, fallback) {
  let message = String(error?.message || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '').trim()
  if (message.startsWith('{')) {
    try {
      const body = JSON.parse(message)
      message = String(body.message || body.error || '').trim()
    } catch {
      // not JSON after all: keep the text
    }
  }
  return message || fallback
}
