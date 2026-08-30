import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluate } from "../connectors/metrics-http.mjs";

const data = { finance: { stripe: { mrr: 8775 } }, clients: { clients: [{ tickets: [{ late: true }, { late: false }] }, { tickets: [] }] } };

test("dotted path", () => assert.equal(evaluate("finance.stripe.mrr", data), 8775));
test("flatten and count", () => assert.equal(evaluate("clients.clients[].tickets[]|count", data), 2));
test("filter and count", () => assert.equal(evaluate("clients.clients[].tickets[?late]|count", data), 1));
test("missing is undefined", () => assert.equal(evaluate("finance.nope.x", data), undefined));
