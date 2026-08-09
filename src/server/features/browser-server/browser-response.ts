import type { ServerResponse } from 'node:http'
import type { RequestSecurityFailure } from './browser-request-security'

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', contentSecurityPolicy)
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function mimeType(filePath: string): string {
  if (filePath.endsWith('.js')) {
    return 'text/javascript; charset=utf-8'
  }
  if (filePath.endsWith('.css')) {
    return 'text/css; charset=utf-8'
  }
  if (filePath.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  if (filePath.endsWith('.ico')) {
    return 'image/x-icon'
  }
  if (filePath.endsWith('.json')) {
    return 'application/json; charset=utf-8'
  }
  return 'application/octet-stream'
}

export function isImmutableRendererAsset(filePath: string): boolean {
  return /^assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(filePath)
}

export function isAllowedRendererFile(filePath: string): boolean {
  return (
    filePath === 'rebase-manifest.json' ||
    filePath === 'favicon.svg' ||
    filePath === 'favicon.ico' ||
    isImmutableRendererAsset(filePath)
  )
}

export function rendererPathname(pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\\') || decoded.split('/').includes('..')) {
    return undefined
  }
  return decoded.replace(/^\//, '')
}

export function hasUnsafeRequestTarget(requestTarget: string): boolean {
  const pathname = requestTarget.split(/[?#]/, 1)[0]
  try {
    const decoded = decodeURIComponent(pathname)
    return decoded.includes('\\') || decoded.split('/').includes('..')
  } catch {
    return true
  }
}

export function requestSecurityStatus(failure: RequestSecurityFailure): number {
  if (failure === 'stale-client') {
    return 409
  }
  if (failure === 'session-rejected') {
    return 401
  }
  return 403
}

export function sendBrowserResponse(
  response: ServerResponse,
  statusCode: number,
  body = '',
  contentType = 'text/plain; charset=utf-8'
): void {
  applySecurityHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

export function sendBrowserJson(
  response: ServerResponse,
  statusCode: number,
  value: unknown
): void {
  response.setHeader('Cache-Control', 'no-store')
  sendBrowserResponse(
    response,
    statusCode,
    JSON.stringify(value),
    'application/json; charset=utf-8'
  )
}

export function sendAuthenticationRedirect(response: ServerResponse, sessionCookie: string): void {
  applySecurityHeaders(response)
  response.statusCode = 303
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Location', '/')
  response.setHeader('Set-Cookie', `${sessionCookie}; Path=/; HttpOnly; SameSite=Strict`)
  response.end()
}

export function sendRendererFile(
  response: ServerResponse,
  method: string | undefined,
  filePath: string,
  file: Buffer
): void {
  response.setHeader(
    'Cache-Control',
    isImmutableRendererAsset(filePath) ? 'public, max-age=31536000, immutable' : 'no-store'
  )
  applySecurityHeaders(response)
  response.statusCode = 200
  response.setHeader('Content-Type', mimeType(filePath))
  response.setHeader('Content-Length', method === 'HEAD' ? 0 : file.byteLength)
  response.end(method === 'HEAD' ? undefined : file)
}

export function sendRendererHtml(
  response: ServerResponse,
  method: string | undefined,
  html: string
): void {
  response.setHeader('Cache-Control', 'no-store')
  sendBrowserResponse(response, 200, method === 'HEAD' ? '' : html, 'text/html; charset=utf-8')
}
