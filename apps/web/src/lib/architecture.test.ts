import assert from "node:assert/strict";
import test from "node:test";

import {
  exportArchitecture,
  importArchitecture,
  restoreArchitecture,
  saveArchitecture,
  starterArchitecture,
  validateArchitecture,
} from "./architecture";

test("risky but interpretable designs remain runnable", () => {
  const architecture = starterArchitecture();
  architecture.nodes.find((node) => node.type === "primary-database")!.config.capacity = 1;

  assert.deepEqual(validateArchitecture(architecture), {
    runnable: true,
    errors: [],
    warnings: [],
  });
});

test("a client without a request path receives an actionable error", () => {
  const architecture = starterArchitecture();
  architecture.edges = [];

  const result = validateArchitecture(architecture);
  assert.equal(result.runnable, false);
  assert.ok(result.errors.some((error) => error.includes("outgoing request path")));
});

test("architecture exports and imports without changing observable content", () => {
  const architecture = starterArchitecture();
  assert.deepEqual(importArchitecture(exportArchitecture(architecture)), architecture);
});

test("invalid imports are rejected", () => {
  assert.throws(() => importArchitecture('{"version":99}'), /ScaleLab architecture/);
  assert.throws(
    () =>
      importArchitecture(
        '{"version":1,"name":"bad","nodes":[{"id":"a","type":"client"}],"edges":[]}',
      ),
    /ScaleLab architecture/,
  );
});

test("save and restore preserves an architecture without replacing invalid saved data", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const architecture = starterArchitecture();
  saveArchitecture(storage, architecture);
  assert.deepEqual(restoreArchitecture(storage), architecture);
  values.set("scalelab:architecture", "not json");
  assert.equal(restoreArchitecture(storage), null);
});
