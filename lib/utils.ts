import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDateBR } from '@/lib/date'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ============ MÁSCARAS ============

export function maskCPF(value: string): string {
  const v = value.replace(/\D/g, '').slice(0, 11)
  return v
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

export function maskPhone(value: string): string {
  const v = value.replace(/\D/g, '').slice(0, 11)
  if (v.length <= 10) {
    return v.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  }
  return v.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export function maskCNPJ(value: string): string {
  const v = value.replace(/\D/g, '').slice(0, 14)
  return v
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return '—'
  return maskPhone(digits)
}

export function onlyDigits(v: string): string {
  return v.replace(/\D/g, '')
}

export function whatsappLink(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = onlyDigits(phone)
  if (digits.length < 10) return null
  // Adiciona 55 se não tiver
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`
  return `https://wa.me/${withCountry}`
}

// ============ DATAS ============
export function formatDate(iso: string | null | undefined): string {
  return formatDateBR(iso, '-')
}
