import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyText, toHtml, encodeWord, decodeWords } from "../connectors/imap.mjs";

test("bodyText: plain text with quoted-printable", () => {
  const raw = "From: a@b.c\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nTe betalen =E2=82=AC 1.475,-\r\n";
  assert.equal(bodyText(raw).text.trim(), "Te betalen € 1.475,-");
});

test("bodyText: multipart prefers text/plain, lists attachments, falls back to html", () => {
  const raw = ["Content-Type: multipart/mixed; boundary=\"XX\"", "", "--XX", "Content-Type: multipart/alternative; boundary=\"YY\"", "",
    "--YY", "Content-Type: text/plain; charset=utf-8", "", "hello plain", "--YY", "Content-Type: text/html", "", "<p>hello <b>html</b></p>", "--YY--",
    "--XX", "Content-Type: application/pdf; name=\"loon.pdf\"", "Content-Disposition: attachment; filename=\"loon.pdf\"", "", "JVBERi0=", "--XX--", ""].join("\r\n");
  const r = bodyText(raw);
  assert.equal(r.text.trim(), "hello plain");
  assert.deepEqual(r.attachments, ["loon.pdf"]);
  const htmlOnly = "Content-Type: text/html; charset=utf-8\r\n\r\n<div>Hi<br>there &amp; you</div>";
  assert.equal(bodyText(htmlOnly).text, "");
  assert.match(bodyText(htmlOnly).html, /Hi<br>/);
});

test("toHtml: one div per line, blank lines kept, text escaped", () => {
  assert.equal(toHtml("Hi Jane,\n\n<b>not bold</b>"), "<div><div>Hi Jane,</div><div><br></div><div>&lt;b&gt;not bold&lt;/b&gt;</div></div>");
});

test("encodeWord/decodeWords round trip", () => {
  assert.equal(encodeWord("Re: budget"), "Re: budget");
  assert.equal(decodeWords(encodeWord("Re: begroting — opbouw")), "Re: begroting — opbouw");
});
