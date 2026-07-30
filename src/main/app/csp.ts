export const packagedContentSecurityPolicy =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self';"

const viewportMetaTag = '<meta name="viewport" content="width=device-width, initial-scale=1.0" />'

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

export function buildContentSecurityPolicy(options: {
  isPackaged: boolean
  devServer?: string
}): string {
  if (options.isPackaged) {
    return packagedContentSecurityPolicy
  }
  const devOrigin = options.devServer ? new URL(options.devServer).origin : ''
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${devOrigin}`.trim(),
    `style-src 'self' 'unsafe-inline' ${devOrigin}`.trim(),
    "img-src 'self' data:",
    `font-src 'self' ${devOrigin}`.trim(),
    `connect-src 'self' ws: wss: ${devOrigin}`.trim()
  ].join('; ')
}

export function injectContentSecurityPolicyMeta(html: string): string {
  if (html.includes('http-equiv="Content-Security-Policy"')) {
    return html
  }
  if (!html.includes(viewportMetaTag)) {
    throw new Error('Could not inject CSP meta tag: viewport meta tag not found')
  }
  const cspMetaTag = `<meta http-equiv="Content-Security-Policy" content="${escapeHtmlAttribute(
    packagedContentSecurityPolicy
  )}" />`
  return html.replace(viewportMetaTag, `${viewportMetaTag}\n    ${cspMetaTag}`)
}
