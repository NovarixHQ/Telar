import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inlineLocalImages } from "./local-images";

const MIB = 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const pngData = `data:image/png;base64,${PNG.toString("base64")}`;

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "telar-local-images-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function write(name: string, data: Buffer | string): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, data);
  return file;
}

function sparseImage(name: string, bytes: number): string {
  const file = write(name, PNG);
  fs.truncateSync(file, bytes);
  return file;
}

describe("inlineLocalImages", () => {
  test("inlines an absolute path in src, a quoted or bare url(), and a JS string", async () => {
    const shot = write("shot.png", PNG);
    const html = `<img src="${shot}"><div style="background:url(${shot})"></div><style>a{background:url('${shot}')}</style><script>img.src = \`${shot}\`;</script>`;
    const page = await inlineLocalImages(html);
    expect(page.missing).toEqual([]);
    expect(page.html).toBe(`<img src="${pngData}"><div style="background:url(${pngData})"></div><style>a{background:url('${pngData}')}</style><script>img.src = \`${pngData}\`;</script>`);
  });

  test("leaves URLs, data: URLs and relative paths alone", async () => {
    const html = `<img src="https://example.com/a.png"><img src="//cdn.example.com/a.png"><img src="shot.png"><img src="${pngData}">`;
    expect(await inlineLocalImages(html)).toEqual({ html, missing: [] });
  });

  test("an image file is judged by its bytes, so a secret named .png stays out and is reported missing", async () => {
    const secret = write("key.png", "-----BEGIN PRIVATE KEY-----");
    const absent = path.join(dir, "absent.png");
    const html = `<img src="${secret}"><img src="${absent}">`;
    expect(await inlineLocalImages(html)).toEqual({ html, missing: [secret, absent] });
  });

  test("an svg is recognised by its root element after a prolog and doctype", async () => {
    const icon = write("icon.svg", `<?xml version="1.0"?><!-- c --><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>`);
    const page = await inlineLocalImages(`<img src="${icon}">`);
    expect(page.missing).toEqual([]);
    expect(page.html).toStartWith('<img src="data:image/svg+xml;base64,');
  });

  test("refuses an image over 10 MiB", async () => {
    const big = sparseImage("big.png", 10 * MIB + 1);
    await expect(inlineLocalImages(`<img src="${big}">`)).rejects.toThrow("each local image must be at most 10.0 MiB");
  });

  test("refuses a page whose inlined images pass 25 MiB", async () => {
    const files = ["a.png", "b.png", "c.png"].map((name) => sparseImage(name, 7 * MIB));
    await expect(inlineLocalImages(files.map((file) => `<img src="${file}">`).join(""))).rejects.toThrow("the limit is 25.0 MiB");
  });
});
