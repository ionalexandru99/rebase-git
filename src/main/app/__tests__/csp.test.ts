import { describe, expect, it } from 'vitest'
import {
  buildContentSecurityPolicy,
  injectContentSecurityPolicyMeta,
  packagedContentSecurityPolicy
} from '../csp'

describe('content security policy', () => {
  it('builds the packaged policy without inline scripts', () => {
    const policy = buildContentSecurityPolicy({ isPackaged: true })

    expect(policy).toBe(packagedContentSecurityPolicy)
    expect(policy).toContain("script-src 'self'")
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'")
  })

  it('builds the dev policy with the dev server origin and HMR allowances', () => {
    const policy = buildContentSecurityPolicy({
      isPackaged: false,
      devServer: 'http://localhost:5173/some/path'
    })

    expect(policy).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173"
    )
    expect(policy).toContain("connect-src 'self' ws: wss: http://localhost:5173")
  })

  it('injects the packaged CSP meta tag after the viewport meta tag', () => {
    const html = [
      '<!doctype html>',
      '<html>',
      '  <head>',
      '    <meta charset="UTF-8" />',
      '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '  </head>',
      '</html>'
    ].join('\n')

    const transformed = injectContentSecurityPolicyMeta(html)

    expect(transformed).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${packagedContentSecurityPolicy}" />`
    )
    expect(transformed.indexOf('name="viewport"')).toBeLessThan(
      transformed.indexOf('http-equiv="Content-Security-Policy"')
    )
  })

  it('does not inject a duplicate CSP meta tag', () => {
    const html = `<meta http-equiv="Content-Security-Policy" content="${packagedContentSecurityPolicy}" />`

    expect(injectContentSecurityPolicyMeta(html)).toBe(html)
  })
})
