#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { confirm, date, intro, isCancel, log, outro, select, text } from "@clack/prompts"
import { defaultDays, gitDate, parseDay, spreadDates } from "./schedule.ts"

type RewriteState = { dates: string[], index: number }

function git(repo: string, args: string[], inherit = false): string {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], {
		stdin: "inherit",
		stdout: inherit ? "inherit" : "pipe",
		stderr: inherit ? "inherit" : "pipe",
	})
	if (result.exitCode !== 0) {
		throw new Error(inherit ? `git ${args[0]} failed (exit ${result.exitCode}).` : result.stderr?.toString().trim() || `git ${args[0]} failed.`)
	}
	return inherit ? "" : result.stdout?.toString().trim() ?? ""
}

function gitTry(repo: string, args: string[]): string | undefined {
	const result = Bun.spawnSync(["git", "-C", repo, ...args], { stdout: "pipe", stderr: "pipe" })
	return result.exitCode === 0 ? result.stdout.toString().trim() : undefined
}

function answer<T>(result: T): Exclude<T, symbol> {
	if (isCancel(result)) {
		log.warning("Cancelled; no further changes made.")
		process.exit(0)
	}
	return result as Exclude<T, symbol>
}

function assertClean(repo: string): void {
	if (git(repo, ["status", "--porcelain"])) {
		throw new Error("Working tree is not clean. Commit or stash changes before running superspreader.")
	}
}

function suggestedBase(repo: string): string {
	for (const remote of git(repo, ["remote"]).split("\n").filter(Boolean)) {
		const ref = gitTry(repo, ["symbolic-ref", "-q", "--short", `refs/remotes/${remote}/HEAD`])
		if (ref) return ref
	}
	for (const ref of ["main", "master"]) {
		if (gitTry(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])) return ref
	}
	return ""
}

function backupName(repo: string, branch: string): string {
	const timestamp = new Date().toISOString().replace(/[-:.]/g, "").replace("T", "-").replace("Z", "")
	const prefix = `backup/superspreader-${branch.replace(/[^\w-]+/g, "-")}-${timestamp}`
	let name = prefix
	for (let suffix = 2; gitTry(repo, ["show-ref", "--verify", `refs/heads/${name}`]) !== undefined; suffix++) {
		name = `${prefix}-${suffix}`
	}
	return name
}

function amendStep(stateFile: string): void {
	const state = JSON.parse(readFileSync(stateFile, "utf8")) as RewriteState
	const date = state.dates[state.index]
	if (!date) throw new Error(`No scheduled date at index ${state.index}. State: ${stateFile}`)
	const result = Bun.spawnSync(["git", "commit", "--amend", "--allow-empty", "--no-edit", "--date", date], {
		env: { ...process.env, GIT_COMMITTER_DATE: date },
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})
	if (result.exitCode !== 0) process.exit(result.exitCode)
	writeFileSync(stateFile, JSON.stringify({ ...state, index: state.index + 1 }))
}

async function main(): Promise<void> {
	const repo = resolve(process.argv[2] ?? process.cwd())
	git(repo, ["rev-parse", "--show-toplevel"])
	assertClean(repo)
	const branch = git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"])
	const original = git(repo, ["rev-parse", "HEAD"])
	const suggested = suggestedBase(repo)
	const defaults = defaultDays()

	intro("superspreader · spread commit dates across Berlin work hours")
	log.info(`Repository: ${repo}\nBranch: ${branch}\nSuggested base: ${suggested || "none detected"}`)
	const base = answer(await text({
		message: "Base branch/ref (commits after the common ancestor are rewritten)",
		initialValue: suggested,
		placeholder: "origin/main",
		validate(value) {
			if (!value?.trim() || value.startsWith("-")) return "Enter a branch or commit ref."
			if (!gitTry(repo, ["rev-parse", "--verify", "--quiet", `${value}^{commit}`])) return "Ref not found locally. Fetch it first."
			if (!gitTry(repo, ["merge-base", "HEAD", value])) return "No common ancestor with the current branch."
		},
	})).trim()

	const shouldRebase = answer(await confirm({
		message: `Fetch (if remote) and rebase ${branch} onto ${base} before spreading dates?`,
		initialValue: false,
	}))
	const start = answer(await date({
		message: "Start date (Berlin calendar; arrow keys edit year/month/day)",
		format: "YMD",
		initialValue: parseDay(defaults.start),
		defaultValue: parseDay(defaults.start),
	})).toISOString().slice(0, 10)
	const end = answer(await date({
		message: "End date (Berlin calendar)",
		format: "YMD",
		initialValue: parseDay(defaults.end),
		defaultValue: parseDay(defaults.end),
		validate(value) {
			if (value && value.toISOString().slice(0, 10) < start) return "End date must be on or after start date."
		},
	})).toISOString().slice(0, 10)

	const fork = git(repo, ["merge-base", "HEAD", base])
	if (git(repo, ["rev-list", "--merges", `${fork}..HEAD`])) {
		throw new Error("The branch contains merge commits after the base. Superspreader currently requires a linear commit history.")
	}
	const count = Number(git(repo, ["rev-list", "--count", `${fork}..HEAD`]))
	if (count === 0) throw new Error("No commits after the base to spread. Choose an earlier base ref.")
	spreadDates(start, end, count)
	log.info(`${count} commits · ${start} → ${end} · weekdays 10:00–18:00 Europe/Berlin`)
	if (!answer(await confirm({ message: "Create a backup and rewrite these commits?", initialValue: false }))) {
		outro("No changes made.")
		return
	}

	assertClean(repo)
	if (git(repo, ["rev-parse", "HEAD"]) !== original) throw new Error("Branch tip changed during prompts; please restart.")
	const backup = backupName(repo, branch)
	git(repo, ["branch", backup, "HEAD"])
	log.success(`Backup: ${backup} (${original.slice(0, 8)})`)

	try {
		if (shouldRebase) {
			const remote = git(repo, ["remote"]).split("\n").find(name => base.startsWith(`${name}/`))
			if (remote) git(repo, ["fetch", remote], true)
			git(repo, ["rebase", base], true)
		}
		const ancestor = git(repo, ["merge-base", "HEAD", base])
		if (git(repo, ["rev-list", "--merges", `${ancestor}..HEAD`])) {
			throw new Error("The resulting history has merge commits; cannot spread dates automatically.")
		}
		const commitCount = Number(git(repo, ["rev-list", "--count", `${ancestor}..HEAD`]))
		if (commitCount === 0) throw new Error("No commits remain after rebasing; backup is retained.")
		const dates = spreadDates(start, end, commitCount).map(gitDate)
		const stateDir = mkdtempSync(join(tmpdir(), "superspreader-"))
		const stateFile = join(stateDir, "state.json")
		writeFileSync(stateFile, JSON.stringify({ dates, index: 0 }))
		const script = resolve(import.meta.dir, "index.ts")
		const execCommand = `bun run '${script.replaceAll("'", "'\\''")}' --amend-step '${stateFile.replaceAll("'", "'\\''")}'`
		try {
			git(repo, ["rebase", "--no-autosquash", "--reapply-cherry-picks", "--empty=keep", "--exec", execCommand, ancestor], true)
			const state = JSON.parse(readFileSync(stateFile, "utf8")) as RewriteState
			if (state.index !== commitCount) throw new Error(`Only ${state.index}/${commitCount} commits were redated; state retained: ${stateFile}`)
			rmSync(stateDir, { recursive: true })
		} catch (error) {
			log.error(`Date-rewrite stopped. State retained at ${stateFile}; backup: ${backup}. Resolve and run git rebase --continue, or git rebase --abort.`)
			throw error
		}
	} catch (error) {
		log.error(`Backup retained: ${backup}`)
		throw error
	}

	const rewrittenTip = git(repo, ["rev-parse", "HEAD"])
	const summary = git(repo, ["log", "--reverse", "--format=%h %aI %s", `${git(repo, ["merge-base", "HEAD", base])}..HEAD`])
	log.success(`Rewritten branch: ${branch}\nBackup: ${backup}`)
	log.info(`Review in another terminal: git -C '${repo}' log --format='%h %aI %s' ${base}..HEAD\nCompare contents: git -C '${repo}' diff ${backup} HEAD`)
	if (summary) log.info(summary)

	const review = answer(await select({
		message: "After reviewing the branch, what would you like to do?",
		options: [
			{ value: "keep", label: "Looks good — keep the backup (recommended)" },
			{ value: "restore", label: "Undo — restore the branch from the backup" },
			{ value: "delete", label: "Looks good — delete the backup branch" },
		],
	}))
	if (review === "restore") {
		assertClean(repo)
		if (git(repo, ["rev-parse", "HEAD"]) !== rewrittenTip || git(repo, ["symbolic-ref", "--short", "HEAD"]) !== branch) {
			throw new Error("Branch changed during review; refusing to restore automatically.")
		}
		if (answer(await confirm({ message: `Reset ${branch} to ${backup}? This discards the rewritten history on this branch.`, initialValue: false }))) {
			git(repo, ["reset", "--hard", backup], true)
			outro(`Restored ${branch} to ${backup}. Backup branch kept.`)
			return
		}
	}
	if (review === "delete") {
		if (answer(await confirm({ message: `Permanently delete local backup ${backup}?`, initialValue: false }))) {
			if (git(repo, ["rev-parse", "HEAD"]) !== rewrittenTip || git(repo, ["symbolic-ref", "--short", "HEAD"]) !== branch) {
				throw new Error("Branch changed during review; refusing to delete the backup.")
			}
			if (git(repo, ["rev-parse", backup]) !== original) throw new Error("Backup moved; refusing to delete it.")
			git(repo, ["branch", "-D", backup], true)
			outro("Review complete; backup deleted.")
			return
		}
	}
	outro(`Backup retained: ${backup}`)
}

if (process.argv[2] === "--help" || process.argv[2] === "-h") {
	console.log("Usage: spread [path-to-git-repository]\nInteractively back up and spread commit dates across Berlin work hours.")
} else if (process.argv[2] === "--amend-step") {
	const stateFile = process.argv[3]
	if (!stateFile) throw new Error("Missing rewrite state file.")
	amendStep(stateFile)
} else {
	try {
		await main()
	} catch (error) {
		log.error(error instanceof Error ? error.message : String(error))
		process.exitCode = 1
	}
}
