export type AssistantChannel = 'system' | 'whatsapp' | 'voice' | 'portal' | 'test'
export type AssistantMode = 'sandbox' | 'production'
export type AssistantResponseMode = 'text' | 'audio' | 'auto'
export type AssistantVoiceGender = 'female' | 'male' | 'neutral'
export type AssistantPersonalityPresetId =
  | 'operational_pro'
  | 'formal_executive'
  | 'human_friendly'
  | 'direct_operator'
  | 'strict_auditor'
  | 'tough_internal'
  | 'custom'
export type AssistantAttendanceStyle = 'professional' | 'formal' | 'friendly' | 'direct' | 'strict' | 'rude_internal'
export type AssistantAlertSoundId = 'bbt_default' | 'urgent_beeps' | 'wake_up_dead_flies' | 'custom' | 'silent'
export type AssistantToolKind = 'read' | 'write' | 'document' | 'message' | 'handoff' | 'analysis'
export type AssistantToolStatus = 'active' | 'disabled'
export type WhatsAppConnectionStatus = 'disconnected' | 'waiting_qr' | 'connected' | 'expired' | 'error'
export type AssistantLogLevel = 'info' | 'warn' | 'error' | 'security'

export interface AssistantSetting {
  id: 'default'
  active: boolean
  assistantName: string
  provider: 'openai' | 'gemini' | 'custom'
  model: string
  temperature: number
  language: string
  initialMessage: string
  personalityPreset: AssistantPersonalityPresetId
  attendanceStyle: AssistantAttendanceStyle
  personality: string
  tone: string
  customPersonality: string
  systemInstruction: string
  behaviorRules: string
  securityRules: string
  unknownMessage: string
  errorMessage: string
  humanHandoffMessage: string
  memoryEnabled: boolean
  contextWindow: number
  responseLimit: number
  whatsapp: AssistantWhatsAppSetting
  voice: AssistantVoiceSetting
  permissions: AssistantPermissionSetting
  serviceHours: AssistantServiceHours
  pdf: AssistantPdfSetting
  alertSound: AssistantAlertSoundSetting
  updatedAt: string
  updatedBy?: string
}

export interface AssistantWhatsAppSetting {
  mode: AssistantMode
  provider: 'whatsapp_web' | 'cloud_api' | 'evolution_api' | 'zapi' | 'twilio'
  autoReply: boolean
  autoSendFiles: boolean
  dailyMessageLimit: number
  retryLimit: number
  queueEnabled: boolean
  businessHoursOnly: boolean
}

export interface AssistantVoiceSetting {
  speechToTextEnabled: boolean
  textToSpeechEnabled: boolean
  transcriptionProvider: 'browser' | 'openai' | 'custom'
  voiceProvider: 'browser' | 'openai' | 'custom'
  voice: string
  voiceGender: AssistantVoiceGender
  speed: number
  audioFormat: 'webm' | 'ogg' | 'mp3' | 'wav'
  language: string
  responseMode: AssistantResponseMode
  maxDurationSeconds: number
  acceptedFormats: string[]
  storageMode: 'temporary' | 'secure_storage' | 'disabled'
  fallbackMessage: string
}

export interface AssistantPermissionSetting {
  allowedModules: string[]
  sensitiveModules: string[]
  blockedActions: string[]
  requireConfirmationTools: string[]
  allowedChannels: AssistantChannel[]
  allowFinancialData: boolean
  allowVoucherLookup: boolean
  allowPdfGeneration: boolean
  allowWhatsAppSend: boolean
  allowHumanHandoff: boolean
}

export interface AssistantServiceHours {
  enabled: boolean
  timezone: string
  start: string
  end: string
  weekdays: number[]
  afterHoursMessage: string
}

export interface AssistantPdfSetting {
  voucherTemplate: 'standard' | 'compact' | 'supplier'
  footerText: string
  watermark: string
  includeLogo: boolean
  protectSensitiveData: boolean
  allowAutoSend: boolean
  allowResend: boolean
}

export interface AssistantAlertSoundSetting {
  enabled: boolean
  selectedSound: AssistantAlertSoundId
  volume: number
  speakMessage: boolean
  customMessage: string
  repeat: number
}

export interface AssistantToolDefinition {
  id: string
  name: string
  description: string
  kind: AssistantToolKind
  module: string
  status: AssistantToolStatus
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  permissions: string[]
  channels: AssistantChannel[]
  sensitive: boolean
  requiresConfirmation: boolean
  whatsappEnabled: boolean
  internalEnabled: boolean
}

export interface AssistantToolRunContext {
  userId?: string
  userName?: string
  userRole?: string
  companyId?: string | null
  channel: AssistantChannel
  conversationId?: string
  confirmed?: boolean
}

export interface AssistantToolResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  requiresConfirmation?: boolean
  blocked?: boolean
  auditId?: string
}

export interface AssistantAuditLog {
  id: string
  level: AssistantLogLevel
  action: string
  module: string
  entityType?: string
  entityId?: string
  userId?: string
  userName?: string
  companyId?: string | null
  channel: AssistantChannel
  conversationId?: string
  toolId?: string
  inputSummary?: string
  outputSummary?: string
  error?: string
  metadata?: Record<string, unknown>
  createdAt: string
}

export interface AssistantToolLog {
  id: string
  toolId: string
  status: 'success' | 'blocked' | 'error' | 'confirmation_required'
  durationMs: number
  userId?: string
  companyId?: string | null
  channel: AssistantChannel
  conversationId?: string
  inputSummary: string
  outputSummary?: string
  error?: string
  createdAt: string
}

export interface AssistantConversation {
  id: string
  channel: AssistantChannel
  status: 'open' | 'waiting_human' | 'closed'
  participantName?: string
  participantPhone?: string
  companyId?: string | null
  assignedToUserId?: string
  tags: string[]
  priority: 'low' | 'normal' | 'high' | 'urgent'
  lastMessageAt: string
  createdAt: string
  updatedAt: string
}

export interface AssistantConversationMessage {
  id: string
  conversationId: string
  direction: 'inbound' | 'outbound' | 'internal'
  role: 'user' | 'assistant' | 'system' | 'human'
  type: 'text' | 'audio' | 'document' | 'image' | 'event'
  content: string
  transcript?: string
  fileId?: string
  toolCalls?: string[]
  sensitive: boolean
  createdAt: string
}

export interface WhatsAppSessionState {
  id: 'default'
  mode: AssistantMode
  provider: AssistantWhatsAppSetting['provider']
  status: WhatsAppConnectionStatus
  connectedNumber?: string
  qrCode?: string
  lastConnectionAt?: string
  lastDisconnectAt?: string
  lastMessageAt?: string
  expiresAt?: string
  error?: string
  updatedAt: string
}

export interface GeneratedDocument {
  id: string
  type: 'voucher' | 'report' | 'receipt' | 'generic'
  status: 'generated' | 'failed'
  title: string
  entityId?: string
  companyId?: string | null
  html?: string
  fileName: string
  mimeType: string
  error?: string
  createdBy?: string
  createdAt: string
}

export interface VoucherSendLog {
  id: string
  voucherId: string
  documentId?: string
  channel: AssistantChannel
  recipientPhone?: string
  recipientName?: string
  status: 'sent' | 'queued' | 'blocked' | 'failed'
  error?: string
  createdAt: string
}

export interface AudioTranscriptionLog {
  id: string
  provider: string
  status: 'success' | 'failed'
  language: string
  source: AssistantChannel
  fileName?: string
  transcript?: string
  error?: string
  createdAt: string
}

export interface AudioGenerationLog {
  id: string
  provider: string
  status: 'success' | 'failed'
  voice: string
  format: string
  textPreview: string
  error?: string
  createdAt: string
}
