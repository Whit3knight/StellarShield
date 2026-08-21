import "@testing-library/jest-dom/vitest"

import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// Testing Library registers its own auto-cleanup only when vitest
// `globals` is enabled, and it is not (vitest.config.ts). Without this,
// a component rendered in one test is still in the document for the
// next one, so `queryByRole` finds the previous test's markup.
afterEach(cleanup)
