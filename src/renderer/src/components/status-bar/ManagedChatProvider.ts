/**
 * Selection of the manual chat architect. This is a UI preference, NOT an
 * authenticated statement about which provider authored any pasted verdict.
 */
export type ManualChatProvider = 'chatgpt_chat' | 'venice_chat'
export const MANUAL_CHAT_PROVIDER_KEY = 'orcastrator.manual-chat-provider.v1'

export const MANUAL_CHAT_OPTIONS: Readonly<
  Record<ManualChatProvider, { readonly label: string; readonly url: string }>
> = {
  chatgpt_chat: { label: 'ChatGPT — Modo Chat', url: 'https://chatgpt.com/' },
  venice_chat: { label: 'Venice AI — Modo Chat', url: 'https://venice.ai/chat' }
}

export function isManualChatProvider(value: unknown): value is ManualChatProvider {
  return value === 'chatgpt_chat' || value === 'venice_chat'
}

export function loadManualChatProvider(): ManualChatProvider {
  try {
    const stored = window.localStorage.getItem(MANUAL_CHAT_PROVIDER_KEY)
    return isManualChatProvider(stored) ? stored : 'chatgpt_chat'
  } catch {
    return 'chatgpt_chat'
  }
}

export function saveManualChatProvider(value: ManualChatProvider): void {
  try {
    window.localStorage.setItem(MANUAL_CHAT_PROVIDER_KEY, value)
  } catch {
    // Preference persistence is optional. Never block manual chat operation.
  }
}

/** Backend audit label: an operator declaration, never verified provider identity. */
export function manualVerdictAuditMode(value: ManualChatProvider): string {
  return value === 'venice_chat'
    ? 'MANUAL_OPERATOR_APPROVAL_VENICE_CHAT_OPERATOR_ATTESTED'
    : 'MANUAL_OPERATOR_APPROVAL_CHATGPT_CHAT_OPERATOR_ATTESTED'
}
