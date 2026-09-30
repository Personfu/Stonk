import test from "node:test";
import assert from "node:assert/strict";
import {automationOrderId} from "../api/automation.js";

test("all automated scans in a trading date reserve the same broker order ID",()=>{
  assert.equal(automationOrderId("2026-09-29T13:31:00Z"),"stonk-auto-20260929");
  assert.equal(automationOrderId("2026-09-29T19:58:00Z"),"stonk-auto-20260929");
  assert.equal(automationOrderId("2026-09-30T13:31:00Z"),"stonk-auto-20260930");
});
