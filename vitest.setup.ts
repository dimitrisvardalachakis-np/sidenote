/**
 * Test setup for component tests.
 *
 * The /vitest entrypoint registers jest-dom's matchers AND their types, so
 * toHaveFocus and toBeDisabled type-check as well as run. Extending `expect`
 * by hand works at runtime and leaves TypeScript not knowing about any of it.
 *
 * cleanup after each test is explicit because React Testing Library only
 * registers it automatically when vitest runs with globals enabled, and this
 * project does not. Without it every render stacks in the same document and
 * getByLabelText starts finding three of everything.
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(cleanup);
