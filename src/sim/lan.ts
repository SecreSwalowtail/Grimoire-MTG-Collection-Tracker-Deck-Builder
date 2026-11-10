import * as Network from 'expo-network'

// Two phones on the same Wi-Fi (or one on the other's hotspot) talk over a plain TCP connection:
// one hosts, the other joins with the host's address. Nothing leaves the local network.
// Messages are JSON, one per line.

export const PORT = 47826

export type Link = { send: (message: object) => void; close: () => void }
type Handlers = { onMessage: (message: unknown) => void; onClose: () => void }

// Just the parts of react-native-tcp-socket used here.
type RawSocket = {
  setEncoding: (encoding: 'utf8') => void
  write: (data: string) => void
  destroy: () => void
  on: (event: string, listener: (arg?: unknown) => void) => void
}
type RawServer = { listen: (options: { port: number; host: string; reuseAddress: boolean }) => void; close: () => void; on: (event: string, listener: (arg?: unknown) => void) => void }
type Tcp = {
  createServer: (onConnection: (socket: RawSocket) => void) => RawServer
  createConnection: (options: { port: number; host: string }, onConnect: () => void) => RawSocket
}

// Loaded on first use: the native module isn't in every build (web, or an app built before it was added).
async function tcp(): Promise<Tcp> {
  try {
    const module = (await import('react-native-tcp-socket')) as unknown as { default?: Tcp } & Tcp
    const api = module.default ?? module
    if (typeof api.createServer !== 'function') throw new Error('missing')
    return api
  } catch {
    throw new Error('This build of the app can’t connect to other phones. Update the app and try again.')
  }
}

function wrap(socket: RawSocket, handlers: Handlers): Link {
  let buffer = ''
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    handlers.onClose()
  }
  socket.setEncoding('utf8')
  socket.on('data', (chunk) => {
    buffer += String(chunk)
    let at = buffer.indexOf('\n')
    while (at >= 0) {
      const line = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      at = buffer.indexOf('\n')
      if (!line) continue
      try {
        handlers.onMessage(JSON.parse(line))
      } catch {
        // A line that isn't JSON: ignored.
      }
    }
  })
  socket.on('error', close)
  socket.on('close', close)
  return {
    send(message) {
      if (closed) return
      try {
        socket.write(`${JSON.stringify(message)}\n`)
      } catch {
        close()
      }
    },
    close() {
      closed = true
      try {
        socket.destroy()
      } catch {}
    },
  }
}

// This phone's address on the local network, or null when it isn't on one.
export async function localAddress() {
  try {
    const ip = await Network.getIpAddressAsync()
    return ip && ip !== '0.0.0.0' && !ip.includes(':') ? ip : null
  } catch {
    return null
  }
}

// Waits for one other phone. `onGuest` gets the connection; a second phone is turned away.
export async function host(onGuest: (connect: (handlers: Handlers) => Link) => void, onError: (text: string) => void) {
  const api = await tcp()
  let busy = false
  const server = api.createServer((socket) => {
    if (busy) {
      socket.destroy()
      return
    }
    busy = true
    onGuest((handlers) =>
      wrap(socket, {
        onMessage: handlers.onMessage,
        onClose: () => {
          busy = false
          handlers.onClose()
        },
      }),
    )
  })
  server.on('error', () => onError('Couldn’t open a game on this phone. Check that Wi-Fi is on and try again.'))
  server.listen({ port: PORT, host: '0.0.0.0', reuseAddress: true })
  return () => {
    try {
      server.close()
    } catch {}
  }
}

export async function join(address: string, handlers: Handlers & { onOpen: () => void }): Promise<Link> {
  const api = await tcp()
  const socket = api.createConnection({ port: PORT, host: address }, handlers.onOpen)
  return wrap(socket, handlers)
}

// What the guest types: a full address ("192.168.1.23"), or just its last number ("23") when
// both phones are on the same network, which is filled in from this phone's own address.
export function resolveAddress(typed: string, own: string | null) {
  const text = typed.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(text)) return text
  if (/^\d{1,3}$/.test(text) && own) return `${own.split('.').slice(0, 3).join('.')}.${text}`
  return null
}
