import { debug } from '@actions/core'
import { formatDuration, n, upperCaseFirst } from './formatting'
import { icons, renderIcon } from './icons'

interface Report {
	config: {
		configFile: string
		rootDir: string
		fullyParallel: boolean
		globalTimeout: number
		grep: Record<string, unknown>
		grepInvert: null
		maxFailures: number
		metadata: {
			actualWorkers: number
			totalTime: number
		}
		projects: Project[]
		shard: {
			total: number
		}
		version: string
		workers: number
	}
	suites: Suite[]
	errors: any[]
}

interface ReportSummary {
	version: string
	duration: number
	workers: number
	shards: number
	projects: string[]
	files: string[]
	suites: string[]
	specs: SpecSummary[]
	failed: SpecSummary[]
	passed: SpecSummary[]
	flaky: SpecSummary[]
	skipped: SpecSummary[]
}

interface Project {
	id: string
	name: string
}

interface Suite {
	title: string
	file: string
	column: number
	line: number
	specs: Spec[]
	suites: Suite[]
}

interface Spec {
	title: string
	ok: boolean
	tags: string[]
	tests: Test[]
	id: string
	file: string
	line: number
	column: number
}

interface Test {
	timeout: number
	expectedStatus: 'passed' | 'skipped' | 'failed' | 'flaky' | string
	projectId: string
	projectName: string
	results: TestResult[]
	status: 'expected' | 'skipped' | string
}

interface TestResult {
	workerIndex: number
	status: 'passed' | 'failed' | 'skipped' | string
	duration: number
	error?: any
	errors: any[]
	retry: number
	startTime: string
}

interface SpecSummary {
	passed: boolean
	failed: boolean
	flaky: boolean
	skipped: boolean
	title: string
	path: string[]
	line: number
	column: number
}

interface ReportRenderOptions {
	commit?: string
	message?: string
	title?: string
	reportUrl?: string
	iconStyle?: keyof typeof icons
}

function isValidReport(report: unknown): report is Report {
	return (
		typeof report === 'object' &&
		report !== null &&
		'config' in report &&
		'suites' in report
	)
}

export function parseReport(data: string): ReportSummary {
	const report: Report = JSON.parse(data)
	if (!isValidReport(report)) {
		debug('Invalid report file')
		debug(data)
		throw new Error('Invalid report file')
	}

	const version: string = report.config.version
	const duration: number = report.config.metadata.totalTime || 0
	const workers: number =
		report.config.metadata.actualWorkers || report.config.workers || 1
	const shards: number = report.config.shard?.total || 0
	const projects: string[] = report.config.projects.map(
		(project) => project.name
	)

	const files: string[] = report.suites.map((file) => file.title)
	const suites: string[] = report.suites.flatMap((file) =>
		file.suites.length
			? [...file.suites.map((suite) => `${file.title} > ${suite.title}`)]
			: [file.title]
	)
	const specs: SpecSummary[] = report.suites.reduce((all, file) => {
		for (const spec of file.specs) {
			all.push(parseSpec(spec, [file]))
		}
		for (const suite of file.suites) {
			for (const spec of suite.specs) {
				all.push(parseSpec(spec, [file, suite]))
			}
		}
		return all
	}, [] as SpecSummary[])
	const failed = specs.filter((spec) => spec.failed)
	const passed = specs.filter((spec) => spec.passed)
	const flaky = specs.filter((spec) => spec.flaky)
	const skipped = specs.filter((spec) => spec.skipped)

	return {
		version,
		duration,
		workers,
		shards,
		projects,
		files,
		suites,
		specs,
		failed,
		passed,
		flaky,
		skipped
	}
}

function parseSpec(spec: Spec, parents: Suite[] = []): SpecSummary {
	const { ok, line, column } = spec
	const test = spec.tests[0]
	const status = test.status
	const project = test.projectName

	const path = [project, ...parents.map((p) => p.title), spec.title].filter(
		Boolean
	)
	const title = path.join(' → ')

	const flaky = status === 'flaky'
	const skipped = status === 'skipped'
	const failed = !ok || status === 'unexpected'
	const passed = ok && !skipped && !failed
	return { passed, failed, flaky, skipped, title, path, line, column }
}

export function renderReportSummary(
	report: ReportSummary,
	{ commit, message, title, reportUrl, iconStyle }: ReportRenderOptions = {}
): string {
	const { duration, failed, passed, flaky, skipped } = report
	const icon = (symbol: string): string => renderIcon(symbol, { iconStyle })
	const paragraphs = []

	// Title

	paragraphs.push(`### ${title}`)

	// Passed/failed tests

	const tests = [
		failed.length ? `${icon('failed')}  **${failed.length} failed**` : ``,
		passed.length ? `${icon('passed')}  **${passed.length} passed**  ` : ``,
		flaky.length ? `${icon('flaky')}  **${flaky.length} flaky**  ` : ``,
		skipped.length ? `${icon('skipped')}  **${skipped.length} skipped**` : ``
	]
	paragraphs.push(tests.filter(Boolean).join('  \n'))

	// Stats about test run

	paragraphs.push(`#### Details`)

	const stats = [
		reportUrl ? `${icon('report')}  [Open report ↗︎](${reportUrl})` : '',
		`${icon('stats')}  ${report.specs.length} ${n(
			'test',
			report.specs.length
		)} across ${report.suites.length} ${n('suite', report.suites.length)}`,
		`${icon('duration')}  ${formatDuration(duration)}`,
		commit && message
			? `${icon('commit')}  ${message} (${commit.slice(0, 7)})`
			: '',
		commit && !message ? `${icon('commit')}  ${commit.slice(0, 7)}` : ''
	]
	paragraphs.push(stats.filter(Boolean).join('  \n'))

	// Lists of failed/skipped tests

	const listStatuses = ['failed', 'flaky', 'skipped'] as const
	const details = listStatuses.map((status) => {
		const tests = report[status]
		if (tests.length) {
			return `
				<details ${status === 'failed' ? 'open' : ''}>
					<summary><strong>${upperCaseFirst(status)} tests</strong></summary>
					<ul>${tests.map((test) => `<li>${test.title}</li>`).join('\n')}</ul>
				</details>`
		}
	})
	paragraphs.push(
		details
			.filter(Boolean)
			.map((md) => (md as string).trim())
			.join('\n')
	)

	return paragraphs
		.map((p) => p.trim())
		.filter(Boolean)
		.join('\n\n')
}
