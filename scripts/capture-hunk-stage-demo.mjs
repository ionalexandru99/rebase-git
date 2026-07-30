import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(currentDir, '..')
const targetFile = 'src/sidecar/operations/working-tree.ts'
const suite = 'src/sidecar/operations/__tests__/hunk-untracked.integration.test.ts'

const width = 1280
const height = 720
const fps = 10

function distill(output) {
  const kept = []
  let causes = 0
  for (const raw of output.split('\n')) {
    const plain = raw
      .replace(/\u001b\[[0-9;]*m/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!plain) {
      continue
    }
    if (/_tag: 'HunkNotFound'/.test(plain)) {
      causes++
      continue
    }
    if (/^FAIL /.test(plain)) {
      continue
    }
    if (/^[×✓] /.test(plain) || /^(Test Files|Tests) /.test(plain)) {
      kept.push(plain.replace(/ \d+ms$/, ''))
    }
  }
  if (causes > 0) {
    kept.push(`\u2192 every failure: { _tag: 'HunkNotFound' }  (x${causes})`)
  }
  return kept
}

function runSuite(label) {
  console.log(`running ${label}…`)
  const result = spawnSync(
    'node_modules/.bin/vitest',
    ['run', '--config', 'vitest.sidecar.config.ts', suite],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, CI: '1' } }
  )
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

const PAGE = (before, after) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0d1117; color: #c9d1d9;
         font: 15px/1.55 ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  .wrap { padding: 26px 34px; }
  .title { font-size: 19px; font-weight: 600; color: #e6edf3; margin-bottom: 4px; }
  .sub { color: #8b949e; margin-bottom: 22px; }
  .band { display: inline-block; padding: 4px 12px; border-radius: 6px;
          font-weight: 700; letter-spacing: .04em; margin: 14px 0 10px; }
  .before .band { background: #4d1f24; color: #ff9492; }
  .after  .band { background: #143d2b; color: #56d364; }
  .cmd { color: #8b949e; margin-bottom: 6px; }
  .cmd b { color: #79c0ff; font-weight: 600; }
  pre { margin: 0; white-space: pre-wrap; }
  .l { opacity: 0; }
  .l.on { opacity: 1; }
  .fail { color: #ff7b72; }
  .pass { color: #56d364; }
  .dim  { color: #8b949e; }
</style></head><body><div class="wrap">
  <div class="title">Staging a hunk of an untracked file</div>
  <div class="sub">rebase-git · sidecar integration suite · same tests, two implementations</div>
  <div class="before" id="before">
    <div class="band">BEFORE — main</div>
    <div class="cmd">$ <b>pnpm vitest run</b> hunk-untracked.integration.test.ts</div>
    <pre id="beforeOut"></pre>
  </div>
  <div class="after" id="after" style="display:none">
    <div class="band">AFTER — this PR</div>
    <div class="cmd">$ <b>pnpm vitest run</b> hunk-untracked.integration.test.ts</div>
    <pre id="afterOut"></pre>
  </div>
</div>
<script>
  window.__before = ${JSON.stringify(before)};
  window.__after = ${JSON.stringify(after)};
  window.__classify = (line) =>
    line.startsWith('×') || /failed|HunkNotFound/.test(line) ? 'fail'
      : line.startsWith('✓') || /passed/.test(line) ? 'pass' : 'dim';
  window.__render = (id, lines) => {
    const host = document.getElementById(id);
    host.innerHTML = lines
      .map((line, index) => '<div class="l ' + window.__classify(line) + '" data-i="' + index + '">' + line.replace(/</g, '&lt;') + '</div>')
      .join('');
  };
  window.__reveal = (id, index) => {
    const line = document.querySelector('#' + id + ' [data-i="' + index + '"]');
    if (line) { line.classList.add('on'); }
  };
  window.__showAfter = () => { document.getElementById('after').style.display = 'block'; };
</script></body></html>`

async function main() {
  const outputDir = process.argv[2]
  const beforeRef = process.argv[3] ?? 'HEAD~1'
  if (!outputDir) {
    console.error('usage: node scripts/capture-hunk-stage-demo.mjs <output-dir> [before-ref]')
    process.exit(1)
  }
  fs.rmSync(outputDir, { recursive: true, force: true })
  fs.mkdirSync(outputDir, { recursive: true })

  const absoluteTarget = path.join(repoRoot, targetFile)
  const afterSource = fs.readFileSync(absoluteTarget, 'utf8')
  const beforeSource = execFileSync('git', ['show', `${beforeRef}:${targetFile}`], {
    cwd: repoRoot,
    encoding: 'utf8'
  })

  let beforeRaw
  let afterRaw
  try {
    fs.writeFileSync(absoluteTarget, beforeSource)
    beforeRaw = runSuite('before')
  } finally {
    fs.writeFileSync(absoluteTarget, afterSource)
  }
  afterRaw = runSuite('after')

  fs.writeFileSync(path.join(outputDir, 'before.log'), beforeRaw)
  fs.writeFileSync(path.join(outputDir, 'after.log'), afterRaw)
  const before = distill(beforeRaw)
  const after = distill(afterRaw)
  if (before.length === 0 || after.length === 0) {
    console.error('no distilled output — the suite did not run as expected')
    process.exit(1)
  }
  if (!before.some((line) => /failed/.test(line))) {
    console.error('the "before" run did not fail — refusing to record a misleading clip')
    process.exit(1)
  }

  const pagePath = path.join(outputDir, 'demo.html')
  fs.writeFileSync(pagePath, PAGE(before, after))

  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: outputDir, size: { width, height } }
  })
  const page = await context.newPage()
  await page.goto(`file://${pagePath}`)

  await page.evaluate(() => {
    window.__render('beforeOut', window.__before)
    window.__render('afterOut', window.__after)
  })
  await page.waitForTimeout(2200)

  for (let index = 0; index < before.length; index++) {
    await page.evaluate((i) => window.__reveal('beforeOut', i), index)
    await page.waitForTimeout(320)
  }
  await page.waitForTimeout(3200)

  await page.evaluate(() => window.__showAfter())
  await page.waitForTimeout(1200)
  for (let index = 0; index < after.length; index++) {
    await page.evaluate((i) => window.__reveal('afterOut', i), index)
    await page.waitForTimeout(320)
  }
  await page.waitForTimeout(4000)

  const video = page.video()
  const webmPath = path.join(outputDir, 'hunk-stage.webm')
  await page.close()
  await context.close()
  await video?.saveAs(webmPath)
  await video?.delete()
  await browser.close()

  const ffmpeg = (args) => execFileSync('ffmpeg', ['-y', ...args], { stdio: 'ignore' })
  const mp4Path = path.join(outputDir, 'hunk-stage.mp4')
  const gifPath = path.join(outputDir, 'hunk-stage.gif')
  const palette = path.join(outputDir, 'palette.png')
  const filters = `fps=${fps},scale=960:-1:flags=lanczos`
  ffmpeg(['-i', webmPath, '-c:v', 'libopenh264', '-b:v', '2M', '-pix_fmt', 'yuv420p', mp4Path])
  ffmpeg(['-i', webmPath, '-vf', `${filters},palettegen=stats_mode=diff`, palette])
  ffmpeg([
    '-i',
    webmPath,
    '-i',
    palette,
    '-lavfi',
    `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
    gifPath
  ])

  console.log(`webm → ${webmPath}`)
  console.log(`mp4  → ${mp4Path}`)
  console.log(`gif  → ${gifPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
