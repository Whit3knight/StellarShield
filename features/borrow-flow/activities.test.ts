import { describe, expect, it } from "vitest"

import {
  appendBorrowActivity,
  createBorrowActivity,
} from "./activities"

function makeActivity(seed: string, timestamp: string = "2026-07-09T00:00:00.000Z") {
  return createBorrowActivity({
    description: seed,
    timestamp,
    title: seed,
    type: "proof_generated",
    value: seed,
  })
}

describe("appendBorrowActivity", () => {
  it("prepends new activities", () => {
    const first = makeActivity("first")
    const second = makeActivity("second")

    const list = appendBorrowActivity([first], second)

    expect(list.map((item) => item.title)).toEqual(["second", "first"])
  })

  it("dedupes activities by id", () => {
    const activity = makeActivity("only")

    const first = appendBorrowActivity([], activity)
    const second = appendBorrowActivity(first, activity)

    expect(second).toBe(first)
    expect(second).toHaveLength(1)
  })

  it("caps the activity list at 8 items", () => {
    let list = [] as ReturnType<typeof makeActivity>[]

    for (let index = 0; index < 12; index += 1) {
      list = appendBorrowActivity(list, makeActivity(`item-${index}`))
    }

    expect(list).toHaveLength(8)
    expect(list[0]?.title).toBe("item-11")
    expect(list[list.length - 1]?.title).toBe("item-4")
  })
})
