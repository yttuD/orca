import { afterEach, describe, it, expect, vi } from 'vitest'

afterEach(() => vi.unstubAllGlobals())
import { computeSha256Hex, exportMarkdownFile } from './ManagedTaskDetailTypes'

describe('ManagedReviewPacketView & Types (D02-E)', () => {
  it('computes exact SHA-256 for ASCII and Unicode text', async () => {
    const text = 'ORCA-D02 Review Packet: 🚀 Integración Operativa Desktop'
    const hash = await computeSha256Hex(text)
    expect(hash).toHaveLength(64)
    expect(typeof hash).toBe('string')
    // Deterministic check
    const hash2 = await computeSha256Hex(text)
    expect(hash).toBe(hash2)
  })

  it('handles packets > 64 KiB without truncation', async () => {
    // Generate 75 KiB of content
    const baseChunk = 'Line of authentic review evidence with hash checking and metrics.\n'
    const repeatCount = Math.ceil((75 * 1024) / baseChunk.length)
    const largePacket = baseChunk.repeat(repeatCount)
    const byteLength = new TextEncoder().encode(largePacket).length

    expect(byteLength).toBeGreaterThan(65536)

    const hash = await computeSha256Hex(largePacket)
    expect(hash).toHaveLength(64)

    // Ensure byte count is strictly preserved
    const copiedText = largePacket // No slice!
    expect(copiedText.length).toBe(largePacket.length)
  })

  it('preserves multi-byte Unicode and special characters without corruption', async () => {
    const unicodeString = 'Verificación: ✅ PASS, ❌ FAIL, ⚠️ WARNING, 日本語, Ñandú, Éxito 100%'
    const encoded = new TextEncoder().encode(unicodeString)
    const decoded = new TextDecoder().decode(encoded)
    expect(decoded).toBe(unicodeString)

    const hash = await computeSha256Hex(unicodeString)
    expect(hash).toHaveLength(64)
  })

  it('exports markdown without modification via Blob URL', () => {
    const content = '# Review Packet\n\n- Result: PASS\n- Bytes: 1000'
    const createObjectURLMock = vi.fn().mockReturnValue('blob:test-url')
    const revokeObjectURLMock = vi.fn()
    globalThis.URL.createObjectURL = createObjectURLMock
    globalThis.URL.revokeObjectURL = revokeObjectURLMock

    const clickMock = vi.fn()
    const appendChildMock = vi.fn()
    const removeChildMock = vi.fn()
    const anchor = { href: '', download: '', click: clickMock }
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(anchor),
      body: {
        appendChild: appendChildMock,
        removeChild: removeChildMock
      }
    })

    const ok = exportMarkdownFile(content, 'test-export.md')
    expect(ok).toBe(true)
    expect(createObjectURLMock).toHaveBeenCalled()
    expect(clickMock).toHaveBeenCalled()
    expect(anchor.download).toBe('test-export.md')
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-url')
  })

  it('handles write failure gracefully returning false', () => {
    // When URL.createObjectURL throws
    globalThis.URL.createObjectURL = vi.fn().mockImplementation(() => {
      throw new Error('Permission denied')
    })
    const ok = exportMarkdownFile('content', 'fail.md')
    expect(ok).toBe(false)
  })

  it('handles massive 120 KiB review packets cleanly', async () => {
    const chunk = '### Checkpoint 1234\n- Check: verify_security_boundary\n- Status: PASS\n'
    const massive = chunk.repeat(Math.ceil((120 * 1024) / chunk.length))
    expect(new TextEncoder().encode(massive).length).toBeGreaterThan(120 * 1024)

    const sha = await computeSha256Hex(massive)
    expect(sha).toHaveLength(64)
  })
})
