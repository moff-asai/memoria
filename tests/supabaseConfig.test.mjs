import assert from "node:assert/strict"
import test from "node:test"
import { requirePublicKey, SUPABASE_PROJECT_REF, SUPABASE_URL } from "../src/supabaseConfig.ts"

const jwt = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`
test("new connection requires a configured public key", () => {
  assert.equal(SUPABASE_URL, "https://niaopqpzpwrfhfwzllzs.supabase.co")
  for (const key of [undefined, "", " ", "garbage", "sb_secret_test"]) assert.throws(() => requirePublicKey(key))
  assert.equal(requirePublicKey(" sb_publishable_example "), "sb_publishable_example")
})
test("legacy credentials must be public anon keys of the selected project", () => {
  const key = jwt({ role: "anon", ref: SUPABASE_PROJECT_REF })
  assert.equal(requirePublicKey(key), key)
  assert.throws(() => requirePublicKey(jwt({ role: "service_role", ref: SUPABASE_PROJECT_REF })))
  assert.throws(() => requirePublicKey(jwt({ role: "anon", ref: "a-different-project" })))
})
