import { expect, test } from "bun:test";
import { dataUri } from "./icons";

test("dataUri base64-encodes the bytes with padding", () => {
  const encode = (text: string) => dataUri(new TextEncoder().encode(text), "image/png");
  expect(encode("Man")).toBe(`data:image/png;base64,${Buffer.from("Man").toString("base64")}`);
  expect(encode("Ma")).toBe("data:image/png;base64,TWE=");
  expect(encode("M")).toBe("data:image/png;base64,TQ==");
  const bytes = Uint8Array.from({ length: 257 }, (_, index) => index % 256);
  expect(dataUri(bytes, "image/png")).toBe(`data:image/png;base64,${Buffer.from(bytes).toString("base64")}`);
});
