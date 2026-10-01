const berlin = new Intl.DateTimeFormat("en-GB", {
	timeZone: "Europe/Berlin",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	weekday: "short",
	hour: "2-digit",
	minute: "2-digit",
	hourCycle: "h23",
})

const berlinParts = (date: Date) => Object.fromEntries(berlin.formatToParts(date).map(({ type, value }) => [type, value]))

export const berlinDay = (date: Date) => {
	const parts = berlinParts(date)

	return `${parts.year}-${parts.month}-${parts.day}`
}

export const parseDay = (day: string) => {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		throw new Error(`Invalid date: ${day}. Expected YYYY-MM-DD.`)
	}

	const result = new Date(`${day}T12:00:00Z`)
	if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== day) {
		throw new Error(`Invalid calendar date: ${day}`)
	}

	return result
}

export const defaultDays = (now = new Date()) => {
	const end = berlinDay(now)
	const today = parseDay(end)
	const mondayOffset = (today.getUTCDay() + 6) % 7
	const thursdayTwoWeeksAgo = new Date(today.getTime() + (3 - mondayOffset - 14) * 86_400_000)

	return { start: thursdayTwoWeeksAgo.toISOString().slice(0, 10), end }
}

export const spreadDates = (start: string, end: string, count: number, random = Math.random, now = new Date()) => {
	const first = parseDay(start)
	const last = parseDay(end)
	const days = (last.getTime() - first.getTime()) / 86_400_000

	if (days < 0 || days > 366) {
		throw new Error("End must be on or after start, within a 366-day range.")
	}

	if (!Number.isSafeInteger(count) || count < 1) {
		throw new Error("At least one commit is required.")
	}
	if (end > berlinDay(now)) {
		throw new Error("End date cannot be in the future.")
	}

	const minutes: number[] = []
	for (let time = first.getTime() - 86_400_000; time < last.getTime() + 2 * 86_400_000; time += 60_000) {
		const parts = berlinParts(new Date(time))
		const day = `${parts.year}-${parts.month}-${parts.day}`
		const hour = Number(parts.hour)

		if (day >= start && day <= end && parts.weekday !== "Sat" && parts.weekday !== "Sun" && hour >= 10 && hour < 18 && time <= now.getTime()) {
			minutes.push(time)
		}
	}

	if (count > minutes.length) {
		throw new Error(`Only ${minutes.length} eligible work-hour minutes for ${count} commits. Choose a wider date range.`)
	}

	const spacing = count === 1 ? 0 : (minutes.length - 1) / (count - 1)
	const limit = Math.min(60, spacing * 0.2)

	return Array.from({ length: count }, (_, index) => {
		const target = count === 1 ? minutes.length - 1 : index * spacing
		let jitter = 0

		if (count === 1) {
			jitter = -random() * 60
		} else if (index === 0) {
			jitter = random() * limit
		} else if (index === count - 1) {
			jitter = -random() * limit
		} else {
			jitter = (random() * 2 - 1) * limit
		}

		const minute = minutes[Math.round(target + jitter)]
		if (minute === undefined) throw new Error("No eligible minute for commit.")

		const availableSeconds = Math.min(59, Math.floor((now.getTime() - minute) / 1_000))
		return new Date(minute + Math.floor(random() * (availableSeconds + 1)) * 1_000)
	})
}

export const gitDate = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "+00:00")
