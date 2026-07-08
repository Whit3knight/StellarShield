import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { PrivateValue } from "./private-value"

describe("PrivateValue", () => {
  it("renders both the clear value and the privacy mask", () => {
    render(<PrivateValue>GABC...7KQ2</PrivateValue>)

    expect(screen.getByText("GABC...7KQ2")).toBeInTheDocument()
    expect(screen.getByLabelText("Hidden for privacy")).toHaveTextContent(
      "••••••"
    )
  })
})
