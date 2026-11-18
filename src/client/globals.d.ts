// The loader evaluates the concatenated parts inside
// `window.__ModuleLoader__.load({ factory(require) { … } })`. `types: node` is
// only there so the shared host report type resolves; it also types that
// factory `require`, which 01-runtime narrows to React explicitly.

interface Window {
  __SEV_ENABLE_POPUP__?: boolean
}

type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T

/** The report JSON, possibly from an older host generation: every field may be missing. */
type ReportData = DeepPartial<import('../lib/report.ts').Report> & {
  /** `diagnosticsPayload()` in src/index.ts. */
  dev?: {
    moduleVersion?: string | null
    diskVersion?: string | null
    skew?: boolean
    routes?: number
    tools?: number
    inspectProvider?: boolean
    settingsFile?: string | null
    warnings?: number
  }
  pages?: { board?: string; config?: string }
}

/** The DSH client context handed to `apply`; DSH ships no client typings. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ClientCtx = any

interface LocaleService {
  subscribe?(onChange: () => void): () => void
  getSnapshot?(): { active?: unknown } | null
}

type ReactNode = import('react').ReactNode

type ReportView = 'skills' | 'steps' | 'runs' | 'mcp' | 'dev'

interface AppState {
  open: boolean
  view: ReportView
  loading: boolean
  error: string | null
  data: ReportData | null
  fetchedAt: number
  stepFilter?: string
}

type Advice = import('../lib/types.ts').Advice
type Severity = import('../lib/types.ts').Severity
type SkillData = NonNullable<ReportData['skills']>[number]

type SettingsFieldData = import('../lib/settings.ts').SettingsField & { labelZh?: string; value?: unknown }

interface SettingsPayload {
  fields?: SettingsFieldData[]
  values?: Record<string, unknown>
  version?: string | null
}

type StepData = NonNullable<ReportData['steps']>[number]
type StepTurnData = NonNullable<ReportData['stepTurns']>[number] & { steps: StepData[] }
