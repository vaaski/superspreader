# superspreader

Interactive Bun CLI for spreading a branch's commits across Berlin weekday work hours (10:00–18:00). It sets both the Git author and committer dates and preserves commit order. Commit IDs change; file contents do not.

## Install and run

```sh
cd /Users/o/work/superspreader
bun install
bun link
cd /path/to/your/repository
spread
```

`bun link` registers the `spread` command globally through Bun. Make sure `~/.bun/bin` is on your `PATH` (check with `command -v spread`). Or pass a repository path: `spread /path/to/your/repository`. Run `bun unlink` from the superspreader folder to remove the link.

The script requires a clean working tree and an attached branch. It suggests the remote's default branch (for example `origin/main`) as the base; you can choose a different branch or commit. Only commits since its common ancestor with your branch are rewritten. Histories with merge commits in that range are not supported.

You can optionally fetch and rebase onto the base branch before redating. The script creates a uniquely named local `backup/superspreader-…` branch **before** either rebase. If a rebase stops for conflicts, the backup stays available; resolve and use `git rebase --continue`, or use `git rebase --abort`.

The default start is Thursday in the calendar week two weeks before today's date in Berlin; the default end is today in Berlin. Clack's date picker lets you change either date. Eligible times are Monday–Friday, 10:00:00–17:59:59, `Europe/Berlin`, including daylight-saving changes. The range can span up to 366 days. Times are roughly evenly spaced with a small random offset; the first and last commits are near the selected endpoints. A single commit is placed near the end. A range containing no work hours is rejected.

After the rewrite, review the commit log and diff from another terminal. The final prompt lets you keep the backup (the default), restore the original branch from it, or delete the backup after confirmation. Restoration requires a clean working tree and the branch to still point to the rewritten tip. The backup is local only; nothing is pushed.

Run `bun test`, `bunx tsc --noEmit`, and `bun run lint` for checks.
