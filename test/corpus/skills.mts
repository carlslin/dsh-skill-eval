/**
 * Test corpus modelled on the pattern classes in the Anthropic skills repo
 * (document skills that delegate, MCP-dependent skills, weak-trigger skills,
 * anti-trigger skills, overlong single files). Each case records what the
 * evaluator is expected to say about it, so behaviour on every pattern is
 * pinned by a test rather than by memory.
 */

const LONG_BODY = Array.from({ length: 1200 }, (_, i) => `line ${i} of an overlong single-file body`).join('\n')

export const CORPUS = [
  {
    id: 'reference-heavy',
    pattern: 'document-skill style: short body, real references/ and scripts/ pointers',
    skill: {
      name: 'docx-report',
      description:
        'Use when the user needs a Word report generated from data: build headings, tables and charts, then validate the output file.',
      whenToUse: 'Any task whose output is a .docx report.',
      source: 'custom',
      provider: 'filesystem',
    },
    content: `# Word reports

## Steps
1. Read the input data.
2. Run \`scripts/build_report.py\` with the data path.
3. Validate the result with \`references/validation.md\`.

\`\`\`bash
python scripts/build_report.py data.csv
\`\`\`

See references/formatting.md for the style rules.
`,
    expect: { minScore: 80, failedCheckIds: [] },
  },
  {
    id: 'mcp-dependent',
    pattern: 'skill whose body depends on MCP tools (context7/fetch)',
    skill: {
      name: 'api-lookup',
      description:
        'Use when the user asks for current framework API details: resolve the library, fetch the docs, then answer with citations.',
      whenToUse: 'Framework or SDK API questions.',
      source: 'custom',
      provider: 'filesystem',
    },
    content: `# API lookup

## Steps
1. Call \`mcp__context7__resolve-library-id\` with the library name.
2. Call \`mcp__context7__query-docs\` for the exact API.
3. Cite the returned URL.

\`\`\`text
query-docs -> libraryId
\`\`\`
`,
    expect: { minScore: 70, failedCheckIds: [] },
  },
  {
    id: 'negative-trigger',
    pattern: 'anti-trigger skill: says when NOT to use it (no static check reads this yet)',
    skill: {
      name: 'release-notes',
      description:
        'Use when the user needs release notes drafted from commits — not for writing commit messages themselves.',
      whenToUse: 'Release drafting only.',
      source: 'custom',
      provider: 'filesystem',
    },
    content: `# Release notes

## When to use
Use for release drafts. Do not use for changelog taxonomy debates.

## Steps
1. Read the commit range.
2. Group changes.
3. Write the draft.

\`\`\`bash
git log --oneline v1.0.0..HEAD
\`\`\`
`,
    expect: { minScore: 70, failedCheckIds: [] },
    knownGap: 'no static check reads anti-trigger language; only runtime sibling collisions catch it',
  },
  {
    id: 'overlong-mono',
    pattern: 'overlong single file with everything inline (the pattern document skills avoid)',
    skill: {
      name: 'monolith',
      description:
        'Use when the user asks for the monolithic everything-in-one-file workflow that keeps no separate references.',
      whenToUse: 'Monolith tasks.',
      source: 'custom',
      provider: 'filesystem',
    },
    content: `# Monolith\n\n## Everything\n\n${LONG_BODY}\n`,
    expect: { maxScore: 85, failedCheckIds: ['body-compact'] },
  },
  {
    id: 'weak-trigger',
    pattern: 'weak description that never says when to use the skill',
    skill: {
      name: 'helper',
      description: 'helps with stuff',
      whenToUse: '',
      source: 'custom',
      provider: 'filesystem',
    },
    content: `# Helper\n\n## Steps\n1. Do the thing.\n`,
    expect: { maxScore: 60, failedCheckIds: ['desc-length', 'desc-trigger'] },
  },
]
