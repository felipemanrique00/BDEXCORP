import 'server-only'

import nodemailer, { type Transporter } from 'nodemailer'

import { getServerEnvironment } from '@/lib/server/environment'

let transporter: Transporter | null = null

export class EmailUnavailableError extends Error {
  constructor(message = 'Servico de e-mail nao configurado.') {
    super(message)
  }
}

export interface TransactionalEmail {
  to: string
  subject: string
  text: string
  html: string
}

export function emailConfigured(): boolean {
  return getServerEnvironment().SMTP_ENABLED
}

export async function sendTransactionalEmail(message: TransactionalEmail): Promise<void> {
  const environment = getServerEnvironment()
  if (!environment.SMTP_ENABLED || !environment.SMTP_HOST || !environment.SMTP_FROM) {
    throw new EmailUnavailableError()
  }

  const result = await getTransporter().sendMail({
    from: { name: environment.SMTP_FROM_NAME, address: environment.SMTP_FROM },
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
  if (!result.accepted?.length) throw new Error('O servidor SMTP nao aceitou a mensagem.')
}

export async function verifyEmailTransport(): Promise<void> {
  if (!emailConfigured()) throw new EmailUnavailableError()
  await getTransporter().verify()
}

function getTransporter(): Transporter {
  if (transporter) return transporter
  const environment = getServerEnvironment()
  if (!environment.SMTP_HOST) throw new EmailUnavailableError()

  transporter = nodemailer.createTransport({
    host: environment.SMTP_HOST,
    port: environment.SMTP_PORT,
    secure: environment.SMTP_SECURE,
    requireTLS: !environment.SMTP_SECURE,
    auth: environment.SMTP_USER && environment.SMTP_PASSWORD
      ? { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
  return transporter
}
