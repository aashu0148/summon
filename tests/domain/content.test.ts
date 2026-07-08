import { test, expect } from "bun:test";
import {
  buildUserContent,
  imageMarker,
  toImageBlock,
  attachmentLabel,
  type ImageAttachment,
  type ImageBlock,
} from "../../src/domain/content.ts";

const att = (over: Partial<ImageAttachment> = {}): ImageAttachment => ({
  id: 1,
  mediaType: "image/png",
  data: "AAAA",
  bytes: 2048,
  ...over,
});

const block = (data = "AAAA"): ImageBlock => ({ type: "image", source: { type: "base64", media_type: "image/png", data } });

test("buildUserContent puts images before the text block", () => {
  const c = buildUserContent("hello", [block("X"), block("Y")]);
  expect(c).toEqual([
    { type: "image", source: { type: "base64", media_type: "image/png", data: "X" } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "Y" } },
    { type: "text", text: "hello" },
  ]);
});

test("buildUserContent omits the text block when text is empty", () => {
  const c = buildUserContent("", [block()]);
  expect(c).toEqual([{ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }]);
});

test("buildUserContent returns [] when there is nothing to send", () => {
  expect(buildUserContent("", [])).toEqual([]);
});

test("buildUserContent text-only has no image blocks", () => {
  expect(buildUserContent("hi")).toEqual([{ type: "text", text: "hi" }]);
});

test("imageMarker / toImageBlock / attachmentLabel formatting", () => {
  expect(imageMarker(3)).toBe("[Image #3]");
  expect(toImageBlock(att({ id: 2, data: "ZZ" }))).toEqual({
    type: "image",
    source: { type: "base64", media_type: "image/png", data: "ZZ" },
  });
  expect(attachmentLabel(att({ id: 1, bytes: 2048 }))).toBe("📎 [Image #1] (2 KB)");
  expect(attachmentLabel(att({ id: 2, bytes: 512 }))).toBe("📎 [Image #2] (512 B)");
});
