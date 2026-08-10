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

const rendererMimeTypes = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.avif', 'image/avif'],
  ['.gif', 'image/gif'],
  ['.woff2', 'font/woff2'],
  ['.woff', 'font/woff'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf']
])

function mimeType(filePath: string): string {
  for (const [extension, contentType] of rendererMimeTypes) {
    if (filePath.endsWith(extension)) {
      return contentType
    }
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
  contentType = 'text/plain; charset=utf-8',
  contentLength = Buffer.byteLength(body)
): void {
  applySecurityHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', contentLength)
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
  response.setHeader('Content-Length', file.byteLength)
  response.end(method === 'HEAD' ? undefined : file)
}

export function sendRendererHtml(
  response: ServerResponse,
  method: string | undefined,
  html: string
): void {
  response.setHeader('Cache-Control', 'no-store')
  sendBrowserResponse(
    response,
    200,
    method === 'HEAD' ? '' : html,
    'text/html; charset=utf-8',
    Buffer.byteLength(html)
  )
}
