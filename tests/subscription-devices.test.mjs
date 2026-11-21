import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { countSubscriptionDevice, db, digest, profileRow, summary } from "../worker/profile-store.mjs";

test("subscription device count is opt-in, per-scheme, authorized and cumulative", () => {
  const data = mkdtempSync(path.join(tmpdir(), "poe2-device-test-"));
  const previousData = process.env.DATA_DIR;
  process.env.DATA_DIR = data;
  const store = db();
  try {
    const token = digest("old key");
    const newToken = digest("rotated key");
    const device = randomUUID();
    for (const id of ["scheme", "other"]) {
      store.prepare(`INSERT INTO profiles(id,owner,name,config,enabled,token_hash,updated)
        VALUES (?, 'owner', 'Scheme', '{}', 1, ?, '')`).run(id, token);
    }
    const count = (id = "scheme") => summary(profileRow(id, "owner")).subscriberCount;
    assert.equal(count(), 0);
    countSubscriptionDevice("scheme", token, null);
    countSubscriptionDevice("scheme", token, "invalid");
    countSubscriptionDevice("scheme", "wrong token", device);
    assert.equal(count(), 0);
    countSubscriptionDevice("scheme", token, device);
    countSubscriptionDevice("scheme", token, device.toUpperCase());
    countSubscriptionDevice("other", token, device);
    assert.equal(count(), 1);
    assert.equal(count("other"), 1);
    const storedIds = store.prepare("SELECT device_hash FROM subscription_devices").all().map(row => row.device_hash);
    assert.equal(new Set(storedIds).size, 2);
    assert.ok(storedIds.every(hash => /^[a-f0-9]{64}$/.test(hash)));
    store.prepare("UPDATE profiles SET enabled=0 WHERE id='scheme'").run();
    countSubscriptionDevice("scheme", token, randomUUID());
    assert.equal(count(), 1);
    store.prepare("UPDATE profiles SET enabled=1, token_hash=? WHERE id='scheme'").run(newToken);
    countSubscriptionDevice("scheme", token, randomUUID());
    countSubscriptionDevice("scheme", newToken, device);
    assert.equal(count(), 1);
    countSubscriptionDevice("scheme", newToken, randomUUID());
    assert.equal(count(), 2);
  } finally {
    store.close();
    if (previousData === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousData;
    rmSync(data, { recursive: true, force: true });
  }
});
