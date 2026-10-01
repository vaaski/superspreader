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

	const dates = spreadDates("2026-10-22", "2026-11-03", 12, () => 0.7, new Date("2026-11-04T00:00:00Z"))
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
	const now = new Date("2026-09-30T00:00:00Z")
	expect(berlinDay(spreadDates("2026-09-17", "2026-09-29", 1, () => 0, now)[0]!)).toBe("2026-09-29")
	expect(() => spreadDates("2026-09-19", "2026-09-20", 1, Math.random, now)).toThrow("Only 0 eligible")
})

test("today's commits never land later than now, including seconds in the current minute", () => {
	const now = new Date("2026-09-29T11:25:17.500Z")
	let calls = 0
	const random = () => ++calls === 1 ? 0 : 0.999
	const [date] = spreadDates("2026-09-29", "2026-09-29", 1, random, now)

	expect(date).toBeDefined()
	expect(date!.getTime()).toBeLessThanOrEqual(now.getTime())
	expect(berlinDay(date!)).toBe("2026-09-29")
})

test("future end dates and work hours that have not started yet are rejected", () => {
	const now = new Date("2026-09-29T07:59:00Z")
	expect(() => spreadDates("2026-09-29", "2026-09-30", 1, Math.random, now)).toThrow("in the future")
	expect(() => spreadDates("2026-09-29", "2026-09-29", 1, Math.random, now)).toThrow("Only 0 eligible")
})

test("invalid date ranges are rejected", () => {
	expect(() => spreadDates("2026-02-30", "2026-03-02", 1)).toThrow("Invalid calendar date")
	expect(() => spreadDates("2026-10-01", "2026-09-29", 1)).toThrow("End must be")
})
