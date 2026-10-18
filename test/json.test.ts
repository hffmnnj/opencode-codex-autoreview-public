import assert from "node:assert/strict";
import { test } from "node:test";
import { canonical, fingerprint } from "../src/json.js";

test("dense JSON preserves every value and fingerprints objects independently of property order", () => {
  const value = { z: [null, true, false, 3.25, "日本語"], a: { b: 7, a: "distinct" } };
  assert.equal(canonical(value), '{"a":{"a":"distinct","b":7},"z":[null,true,false,3.25,"日本語"]}');
  assert.equal(fingerprint(value), fingerprint({ a: { a: "distinct", b: 7 }, z: [null, true, false, 3.25, "日本語"] }));
  assert.notEqual(fingerprint([]), fingerprint([null]));
  assert.notEqual(fingerprint({ value: "first" }), fingerprint({ value: "second" }));
});

test("null prototypes and JSON __proto__ data keys are preserved without prototype mutation", () => {
  const value: unknown = JSON.parse('{"__proto__":{"safe":true},"constructor":"data"}');
  const nullPrototype: unknown = Object.assign(Object.create(null) as object, value);
  assert.equal(canonical(nullPrototype), '{"__proto__":{"safe":true},"constructor":"data"}');
  assert.equal(fingerprint(value), fingerprint(nullPrototype));
  assert.equal(Object.getPrototypeOf(nullPrototype), null);
  assert.equal(Object.getPrototypeOf({}), Object.prototype);
});

test("non-JSON own properties cannot collide with an otherwise approved fingerprint", () => {
  const sparse: unknown[] = new Array(1);
  const extraArray = Object.assign([], { hiddenAction: "different" });
  const symbolObject = { value: "original", [Symbol("action")]: "different" };
  const hiddenObject = Object.defineProperty({ value: "original" }, "hiddenAction", { value: "different", enumerable: false });
  for (const value of [sparse, extraArray, symbolObject, hiddenObject]) {
    assert.throws(() => fingerprint(value), /non-json|sparse|property|symbol/);
  }
  assert.equal(fingerprint({ value: "original" }), fingerprint({ value: "original" }));
});

test("canonicalization never invokes own accessors while validating binding evidence", () => {
  let calls = 0;
  const object = Object.defineProperty({}, "value", { enumerable: true, get() { calls++; return "changed"; } });
  const array = Object.defineProperty(["original"], "0", { enumerable: true, get() { calls++; return "changed"; } });
  assert.throws(() => fingerprint(object), /property|accessor|non-json/);
  assert.throws(() => fingerprint(array), /property|accessor|non-json/);
  assert.equal(calls, 0);
});

test("proxy inputs are rejected before invoking reflective traps", () => {
  let traps = 0;
  const value = new Proxy({}, { getPrototypeOf() { traps++; return Object.prototype; }, ownKeys() { traps++; return []; } });
  assert.throws(() => fingerprint(value), /non-json/);
  assert.equal(traps, 0);
});

test("cycles, shared references, excessive node count and serialized output are rejected with bounded work", { timeout: 1000 }, () => {
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  let shared: unknown = { leaf: 1 };
  // Small enough that the old exponential implementation fails this assertion quickly, not after a long blow-up.
  for (let depth = 0; depth < 12; depth++) shared = { left: shared, right: shared };
  assert.throws(() => canonical(cycle), /reference|cycle|depth/);
  assert.throws(() => canonical(shared), /reference|budget/);
  assert.throws(() => canonical(Array.from({ length: 20_000 }, () => null)), /budget/);
  assert.throws(() => canonical({ value: "x".repeat(1024 * 1024) }), /budget/);
  assert.throws(() => canonical({ value: "日".repeat(100_000) }), /budget/);
  assert.throws(() => canonical({ value: "\u0000".repeat(50_000) }), /budget/);
  for (const value of [NaN, Infinity, undefined, { value: undefined }]) assert.throws(() => canonical(value), /non-json/);
});

test("negative zero is rejected so signed-zero evidence cannot collide with zero", () => {
  assert.equal(canonical(0), "0");
  assert.equal(canonical({ value: 0 }), '{"value":0}');
  for (const value of [-0, { value: -0 }, [-0]]) assert.throws(() => canonical(value), /non-json/);
  assert.throws(() => fingerprint({ value: -0 }), /non-json/);
  assert.equal(fingerprint({ value: 0 }), fingerprint({ value: 0 }));
});
