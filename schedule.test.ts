import { expect, test } from "bun:test"
import { berlinDay, defaultDays, spreadDates } from "./schedule.ts"

test("defaults to Thursday in the calendar week two weeks ago through today in Berlin", () => {
	expect(defaultDays(new Date("2026-09-29T12:00:00Z"))).toEqual({ start: "2026-09-17", end: "2026-09-29" })
	expect(defaultDays(new Date("2026-09-28T22:30:00Z"))).toEqual({ start: "2026-09-17", end: "2026-09-29" })
})

test("dates remain increasing and inside Berlin weekday office hours, including across DST", () => {
	const formatter = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Europe/Berlin",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	})
	const dates = spreadDates("2026-10-22", "2026-11-03", 12, () => 0.7)
	expect(dates).toHaveLength(12)
	expect(berlinDay(dates[0]!)).toBe("2026-10-22")
	expect(berlinDay(dates.at(-1)!)).toBe("2026-11-03")
	for (const [index, date] of dates.entries()) {
		if (index > 0) expect(date.getTime()).toBeGreaterThan(dates[index - 1]!.getTime())
		const parts = Object.fromEntries(formatter.formatToParts(date).map(({ type, value }) => [type, value]))
		expect(["Sat", "Sun"]).not.toContain(parts.weekday)
		expect(Number(parts.hour)).toBeGreaterThanOrEqual(10)
		expect(Number(parts.hour)).toBeLessThan(18)
	}
})

test("single commit falls on last workday and weekends have no eligible dates", () => {
	expect(berlinDay(spreadDates("2026-09-17", "2026-09-29", 1, () => 0)[0]!)).toBe("2026-09-29")
	expect(() => spreadDates("2026-09-19", "2026-09-20", 1)).toThrow("Only 0 eligible")
})

test("invalid date ranges are rejected", () => {
	expect(() => spreadDates("2026-02-30", "2026-03-02", 1)).toThrow("Invalid calendar date")
	expect(() => spreadDates("2026-10-01", "2026-09-29", 1)).toThrow("End must be")
})
