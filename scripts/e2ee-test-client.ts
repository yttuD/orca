import { WebSocket, type WebSocketServer } from 'ws'
import nacl from 'tweetnacl'
import {
  deriveSharedKey,
  e2eeDecrypt,
  e2eeEncrypt,
  type E2EEState
} from '../mobile/scripts/mock-server-encryption'
import type { RpcDispatcher } from '../src/main/runtime/rpc/dispatcher'

export type RpcResponsePayload = {
  ok: boolean
  result?: unknown
  error?: { message?: string; code?: string }
}

export class AuthenticE2eeMobileRpcClient {
  private ws: WebSocket | null = null
  private state: 'connecting' | 'connected' | 'disconnected' = 'connecting'
  private reqCounter = 0
  private readonly pending = new Map<
    string,
    {
      resolve: (val: RpcResponsePayload) => void
      reject: (err: Error) => void
    }
  >()
  private sharedKey: Uint8Array | null = null

  constructor(
    private readonly endpoint: string,
    private readonly deviceToken: string,
    private readonly serverPublicKeyB64: string
  ) {}

  async connect(): Promise<void> {
    const clientKeyPair = nacl.box.keyPair()
    const clientPublicKeyB64 = Buffer.from(clientKeyPair.publicKey).toString('base64')
    const serverPkBytes = Uint8Array.from(Buffer.from(this.serverPublicKeyB64, 'base64'))
    this.sharedKey = deriveSharedKey(clientKeyPair.secretKey, serverPkBytes)

    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.endpoint)
      this.ws.on('open', () => {
        this.ws?.send(JSON.stringify({ type: 'e2ee_hello', publicKeyB64: clientPublicKeyB64 }))
      })

      this.ws.on('message', (raw) => {
        const msg = typeof raw === 'string' ? raw : raw.toString('utf-8')
        if (this.state === 'connecting') {
          if (!this.sharedKey) {
            return
          }
          let parsed: { type?: string }
          try {
            parsed = JSON.parse(msg)
          } catch {
            const dec = e2eeDecrypt(msg, this.sharedKey)
            parsed = dec ? JSON.parse(dec) : {}
          }

          if (parsed.type === 'e2ee_ready') {
            const authCipher = e2eeEncrypt(
              JSON.stringify({ type: 'e2ee_auth', deviceToken: this.deviceToken }),
              this.sharedKey
            )
            this.ws?.send(authCipher)
            return
          }

          if (parsed.type === 'e2ee_authenticated') {
            this.state = 'connected'
            res()
            return
          }
        }

        if (this.sharedKey) {
          const plaintext = e2eeDecrypt(msg, this.sharedKey)
          if (!plaintext) {
            return
          }
          const resp = JSON.parse(plaintext) as {
            id: string
            ok: boolean
            result?: unknown
            error?: { message?: string; code?: string }
          }
          const p = this.pending.get(resp.id)
          if (p) {
            this.pending.delete(resp.id)
            p.resolve(resp)
          }
        }
      })

      this.ws.on('error', (err) => {
        this.state = 'disconnected'
        rej(err)
      })

      this.ws.on('close', () => {
        this.state = 'disconnected'
      })
    })
  }

  async sendRequest(method: string, params?: unknown): Promise<RpcResponsePayload> {
    if (!this.ws || this.state !== 'connected' || !this.sharedKey) {
      throw new Error('Transport socket is not connected')
    }

    const id = `req-${++this.reqCounter}`
    const payload = JSON.stringify({
      id,
      method,
      params,
      authToken: this.deviceToken
    })

    const encrypted = e2eeEncrypt(payload, this.sharedKey)
    this.ws.send(encrypted)

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Timeout waiting for RPC ${method}`))
      }, 5000)

      this.pending.set(id, {
        resolve: (val) => {
          clearTimeout(timer)
          resolve(val)
        },
        reject: (err) => {
          clearTimeout(timer)
          reject(err)
        }
      })
    })
  }

  getState(): { kind: 'connected' | 'connecting' | 'disconnected' } {
    return { kind: this.state }
  }

  close(): void {
    this.ws?.close()
  }
}

export function setupDesktopRpcServer(
  wss: WebSocketServer,
  dispatcher: RpcDispatcher,
  desktopKeyPair: nacl.BoxKeyPair
): void {
  const connectionMap = new Map<WebSocket, E2EEState>()

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = typeof raw === 'string' ? raw : raw.toString('utf-8')
      const e2ee = connectionMap.get(ws)

      if (!e2ee) {
        const hello = JSON.parse(msg) as { type?: string; publicKeyB64?: string }
        if (hello.type === 'e2ee_hello' && hello.publicKeyB64) {
          const clientPk = Uint8Array.from(Buffer.from(hello.publicKeyB64, 'base64'))
          const sharedKey = deriveSharedKey(desktopKeyPair.secretKey, clientPk)
          connectionMap.set(ws, { sharedKey, deviceToken: null, authenticated: false })
          ws.send(JSON.stringify({ type: 'e2ee_ready' }))
        }
        return
      }

      const plaintext = e2eeDecrypt(msg, e2ee.sharedKey)
      if (!plaintext) {
        return
      }

      const req = JSON.parse(plaintext) as {
        id: string
        method: string
        params?: Record<string, unknown>
        type?: string
        deviceToken?: string
      }

      if (!e2ee.authenticated) {
        if (req.type === 'e2ee_auth') {
          e2ee.deviceToken = req.deviceToken ?? null
          e2ee.authenticated = true
          ws.send(e2eeEncrypt(JSON.stringify({ type: 'e2ee_authenticated' }), e2ee.sharedKey))
        }
        return
      }

      void dispatcher.dispatchStreaming(
        {
          id: req.id,
          authToken: e2ee.deviceToken ?? '',
          method: req.method,
          params: req.params ?? {}
        },
        (respStr) => {
          ws.send(e2eeEncrypt(respStr, e2ee.sharedKey))
        },
        {
          clientKind: 'mobile',
          pairedDeviceId: (req.params?._auth as { deviceId?: string })?.deviceId ?? 'pixel-8-e2e'
        }
      )
    })
  })
}
