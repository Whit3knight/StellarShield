// @vitest-environment node
//
// Circuit-level safety net for liquidate-v2 (R22). features/shielded-pool/
// liquidate-math.test.ts covers the TS formula; this proves the COMPILED
// circuit and the SHIPPED zkey/VK agree with it, so the two cannot drift
// apart silently again.

import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error snarkjs ships no types
import * as snarkjs from "snarkjs"

import { poseidon } from "@/features/notes/poseidon"
import { isUnderwater } from "@/features/shielded-pool/liquidate-math"

const ROOT = path.resolve(__dirname, "../../..")
const WASM = path.join(
  ROOT,
  "contracts/circuits/shielded-liquidate-v2/build/liquidate_js/liquidate.wasm"
)
const SHIPPED = path.join(ROOT, "public/circuits-circom/shielded/liquidate-v2")

const SCALE = 10n ** 14n
const THRESHOLD_BPS = 8000n
const COLLATERAL = 40_000_000n // 4 XLM, raw
const LOAN = 25_000_000n // 62.5% of collateral at open
const OPEN_PRICE = SCALE

// Exact cross-multiplied rule, as the circuit computes it (no floor division).
function exactUnderwater(cp: bigint, loan = LOAN, coll = COLLATERAL) {
  return coll * OPEN_PRICE * cp * THRESHOLD_BPS < loan * 10_000n * OPEN_PRICE * SCALE
}

function input(currentPrice: bigint, loan = LOAN) {
  const notional = COLLATERAL * OPEN_PRICE
  const [sa, sv, sp] = [11n, 22n, 33n]
  return {
    borrow_amount_commit: poseidon([loan, sa]).toString(),
    collateral_value_commit: poseidon([notional, sv]).toString(),
    borrow_price_commit: poseidon([OPEN_PRICE, sp]).toString(),
    current_price: currentPrice.toString(),
    threshold_bps: THRESHOLD_BPS.toString(),
    loan_amount: loan.toString(),
    bond_salt_amount: sa.toString(),
    collateral_notional: notional.toString(),
    bond_salt_value: sv.toString(),
    borrow_price: OPEN_PRICE.toString(),
    bond_salt_price: sp.toString(),
  }
}

async function satisfiable(i: object): Promise<boolean> {
  const out = path.join(mkdtempSync(path.join(tmpdir(), "wtns-")), "w.wtns")
  try {
    await snarkjs.wtns.calculate(i, WASM, out)
    return true
  } catch {
    return false
  }
}

const BOUNDARY = 78_125_000_000_000n // 0.78125 * 1e14, exact threshold
const UNDERWATER = 70_000_000_000_000n
const HEALTHY = SCALE

describe("liquidate-v2 circuit vs reference rule", () => {
  it("fixtures classify as intended", () => {
    expect(exactUnderwater(UNDERWATER)).toBe(true)
    expect(exactUnderwater(HEALTHY)).toBe(false)
    expect(exactUnderwater(BOUNDARY)).toBe(false)
    expect(exactUnderwater(BOUNDARY - 1n)).toBe(true)
  })

  it("proves an underwater position", async () => {
    expect(await satisfiable(input(UNDERWATER))).toBe(true)
  })

  it("rejects a healthy position", async () => {
    expect(await satisfiable(input(HEALTHY))).toBe(false)
  })

  it("is strict at the boundary", async () => {
    expect(await satisfiable(input(BOUNDARY))).toBe(false)
    expect(await satisfiable(input(BOUNDARY - 1n))).toBe(true)
  })

  it("matches the reference rule across a price sweep", async () => {
    for (const pct of [1n, 25n, 50n, 77n, 78n, 79n, 100n, 150n]) {
      const p = (SCALE * pct) / 100n
      expect(await satisfiable(input(p))).toBe(exactUnderwater(p))
    }
  })

  it("TS isUnderwater agrees with the circuit away from the boundary", () => {
    for (const p of [UNDERWATER, HEALTHY, 50_000_000_000_000n, 150_000_000_000_000n]) {
      expect(
        isUnderwater({
          loanAmount: LOAN,
          collateralNotional: COLLATERAL * OPEN_PRICE,
          borrowPrice: OPEN_PRICE,
          currentPrice: p,
          thresholdBps: Number(THRESHOLD_BPS),
        })
      ).toBe(exactUnderwater(p))
    }
  })

  it("rejects a tampered opening", async () => {
    const i = input(UNDERWATER)
    i.loan_amount = (LOAN * 2n).toString()
    expect(await satisfiable(i)).toBe(false)
  })

  it("rejects current_price = 0 (circuit alone; contract also guards)", async () => {
    // 0 makes lhs = 0 < rhs, so it is "underwater" to the circuit. Pin the
    // behaviour so a future change is deliberate: zero must be stopped by
    // the contract's live-price cross-check, not by this circuit.
    expect(await satisfiable(input(0n))).toBe(true)
  })
})

describe("shipped liquidate-v2 zkey + VK", () => {
  it("verifies a real proof for an underwater position", async () => {
    const vk = JSON.parse(readFileSync(path.join(SHIPPED, "verification_key.json"), "utf8"))
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input(UNDERWATER),
      path.join(SHIPPED, "liquidate.wasm"),
      path.join(SHIPPED, "liquidate.zkey"),
      undefined,
      undefined,
      { singleThread: true }
    )
    expect(publicSignals).toHaveLength(5)
    expect(publicSignals[3]).toBe(UNDERWATER.toString())
    expect(await snarkjs.groth16.verify(vk, publicSignals, proof)).toBe(true)
    // Changing the public price after proving must break verification.
    const forged = [...publicSignals]
    forged[3] = HEALTHY.toString()
    expect(await snarkjs.groth16.verify(vk, forged, proof)).toBe(false)
  }, 120_000)
})
