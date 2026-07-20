// ============================================================
// V9: Sistema de notificações de novas demandas
// - Toca som quando demanda nova é criada
// - Mostra notificação do navegador (Web Notifications API)
// - Badge animado no menu lateral
// ============================================================
'use client'

import { safeGetRaw, safeSetRaw } from '@/lib/storage-quota'
import { DEFAULT_ASSISTANT_ALERT_SOUND_SETTING, getAlertSoundPreset } from '@/lib/assistant/presets'
import type { AssistantAlertSoundSetting } from '@/lib/assistant/types'
import { getAssistantSettingsClient } from '@/lib/assistant-settings-client'

const STORAGE_LAST_SEEN = 'bbt-last-seen-demanda'
const STORAGE_PREF_SOM = 'bbt-pref-som'
const STORAGE_PREF_NOTIF = 'bbt-pref-notificacao-navegador'
const STORAGE_ALERT_SOUND = 'bbt-assistant-alert-sound-v1'
export const NOVA_DEMANDA_EVENT = 'bbt:nova-demanda'

/**
 * Pede permissão pra mostrar notificações do navegador.
 * Deve ser chamado uma vez (ex: no primeiro login).
 */
export async function pedirPermissaoNotificacao(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const r = await Notification.requestPermission()
    return r === 'granted'
  } catch {
    return false
  }
}

export function notificacaoEstaAtiva(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false
  return Notification.permission === 'granted'
}

export function getPrefSom(): boolean {
  if (typeof window === 'undefined') return true
  return safeGetRaw(STORAGE_PREF_SOM) !== 'false'
}
export function setPrefSom(v: boolean) {
  if (typeof window === 'undefined') return
  safeSetRaw(STORAGE_PREF_SOM, String(v))
}
export function getPrefNotif(): boolean {
  if (typeof window === 'undefined') return true
  return safeGetRaw(STORAGE_PREF_NOTIF) !== 'false'
}
export function setPrefNotif(v: boolean) {
  if (typeof window === 'undefined') return
  safeSetRaw(STORAGE_PREF_NOTIF, String(v))
}

export function getAlertSoundSettings(): AssistantAlertSoundSetting {
  if (typeof window === 'undefined') return DEFAULT_ASSISTANT_ALERT_SOUND_SETTING
  const raw = safeGetRaw(STORAGE_ALERT_SOUND)
  if (!raw) return DEFAULT_ASSISTANT_ALERT_SOUND_SETTING
  try {
    return { ...DEFAULT_ASSISTANT_ALERT_SOUND_SETTING, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_ASSISTANT_ALERT_SOUND_SETTING
  }
}

export function setAlertSoundSettings(settings: AssistantAlertSoundSetting) {
  if (typeof window === 'undefined') return
  safeSetRaw(STORAGE_ALERT_SOUND, JSON.stringify(settings))
}

export async function hydrateAlertSoundSettingsFromAssistant() {
  if (typeof window === 'undefined') return
  const settings = await getAssistantSettingsClient()
  if (settings?.alertSound) setAlertSoundSettings(settings.alertSound)
}

/**
 * Toca um som curto de notificação (gerado via Web Audio API,
 * sem dependência de arquivo externo).
 */
export function tocarSomNotificacao() {
  if (typeof window === 'undefined') return
  if (!getPrefSom()) return
  const settings = getAlertSoundSettings()
  if (!settings.enabled) return
  const preset = getAlertSoundPreset(settings.selectedSound)
  if (preset.mode === 'silent') return
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext
    if (AC && (preset.mode === 'beep' || preset.mode === 'beep_spoken')) {
      const ctx = new AC()
      const repeat = Math.min(5, Math.max(1, Number(settings.repeat || 1)))
      for (let i = 0; i < repeat; i++) {
        playBeepPattern(ctx, settings.selectedSound, i * 0.55, settings.volume)
      }
      window.setTimeout(() => ctx.close?.().catch?.(() => undefined), repeat * 750)
    }
    if (preset.mode === 'spoken' || preset.mode === 'beep_spoken' || settings.speakMessage) {
      const message = settings.selectedSound === 'custom' ? settings.customMessage : preset.message
      speakAlert(message)
    }
  } catch (e) {
    console.warn('Falha ao tocar som:', e)
  }
}

export function testarSomAlerta(settings?: AssistantAlertSoundSetting) {
  if (typeof window === 'undefined') return
  if (settings) setAlertSoundSettings(settings)
  tocarSomNotificacao()
}

/**
 * Mostra notificação do navegador.
 */
export function mostrarNotificacao(titulo: string, corpo: string, url?: string) {
  if (typeof window === 'undefined') return
  if (!getPrefNotif()) return
  if (!('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    const n = new Notification(titulo, {
      body: corpo,
      icon: '/favicon.ico',
      tag: 'bbt-demanda',
      requireInteraction: false,
    })
    if (url) {
      n.onclick = () => {
        window.focus()
        window.location.href = url
        n.close()
      }
    }
    setTimeout(() => n.close(), 8000)
  } catch (e) {
    console.warn('Falha ao mostrar notificação:', e)
  }
}

/**
 * Marca o ID da última demanda vista pelo usuário.
 */
export function marcarUltimaVista(atendimentoId: string | null) {
  if (typeof window === 'undefined') return
  if (atendimentoId) safeSetRaw(STORAGE_LAST_SEEN, atendimentoId)
}

export function getUltimaVista(): string | null {
  if (typeof window === 'undefined') return null
  return safeGetRaw(STORAGE_LAST_SEEN)
}

/**
 * Dispara o alerta completo: som + notificação navegador.
 */
export function dispararAlertaNovaDemanda(
  passageiroNome: string,
  empresaNome: string,
  atendimentoId: string,
  serialOS?: string,
) {
  tocarSomNotificacao()
  const referencia = serialOS ? `${serialOS} · ` : ''
  mostrarNotificacao(
    '🔔 Nova demanda BBT',
    `${referencia}${passageiroNome} (${empresaNome}) — clique para atender`,
    `/dashboard/demandas?id=${atendimentoId}`
  )
  window.dispatchEvent(new CustomEvent(NOVA_DEMANDA_EVENT, {
    detail: { atendimentoId, serialOS: serialOS || null },
  }))
}

function playBeepPattern(ctx: AudioContext, soundId: string, offset: number, volume: number) {
  const safeVolume = Math.min(1, Math.max(0.05, Number(volume || 0.35)))
  const pattern =
    soundId === 'urgent_beeps' || soundId === 'wake_up_dead_flies'
      ? [
          [980, 0, 0.12],
          [1480, 0.14, 0.12],
          [1960, 0.28, 0.2],
        ]
      : [
          [880, 0, 0.18],
          [1320, 0.2, 0.18],
        ]

  pattern.forEach(([freq, when, dur]) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.type = soundId === 'urgent_beeps' || soundId === 'wake_up_dead_flies' ? 'square' : 'sine'
    osc.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset + when)
    gain.gain.exponentialRampToValueAtTime(safeVolume, ctx.currentTime + offset + when + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + when + dur)
    osc.start(ctx.currentTime + offset + when)
    osc.stop(ctx.currentTime + offset + when + dur)
  })
}

function speakAlert(message: string) {
  if (!message || typeof window === 'undefined' || !window.speechSynthesis) return
  const utterance = new SpeechSynthesisUtterance(message)
  utterance.lang = 'pt-BR'
  utterance.rate = 1.05
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}
