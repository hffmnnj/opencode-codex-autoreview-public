import assert from "node:assert/strict";
import { test } from "node:test";
import { Events } from "../src/sse.js";

function parse(chunks: readonly Uint8Array[]): unknown[] {
  const result: unknown[] = [];
  const parser = new Events(4096, (event) => result.push(event));
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const chunk of chunks) parser.push(decoder.decode(chunk, { stream: true }));
  parser.push(decoder.decode());
  parser.end();
  return result;
}

const encode = (text: string) => new TextEncoder().encode(text);

test("valid multiline SSE with UTF-8 and explicit event type is invariant under every split and empty decoded chunks", () => {
  const input = encode('event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":"日本語 🛡️"}\r\n\r\n');
  const expected = [{ type: "response.output_text.delta", delta: "日本語 🛡️" }];
  assert.deepEqual(parse([input]), expected);
  for (let split = 0; split <= input.length; split++) {
    assert.deepEqual(parse([input.slice(0, split), new Uint8Array(), input.slice(split)]), expected, `byte split ${split}`);
  }
  assert.deepEqual(parse(Array.from(input, (byte) => new Uint8Array([byte]))), expected);
});

test("invalid joined JSON cannot become separate valid events when CRLF is split by empty chunks", () => {
  const input = encode('data: {"a":"日本語"}\r\ndata: {"b":2}\r\n\r\n');
  assert.throws(() => parse([input]), SyntaxError);
  for (let split = 0; split <= input.length; split++) {
    assert.throws(() => parse([input.slice(0, split), new Uint8Array(), input.slice(split)]), SyntaxError, `byte split ${split}`);
  }
  assert.throws(() => parse(Array.from(input, (byte) => new Uint8Array([byte]))), SyntaxError);
});

test("an explicit SSE event tag must match the JSON type; bare data frames still work", () => {
  assert.deepEqual(parse([encode('data: {"type":"response.created"}\n\n')]), [{ type: "response.created" }]);
  for (const tag of ["error", "response.failed", "", "response.created\nevent: response.completed"]) {
    assert.throws(() => parse([encode(`event: ${tag}\ndata: {"type":"response.completed"}\n\n`)]), /event/);
  }
  assert.throws(() => parse([encode('event: response.completed\ndata: {"id":"missing-type"}\n\n')]), /event/);
});

test("bare data equals colon-empty data: rejected after DONE, harmless fields stay ignored", () => {
  // Empty data outside DONE is a no-op in both spellings.
  assert.deepEqual(parse([encode("data\n\n")]), []);
  assert.deepEqual(parse([encode("data:\n\n")]), []);
  // After DONE both spellings are trailing data and must fail closed.
  for (const tail of ["data\n\n", "data:\n\n"]) {
    const input = encode(`data: [DONE]\n\n${tail}`);
    assert.throws(() => parse([input]), /after-done/);
    for (let split = 0; split <= input.length; split++) {
      assert.throws(
        () => parse([input.slice(0, split), new Uint8Array(), input.slice(split)]),
        /after-done/,
        `byte split ${split} tail ${JSON.stringify(tail)}`,
      );
    }
  }
  // Comments and unknown SSE fields must not become data after DONE.
  for (const tail of [": keepalive\n\n", "id: 1\n\n", "retry: 10\n\n", "foo: bar\n\n", "datax\n\n"]) {
    assert.deepEqual(parse([encode(`data: [DONE]\n\n${tail}`)]), [], `harmless tail ${JSON.stringify(tail)}`);
  }
});

test("DONE is an untagged terminal marker, not permission to hide trailing or truncated events", () => {
  assert.deepEqual(parse([encode('data: {"type":"response.completed"}\n\ndata: [DONE]\n\n: keepalive\n\n')]), [{ type: "response.completed" }]);
  for (const input of [
    'event: error\ndata: [DONE]\n\n',
    'data: [DONE]\n\ndata: {"type":"response.completed"}\n\n',
    'data: [DONE]\n\ndata: [DONE]\n\n',
    'data: [DONE]\n\ndata:\n\n',
    'data: [DONE]\n',
    'event: error\n\n',
  ]) assert.throws(() => parse([encode(input)]), /event|done|incomplete/);
});
