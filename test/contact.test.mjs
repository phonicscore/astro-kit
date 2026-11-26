/**
 * Tests for the contact form's cleanup of stored submissions
 * (contactCleanup in worker/contact.ts).
 *
 *   npm test
 *
 * Node runs them alone and reads the TypeScript file as it is (Node 22.18 or
 * newer). The D1 database is a stand-in over Node's own SQLite (node:sqlite),
 * in memory, built from worker/schema.sql, so the cleanup's SQL runs as D1
 * would run it.
 *
 * They hold the cleanup to its rule: a submission's IP address goes after a
 * day and the submission after 30 days, newer rows stay as they are, each
 * step runs even when the other one fails, and the one log line holds counts,
 * never an address or a message.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, test } from 'node:test';
import { contactCleanup } from '../worker/contact.ts';

const SCHEMA = readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8');

/** D1's prepare/bind/first/run over a node:sqlite database. */
function d1(db) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              return db.prepare(sql).get(...values) ?? null;
            },
            async run() {
              const r = db.prepare(sql).run(...values);
              return { success: true, meta: { changes: Number(r.changes) } };
            },
          };
        },
      };
    },
  };
}

let db;
let logs;
let errors;
const realLog = console.log;
const realError = console.error;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  logs = [];
  errors = [];
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  db.close();
});

/** A stored submission, `age` as an SQLite modifier ('-2 days'); returns its id. */
function store(age, ip, message = 'Hello') {
  const r = db
    .prepare(
      `INSERT INTO contact_submissions (created_at, first_name, last_name, email, message, ip, user_agent)
       VALUES (datetime('now', ?1), 'Ada', 'Lovelace', 'ada@example.com', ?2, ?3, 'Test/1.0')`
    )
    .run(age, message, ip);
  return Number(r.lastInsertRowid);
}

const row = (id) => db.prepare('SELECT id, ip, message FROM contact_submissions WHERE id = ?1').get(id);

test('removes IP addresses older than a day and deletes submissions older than 30 days', async () => {
  const fresh = store('-1 hours', '192.0.2.1');
  const twoDays = store('-2 days', '192.0.2.2');
  const old = store('-31 days', '192.0.2.3');
  const nearlyOld = store('-29 days', null);

  await contactCleanup({ DB: d1(db) });

  assert.equal(row(fresh).ip, '192.0.2.1', 'an IP address younger than a day stays');
  assert.equal(row(twoDays).ip, null, 'an IP address older than a day goes');
  assert.equal(row(twoDays).message, 'Hello', 'the message itself stays for 30 days');
  assert.equal(row(old), undefined, 'a submission older than 30 days is deleted');
  assert.ok(row(nearlyOld), 'a submission younger than 30 days stays');
  assert.deepEqual(logs, [
    'contact-cleanup: 2 IP addresses removed (older than 24 h); 1 submissions deleted (older than 30 days)',
  ]);
  assert.deepEqual(errors, []);
});

test('a run with nothing to clean says so with zero counts', async () => {
  store('-1 hours', '192.0.2.1');
  await contactCleanup({ DB: d1(db) });
  assert.deepEqual(logs, [
    'contact-cleanup: 0 IP addresses removed (older than 24 h); 0 submissions deleted (older than 30 days)',
  ]);
});

test('the log line holds counts, never an address or a message', async () => {
  store('-2 days', '198.51.100.7', 'Please call me on +43 1 234 567');
  store('-40 days', '198.51.100.8', 'Another private message');
  await contactCleanup({ DB: d1(db) });
  const all = [...logs, ...errors].join('\n');
  assert.doesNotMatch(all, /198\.51\.100|ada@example\.com|private|\+43/);
});

test('custom periods, and 0 keeps that step off', async () => {
  const sixHours = store('-6 hours', '192.0.2.1');
  const eightDays = store('-8 days', '192.0.2.2');

  await contactCleanup({ DB: d1(db) }, { ipAfterHours: 0, deleteAfterDays: 7 });
  assert.equal(row(sixHours).ip, '192.0.2.1', 'ipAfterHours 0 keeps IP addresses');
  assert.equal(row(eightDays), undefined, 'deleteAfterDays 7 deletes an 8-day-old submission');
  assert.deepEqual(logs, ['contact-cleanup: 1 submissions deleted (older than 7 days)']);

  logs.length = 0;
  await contactCleanup({ DB: d1(db) }, { ipAfterHours: 4, deleteAfterDays: 0 });
  assert.equal(row(sixHours).ip, null, 'ipAfterHours 4 removes a 6-hour-old IP address');
  assert.deepEqual(logs, ['contact-cleanup: 1 IP addresses removed (older than 4 h)']);

  logs.length = 0;
  await contactCleanup({ DB: d1(db) }, { ipAfterHours: 0, deleteAfterDays: 0 });
  assert.deepEqual(logs, ['contact-cleanup: both steps off']);
});

test('without a DB binding it says so and returns', async () => {
  await contactCleanup({});
  assert.deepEqual(logs, ['contact-cleanup: no DB binding, nothing stored']);
  assert.deepEqual(errors, []);
});

test('a failing step is logged, the other step still runs, and nothing throws', async () => {
  const old = store('-31 days', '192.0.2.3');
  const real = d1(db);
  const flaky = {
    prepare(sql) {
      if (sql.startsWith('UPDATE')) throw new Error('D1 is down for this one');
      return real.prepare(sql);
    },
  };

  await contactCleanup({ DB: flaky });

  assert.equal(row(old), undefined, 'the deletion still ran');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^contact-cleanup: removing IP addresses failed/);
  assert.deepEqual(logs, [
    'contact-cleanup: removing IP addresses failed; 1 submissions deleted (older than 30 days)',
  ]);
});

test('a D1 result without meta counts as zero rows', async () => {
  const bare = { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({}) }) }) };
  await contactCleanup({ DB: bare });
  assert.deepEqual(logs, [
    'contact-cleanup: 0 IP addresses removed (older than 24 h); 0 submissions deleted (older than 30 days)',
  ]);
});
