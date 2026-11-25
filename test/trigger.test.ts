import test from 'node:test'
import assert from 'node:assert/strict'
import { judgeTriggers, tokens, triggerParts } from '../src/lib/trigger.ts'

const SKILLS = [
  {
    name: 'pdf-tools',
    description: 'Use when converting PDF files into text or images. Do not use for editing Word documents.',
  },
  {
    name: 'code-review',
    description: 'Use when reviewing a git diff or pull request. Trigger phrase: code review.',
  },
  {
    name: 'weather',
    description: 'Use when answering questions about the weather forecast.',
  },
  {
    name: 'caveman',
    description: 'Use when the user asks for compressed caveman-style answers.',
  },
]

const CASES = [
  { prompt: 'convert this PDF file to text', expect: 'pdf-tools' },
  { prompt: 'review my pull request', expect: 'code-review' },
  { prompt: 'what is the weather forecast tomorrow', expect: 'weather' },
  { prompt: '请把这段文字压缩成 caveman 风格', expect: 'caveman' },
  { prompt: 'edit this Word document', expect: null },
  { prompt: '2 + 2 equals what', expect: null },
]

test('tokens split Latin words and Chinese bigrams', () => {
  const value = tokens('Use when converting 转换 PDF 文件')
  assert.ok(value.includes('converting'))
  assert.ok(value.includes('pdf'))
  assert.ok(value.includes('转换'))
  assert.ok(value.includes('文件'))
})

test('triggerParts separates use-when and anti-trigger text', () => {
  const parts = triggerParts('Use when converting PDFs. Do not use for editing Word documents. 不适用于纯图片。')
  assert.match(parts.trigger, /converting PDFs/)
  assert.match(parts.anti, /Word documents/)
  assert.match(parts.anti, /纯图片/)
})

test('judgeTriggers reports per-case results and metrics', () => {
  const audit = judgeTriggers(CASES, SKILLS, { threshold: 1 })
  assert.equal(audit.results.length, CASES.length)
  assert.equal(audit.positive, 4)
  assert.equal(audit.negative, 2)
  assert.ok(audit.accuracy > 0.6, 'accuracy ' + audit.accuracy + ': ' + JSON.stringify(audit.results))
  assert.ok(audit.precision === null || audit.precision >= 0)
  assert.ok(audit.recall === null || audit.recall >= 0)
})

test('a positive case fails when the expected skill does not win', () => {
  const audit = judgeTriggers([{ prompt: 'review my pull request', expect: 'pdf-tools' }], SKILLS)
  assert.equal(audit.results[0].pass, false)
  assert.equal(audit.results[0].predicted, 'code-review')
})

test('empty cases produce a zero audit without throwing', () => {
  const audit = judgeTriggers([], SKILLS)
  assert.equal(audit.results.length, 0)
  assert.equal(audit.accuracy, 0)
  assert.equal(audit.precision, null)
  assert.equal(audit.recall, null)
})
