import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asUser, createTestDatabase } from "./harness";

const ALICE = "a0000000-0000-0000-0000-000000000001";
const BOB = "a0000000-0000-0000-0000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = await createTestDatabase();
  await db.query("insert into auth.users (id, email) values ($1, 'alice@kuun.test'), ($2, 'bob@kuun.test')", [ALICE, BOB]);
  await db.query("insert into storage.objects (bucket_id, name, owner) values ('upload-staging', $1, $2)", [`${BOB}/x/bob.pdf`, BOB]);
});

const stage = (tx: PGlite, name: string) => tx.query("insert into storage.objects (bucket_id, name) values ('upload-staging', $1)", [name]);

describe("staged uploads", () => {
  it("can be written by a staff member under their own folder", async () => {
    await asUser(db, ALICE, (tx) => stage(tx, `${ALICE}/abc/kyc.pdf`));
  });

  it("can't be written into someone else's folder or the bucket root", async () => {
    await expect(asUser(db, ALICE, (tx) => stage(tx, `${BOB}/abc/kyc.pdf`))).rejects.toThrow(/row-level security/);
    await expect(asUser(db, ALICE, (tx) => stage(tx, "kyc.pdf"))).rejects.toThrow(/row-level security/);
  });

  it("can't be read or removed by anyone else", async () => {
    const read = await asUser(db, ALICE, (tx) => tx.query("select name from storage.objects where bucket_id = 'upload-staging'"));
    expect(read.rows).toEqual([]);
    const removed = await asUser(db, ALICE, (tx) => tx.query("delete from storage.objects where bucket_id = 'upload-staging'"));
    expect(removed.affectedRows).toBe(0);
  });

  it("are read and removed by their owner", async () => {
    const res = await asUser(db, BOB, async (tx) => {
      const read = await tx.query("select name from storage.objects where bucket_id = 'upload-staging'");
      const removed = await tx.query("delete from storage.objects where bucket_id = 'upload-staging'");
      return { read: read.rows.length, removed: removed.affectedRows };
    });
    expect(res).toEqual({ read: 1, removed: 1 });
  });
});
