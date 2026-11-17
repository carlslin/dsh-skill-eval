import test from 'node:test'
import assert from 'node:assert/strict'
import { checkReferences, referencedPaths } from '../lib/integrity.js'

function fakeStat(existing) {
  return async (path) => {
    if (!existing.includes(path)) throw new Error('ENOENT')
    return { isFile: () => true }
  }
}

test('referenced paths are extracted, deduped and bounded', () => {
  const paths = referencedPaths(
    'run scripts/build.py then read references/forms.md, also see references/forms.md and assets/logo.svg.',
  )
  assert.deepEqual(paths.sort(), ['assets/logo.svg', 'references/forms.md', 'scripts/build.py'])
  assert.equal(referencedPaths('').length, 0)
  assert.equal(referencedPaths('no references here').length, 0)
  assert.equal(referencedPaths('../etc/passwd references/../../x').length, 0)
})

test('missing files are reported, existing ones pass', async () => {
  const content = 'read references/forms.md and run scripts/build.py'
  const ok = await checkReferences({
    baseDir: '/skills/pdf',
    content,
    stat: fakeStat(['/skills/pdf/references/forms.md', '/skills/pdf/scripts/build.py']),
  })
  assert.deepEqual(ok, { checked: 2, missing: [], ok: true })

  const broken = await checkReferences({
    baseDir: '/skills/pdf',
    content,
    stat: fakeStat(['/skills/pdf/references/forms.md']),
  })
  assert.equal(broken.ok, false)
  assert.deepEqual(broken.missing, ['scripts/build.py'])
})

test('no references, no base dir or no fs yields a null/skip result instead of a false pass', async () => {
  assert.deepEqual(await checkReferences({ baseDir: '/x', content: 'plain body', stat: fakeStat([]) }), {
    checked: 0,
    missing: [],
    ok: true,
  })
  assert.equal(await checkReferences({ baseDir: null, content: 'read references/a.md', stat: fakeStat([]) }), null)
  assert.equal(await checkReferences({ baseDir: '/x', content: 'read references/a.md' }), null)
})

test('a broken reference lowers the static score and raises a critical rule', async () => {
  const { buildAdvice } = await import('../lib/advice.js')
  const { staticProfile } = await import('../lib/score.js')
  const summary = {
    name: 'pdf-tools',
    description: 'Use when the user needs to extract or merge PDF files: read page text and reorder pages.',
    whenToUse: 'Any .pdf task.',
    source: 'custom',
    provider: 'filesystem',
  }
  const content = '# PDF\n\n## Steps\n\nRun scripts/missing.py.\n\nSee references/forms.md.\n\n```bash\nx\n```\n'
  const integrity = { checked: 2, missing: ['scripts/missing.py'], ok: false }
  const profile = staticProfile(summary, { content }, { integrity })
  const referenceCheck = profile.checks.find((check) => check.id === 'reference-integrity')
  assert.ok(referenceCheck.fraction < 1)
  const { aggregate } = await import('../lib/score.js')
  const stats = aggregate([
    {
      at: 1,
      ok: true,
      loadMs: 100,
      window: { toolCalls: 3, errors: 0, errorNames: [], corrections: [], otherSkills: [], turnEnded: true },
    },
  ])
  const advice = buildAdvice({ stats, static: profile, score: { total: 50, dimensions: {} }, minSamples: 1 })
  const rule = advice.find((item) => item.id === 'broken-references')
  assert.ok(rule, advice.map((item) => item.id).join(','))
  assert.equal(rule.severity, 'critical')
  assert.match(rule.evidence, /scripts\/missing\.py/)

  // without integrity evidence the check is skipped, not counted as passing
  const noFs = staticProfile(summary, { content })
  const skipped = noFs.checks.find((check) => check.id === 'reference-integrity')
  assert.equal(skipped.skipped, true)
  assert.equal(
    noFs.failedChecks.some((check) => check.id === 'reference-integrity'),
    false,
  )
})
