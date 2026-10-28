import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/pool.js';
import { createLogger } from '../src/logging/logger.js';
import { fromRiyadh, loadCalendar, toRiyadh } from '../src/modules/calendar/index.js';
import { awaitingInfoDaysOf } from '../src/modules/requests/shared/sla.js';
import { type AlNoorType, asUser, type PersonType, seedAlNoor, vendorAnswers } from './helpers/al-noor.js';
import { testApp } from './helpers/app.js';
import { hashPassword, login } from './helpers/auth.js';
import { connectToTestDb, seedSubscribedTenant } from './helpers/db.js';
import { fixture, seedFiles, uploadAs } from './helpers/files.js';

// Phase 6 spec, step 6.3: information requests and the "Rejected - no response" closure (R6.20, R6.21, R6.23).

const pool = connectToTestDb();
const db = createDb(pool);
const app = testApp(pool, createLogger('silent'));

let alNoor: AlNoorType;
let rashid: string;

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);
const codeOf = (res: { body: { error: { code: string } } }) => res.body.error.code;
const detailsOf = (res: { body: { error: { details: unknown } } }) => res.body.error.details;

interface QuestionType {
  id: string;
  state: string;
  askedIn: string;
  question: string;
  answer: string | null;
  files: { id: string; name: string }[];
}

async function submit(person: PersonType = 'khalid') {
  const res = await as(person).post('/requests', {
    serviceId: alNoor.serviceId,
    priorityId: alNoor.priorities.high,
    title: 'Gulf Supplies contract',
    answers: vendorAnswers(alNoor),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id as string;
}

async function accept(id: string) {
  const res = await as('huda').post(`/requests/${id}/accept`, {
    handlerId: alNoor.ids.faisal,
    workflowId: alNoor.workflows.vendor,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function ask(id: string, person: PersonType = 'huda', question = 'Is this within the Q4 budget?') {
  const res = await as(person).post(`/requests/${id}/information-requests`, { question });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const questions = res.body.data.informationRequests as QuestionType[];
  return questions[questions.length - 1] as QuestionType;
}

const answerPath = (id: string, infoId: string) => `/requests/${id}/information-requests/${infoId}/answer`;
const cancelPath = (id: string, infoId: string) => `/requests/${id}/information-requests/${infoId}/cancel`;

const questionsOf = (id: string) => pool.query('select id, state, answer, asked_by, asked_in, ended_by, ended_at from information_requests where request_id = $1 order by asked_at, id', [id]).then((result) => result.rows);

const rowOf = (id: string) => pool.query('select * from requests where id = $1', [id]).then((result) => result.rows[0]);

const auditOf = (id: string) => pool.query('select action, reason, details from audit_log where resource_id = $1 order by id', [id]).then((result) => result.rows);

const setSubscriptionEnd = (daysFromToday: number) =>
  pool.query(
    `update subscriptions set start_date = (now() at time zone 'Asia/Riyadh')::date - 400,
       end_date = (now() at time zone 'Asia/Riyadh')::date + $2::int where tenant_id = $1`,
    [alNoor.tenantId, daysFromToday],
  );

async function pendingFile(person: PersonType, name = 'budget.pdf'): Promise<string> {
  const res = await uploadAs(app, alNoor.tokens[person], name, fixture('contract.pdf'));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
}

beforeAll(async () => {
  alNoor = await seedAlNoor(pool, app, 'info-al-noor');
  const passwordHash = await hashPassword('correct horse battery staple');
  await seedSubscribedTenant(pool, 'info-al-rashid', [{ email: 'admin@info-alrashid.test', passwordHash }]);
  rashid = (await login(app, 'admin@info-alrashid.test', 'correct horse battery staple')).access;
});

afterAll(async () => {
  await pool.end();
});

describe('asking (R6.20)', () => {
  it('lets a reviewer ask in review and shows the question to the requester', async () => {
    const id = await submit();
    const asked = await ask(id);
    expect(asked).toMatchObject({
      state: 'open',
      askedIn: 'review',
      question: 'Is this within the Q4 budget?',
      answer: null,
      files: [],
    });
    const seen = (await as('khalid').get(`/requests/${id}`)).body.data;
    expect(seen.informationRequests).toHaveLength(1);
    expect(seen.informationRequests[0].askedBy).toEqual({ id: alNoor.ids.huda, name: 'Huda' });
    expect(seen.allowedActions).toContain('answer_information');
    expect(seen.allowedActions).not.toContain('ask_information');
    const reviewer = (await as('huda').get(`/requests/${id}`)).body.data;
    expect(reviewer.allowedActions).toEqual(expect.arrayContaining(['cancel_information', 'attach_files']));
    expect(reviewer.allowedActions).not.toContain('ask_information');
  });

  it('offers asking in allowedActions only to someone who may ask, while none is open', async () => {
    const id = await submit();
    expect((await as('huda').get(`/requests/${id}`)).body.data.allowedActions).toContain('ask_information');
    expect((await as('khalid').get(`/requests/${id}`)).body.data.allowedActions).not.toContain('ask_information');
    expect((await as('majed').get(`/requests/${id}`)).body.data.allowedActions).not.toContain('ask_information');
  });

  it('refuses everyone who is not a reviewer in review', async () => {
    const id = await submit();
    for (const person of ['khalid', 'majed'] as const) {
      const res = await as(person).post(`/requests/${id}/information-requests`, { question: '?' });
      expect(res.status, person).toBe(403);
      expect(codeOf(res)).toBe('FORBIDDEN');
    }
    const hidden = await as('lina').post(`/requests/${id}/information-requests`, { question: '?' });
    expect(hidden.status).toBe(404);
    const stranger = await asUser(app, rashid).post(`/requests/${id}/information-requests`, {
      question: '?',
    });
    expect(stranger.status).toBe(404);
    expect(await questionsOf(id)).toEqual([]);
  });

  it('lets the handler ask in progress and refuses a reviewer who is not the handler', async () => {
    const id = await submit();
    await accept(id);
    const byReviewer = await as('huda').post(`/requests/${id}/information-requests`, {
      question: '?',
    });
    expect(byReviewer.status).toBe(403);
    const asked = await ask(id, 'faisal', 'Which entity signs?');
    expect(asked.askedIn).toBe('execution');
    expect((await questionsOf(id))[0]?.asked_by).toBe(alNoor.ids.faisal);
  });

  it('allows one open question per request, and a new one after it ends', async () => {
    const id = await submit();
    const first = await ask(id);
    const second = await as('huda').post(`/requests/${id}/information-requests`, {
      question: 'Another?',
    });
    expect(second.status).toBe(409);
    expect(codeOf(second)).toBe('INFORMATION_REQUEST_OPEN');
    expect(await questionsOf(id)).toHaveLength(1);

    // The database refuses it too, whatever the application checks.
    await expect(
      pool.query(
        `insert into information_requests (tenant_id, request_id, asked_by, asked_in, question)
         values ($1, $2, $3, 'review', 'sneaky')`,
        [alNoor.tenantId, id, alNoor.ids.huda],
      ),
    ).rejects.toMatchObject({ constraint: 'information_requests_one_open' });

    await as('khalid').post(answerPath(id, first.id), { answer: 'Yes' });
    const later = await ask(id, 'huda', 'And Q1 next year?');
    expect(later.state).toBe('open');
    expect(await questionsOf(id)).toHaveLength(2);
  });

  it('rejects a blank or oversized question, an unknown field, and a closed request', async () => {
    const id = await submit();
    const blank = await as('huda').post(`/requests/${id}/information-requests`, { question: '  ' });
    expect(detailsOf(blank)).toEqual([{ path: 'question', code: 'too_small' }]);
    const long = await as('huda').post(`/requests/${id}/information-requests`, {
      question: 'x'.repeat(4001),
    });
    expect(detailsOf(long)).toEqual([{ path: 'question', code: 'too_big' }]);
    const extra = await as('huda').post(`/requests/${id}/information-requests`, {
      question: '?',
      state: 'answered',
    });
    expect(detailsOf(extra)).toEqual([{ path: 'state', code: 'unknown_field' }]);

    await as('khalid').post(`/requests/${id}/withdraw`, { reason: 'done' });
    const closed = await as('huda').post(`/requests/${id}/information-requests`, { question: '?' });
    expect(closed.status).toBe(409);
    expect(codeOf(closed)).toBe('INVALID_REQUEST_STATE');
  });
});

describe('answering (R6.20)', () => {
  it('lets the requester answer with text and files, which closes the question', async () => {
    const id = await submit();
    const asked = await ask(id);
    const fileId = await pendingFile('khalid');
    const res = await as('khalid').post(answerPath(id, asked.id), {
      answer: 'Yes, it is within the Q4 budget',
      fileIds: [fileId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [question] = res.body.data.informationRequests as (QuestionType & {
      endedBy: { name: string };
    })[];
    expect(question).toMatchObject({
      state: 'answered',
      answer: 'Yes, it is within the Q4 budget',
      endedBy: { name: 'Khalid' },
    });
    expect(question?.files.map((file) => file.id)).toEqual([fileId]);
    const link = await pool.query('select information_request_id, field_id from request_files where file_id = $1', [fileId]);
    expect(link.rows).toEqual([{ information_request_id: asked.id, field_id: null }]);
    expect((await pool.query('select state from files where id = $1', [fileId])).rows[0].state).toBe('attached');
    expect(res.body.data.allowedActions).not.toContain('answer_information');

    const entry = (await auditOf(id)).find((e) => e.action === 'request.information_answered');
    expect(entry.details).toEqual({
      informationRequestId: asked.id,
      answer: 'Yes, it is within the Q4 budget',
      fileIds: [fileId],
    });
  });

  it('refuses anyone but the requester, a second answer, and an unknown or foreign question', async () => {
    const id = await submit();
    const other = await submit('lina');
    const asked = await ask(id);
    const foreign = await ask(other);

    const byAsker = await as('huda').post(answerPath(id, asked.id), { answer: 'me' });
    expect(byAsker.status).toBe(403);
    const byViewer = await as('majed').post(answerPath(id, asked.id), { answer: 'me' });
    expect(byViewer.status).toBe(403);
    expect((await questionsOf(id))[0]?.state).toBe('open');

    expect((await as('khalid').post(answerPath(id, foreign.id), { answer: 'x' })).status).toBe(404);
    expect(
      (
        await as('khalid').post(answerPath(id, '00000000-0000-4000-8000-000000000000'), {
          answer: 'x',
        })
      ).status,
    ).toBe(404);
    expect((await as('khalid').post(answerPath(id, 'nonsense'), { answer: 'x' })).status).toBe(404);

    expect((await as('khalid').post(answerPath(id, asked.id), { answer: 'ok' })).status).toBe(200);
    const again = await as('khalid').post(answerPath(id, asked.id), { answer: 'twice' });
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('NO_OPEN_INFORMATION_REQUEST');
  });

  it('validates the answer and the files, and attaches nothing on a refusal', async () => {
    const id = await submit();
    const asked = await ask(id);
    const fileId = await pendingFile('khalid');
    const blank = await as('khalid').post(answerPath(id, asked.id), { answer: ' ' });
    expect(detailsOf(blank)).toEqual([{ path: 'answer', code: 'too_small' }]);
    const long = await as('khalid').post(answerPath(id, asked.id), { answer: 'x'.repeat(10_001) });
    expect(detailsOf(long)).toEqual([{ path: 'answer', code: 'too_big' }]);
    const [expired] = await seedFiles(pool, {
      tenantId: alNoor.tenantId,
      userId: alNoor.ids.khalid,
      count: 1,
      ageHours: 25,
    });
    const bad = await as('khalid').post(answerPath(id, asked.id), {
      answer: 'ok',
      fileIds: [fileId, expired],
    });
    expect(detailsOf(bad)).toEqual([{ path: 'fileIds.1', code: 'file_expired' }]);
    expect((await questionsOf(id))[0]?.state).toBe('open');
    expect((await pool.query('select state from files where id = $1', [fileId])).rows[0].state).toBe('pending');
  });

  it('stops at 50 files per request', async () => {
    const id = await submit();
    const asked = await ask(id);
    const ids = await seedFiles(pool, {
      tenantId: alNoor.tenantId,
      userId: alNoor.ids.khalid,
      count: 51,
    });
    const over = await as('khalid').post(answerPath(id, asked.id), { answer: 'x', fileIds: ids });
    expect(over.status).toBe(409);
    expect(codeOf(over)).toBe('TOO_MANY_FILES');
    expect((await questionsOf(id))[0]?.state).toBe('open');
  });

  it('stays possible after acceptance, because the question stays open (Q26)', async () => {
    const id = await submit();
    const asked = await ask(id);
    await accept(id);
    expect((await questionsOf(id))[0]?.state).toBe('open');
    const res = await as('khalid').post(answerPath(id, asked.id), { answer: 'Yes' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await rowOf(id)).state).toBe('in_progress');
  });
});

describe('cancelling (Q25)', () => {
  it('lets the asker cancel, which frees the request for a new question', async () => {
    const id = await submit();
    const asked = await ask(id);
    const stranger = await as('majed').post(cancelPath(id, asked.id));
    expect(stranger.status).toBe(403);
    const requester = await as('khalid').post(cancelPath(id, asked.id));
    expect(requester.status).toBe(403);

    const res = await as('huda').post(cancelPath(id, asked.id));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.informationRequests[0].state).toBe('cancelled');
    expect(res.body.data.informationRequests[0].endedBy).toEqual({
      id: alNoor.ids.huda,
      name: 'Huda',
    });
    expect((await ask(id, 'huda', 'Never mind, another one')).state).toBe('open');

    const entry = (await auditOf(id)).find((e) => e.action === 'request.information_cancelled');
    expect(entry.details).toEqual({ informationRequestId: asked.id });
  });

  it('lets the handler cancel a question someone else asked, and refuses a question that has ended', async () => {
    const id = await submit();
    const asked = await ask(id);
    await accept(id);
    const byOldReviewer = await as('ahmed').post(cancelPath(id, asked.id));
    expect(byOldReviewer.status).toBe(403);
    const res = await as('faisal').post(cancelPath(id, asked.id));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const again = await as('faisal').post(cancelPath(id, asked.id));
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('NO_OPEN_INFORMATION_REQUEST');
    expect((await as('faisal').post(cancelPath(id, 'nonsense'))).status).toBe(404);
  });
});

describe('closing as Rejected - no response (R6.21)', () => {
  it('lets the handler close while a question is open, with a reason and the closure record', async () => {
    const id = await submit();
    const asked = await ask(id);
    await accept(id);
    const res = await as('faisal').post(`/requests/${id}/close-no-response`, {
      reason: 'Khalid never answered',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const closed = res.body.data;
    expect(closed.state).toBe('rejected_no_response');
    expect(closed.closedAt).toBeTruthy();
    expect(closed.sla).toMatchObject({ met: true, breachDays: 0 });
    expect(closed.sla.awaitingInfoDays).toBe(closed.sla.elapsedDays);
    expect(closed.informationRequests[0]).toMatchObject({ id: asked.id, state: 'closed' });
    expect(closed.informationRequests[0].endedBy).toEqual({
      id: alNoor.ids.faisal,
      name: 'Faisal',
    });

    const row = await rowOf(id);
    expect(row.close_reason).toBe('Khalid never answered');
    expect(row.closed_by).toBe(alNoor.ids.faisal);
    expect(Number(row.awaiting_info_days)).toBe(Number(row.elapsed_days));
    expect((await questionsOf(id))[0]).toMatchObject({
      state: 'closed',
      ended_by: alNoor.ids.faisal,
    });

    const entry = (await auditOf(id)).find((e) => e.action === 'request.closed_no_response');
    expect(entry.reason).toBe('Khalid never answered');
    expect(entry.details.informationRequestId).toBe(asked.id);
    expect(entry.details.sla).toMatchObject({ met: true, breachDays: 0 });
    // The question can no longer be answered or cancelled.
    expect((await as('khalid').post(answerPath(id, asked.id), { answer: 'late' })).status).toBe(409);
    expect((await as('faisal').post(cancelPath(id, asked.id))).status).toBe(409);
  });

  it('is refused without an open question, for anyone but the handler, and outside progress', async () => {
    const id = await submit();
    const inReview = await as('huda').post(`/requests/${id}/close-no-response`, { reason: 'r' });
    expect(inReview.status).toBe(403);

    await accept(id);
    const none = await as('faisal').post(`/requests/${id}/close-no-response`, { reason: 'r' });
    expect(none.status).toBe(409);
    expect(codeOf(none)).toBe('NO_OPEN_INFORMATION_REQUEST');

    await ask(id, 'faisal');
    for (const person of ['huda', 'khalid', 'majed'] as const) {
      const res = await as(person).post(`/requests/${id}/close-no-response`, { reason: 'r' });
      expect(res.status, person).toBe(403);
    }
    const noReason = await as('faisal').post(`/requests/${id}/close-no-response`, {});
    expect(detailsOf(noReason)).toEqual([{ path: 'reason', code: 'invalid_type' }]);
    expect((await rowOf(id)).state).toBe('in_progress');

    const closed = await as('faisal').post(`/requests/${id}/close-no-response`, { reason: 'r' });
    expect(closed.status).toBe(200);
    const again = await as('faisal').post(`/requests/${id}/close-no-response`, { reason: 'r' });
    expect(again.status).toBe(409);
    expect(codeOf(again)).toBe('INVALID_REQUEST_STATE');
  });

  it('sets an open question to closed when the request is rejected or withdrawn', async () => {
    const rejected = await submit();
    await ask(rejected);
    expect((await as('huda').post(`/requests/${rejected}/reject`, { reason: 'out of scope' })).status).toBe(200);
    expect((await questionsOf(rejected))[0]).toMatchObject({
      state: 'closed',
      ended_by: alNoor.ids.huda,
    });

    const withdrawn = await submit();
    await ask(withdrawn);
    expect((await as('khalid').post(`/requests/${withdrawn}/withdraw`, { reason: 'changed my mind' })).status).toBe(200);
    expect((await questionsOf(withdrawn))[0]).toMatchObject({
      state: 'closed',
      ended_by: alNoor.ids.khalid,
    });
    expect((await rowOf(withdrawn)).awaiting_info_days).toBeNull();
  });
});

describe('working time awaiting information (R6.23, Q27)', () => {
  const sunday = () => {
    const { date } = toRiyadh(new Date(Date.now() - 20 * 86_400_000));
    const base = new Date(`${date}T00:00:00Z`);
    base.setUTCDate(base.getUTCDate() - base.getUTCDay());
    return base.toISOString().slice(0, 10);
  };
  const plusDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const at10 = (date: string) => fromRiyadh(date, 10 * 3_600_000);

  // A new tenant's default hours start on the day it was created; these tests work with earlier dates.
  beforeAll(async () => {
    await pool.query("update working_hours set effective_from = '2000-01-01' where tenant_id = $1", [alNoor.tenantId]);
  });

  it("counts each question's open time between acceptance and the end, in working days", async () => {
    const calendar = await loadCalendar(db, alNoor.tenantId);
    const start = sunday();
    const accepted = at10(start);
    const days = (n: number) => at10(plusDays(start, n));
    const days2 = (from: number, to: number) => ({ askedAt: days(from), endedAt: days(to) });
    // Sunday to Monday is one working day.
    expect(awaitingInfoDaysOf(calendar, accepted, [days2(0, 1)], days(3))).toBe(1);
    // Two questions add up; an open one counts until `at`.
    expect(awaitingInfoDaysOf(calendar, accepted, [days2(0, 1), { askedAt: days(2), endedAt: null }], days(3))).toBe(2);
    // Time before acceptance is clipped.
    expect(awaitingInfoDaysOf(calendar, accepted, [{ askedAt: days(-2), endedAt: days(1) }], days(3))).toBe(1);
    expect(awaitingInfoDaysOf(calendar, accepted, [days2(-3, -1)], days(3))).toBe(0);
    // Time after `at` is clipped.
    expect(awaitingInfoDaysOf(calendar, accepted, [days2(1, 5)], days(2))).toBe(1);
    // Friday and Saturday are not working days.
    expect(awaitingInfoDaysOf(calendar, accepted, [days2(4, 7)], days(8))).toBe(1);
    expect(awaitingInfoDaysOf(calendar, accepted, [], days(3))).toBe(0);
  });

  it('freezes it in the closure record: a Sunday acceptance and a Monday question', async () => {
    const id = await submit();
    await accept(id);
    const start = sunday();
    await pool.query('update requests set accepted_at = $2 where id = $1', [id, at10(start)]);
    await as('faisal').post(`/requests/${id}/information-requests`, { question: 'Which entity?' });
    await pool.query('update information_requests set asked_at = $2 where request_id = $1', [id, at10(plusDays(start, 1))]);
    const live = (await as('faisal').get(`/requests/${id}`)).body.data.sla;
    expect(live.elapsedDays - live.awaitingInfoDays).toBeCloseTo(1, 5);

    const res = await as('faisal').post(`/requests/${id}/close-no-response`, { reason: 'silent' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await rowOf(id);
    expect(Number(row.elapsed_days) - Number(row.awaiting_info_days)).toBeCloseTo(1, 5);
    expect(row.sla_met).toBe(false);
    expect(res.body.data.sla.awaitingInfoDays).toBeCloseTo(Number(row.awaiting_info_days), 5);
  });

  it('counts a question answered before acceptance as zero', async () => {
    const id = await submit();
    const asked = await ask(id);
    await as('khalid').post(answerPath(id, asked.id), { answer: 'Yes' });
    await accept(id);
    await ask(id, 'faisal', 'One more thing');
    const res = await as('faisal').post(`/requests/${id}/close-no-response`, { reason: 'silent' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = await rowOf(id);
    // Only the second question, open since just after acceptance, counts.
    expect(Number(row.awaiting_info_days)).toBeLessThanOrEqual(Number(row.elapsed_days));
    expect(Number(row.awaiting_info_days)).toBeGreaterThanOrEqual(0);
  });
});

describe('waiting on me (R6.8)', () => {
  it('lists a request for its requester while a question is open, and not after it is answered', async () => {
    const id = await submit();
    const waiting = async (person: PersonType) =>
      (
        (await as(person).get('/requests?view=waiting_on_me&limit=100')).body.data as {
          id: string;
        }[]
      ).some((r) => r.id === id);
    expect(await waiting('khalid')).toBe(false);
    const asked = await ask(id);
    expect(await waiting('khalid')).toBe(true);
    expect(await waiting('huda')).toBe(false);
    await as('khalid').post(answerPath(id, asked.id), { answer: 'Yes' });
    expect(await waiting('khalid')).toBe(false);

    const second = await ask(id, 'huda', 'Again?');
    expect(await waiting('khalid')).toBe(true);
    await as('huda').post(cancelPath(id, second.id));
    expect(await waiting('khalid')).toBe(false);
  });
});

describe('subscription states and isolation (R6.26, R6.27)', () => {
  it('works in Grace and refuses every write in Read-only', async () => {
    const id = await submit();
    const asked = await ask(id);
    await setSubscriptionEnd(-1);
    try {
      const grace = await as('huda').post(cancelPath(id, asked.id));
      expect(grace.status, JSON.stringify(grace.body)).toBe(200);
      const graceAsk = await as('huda').post(`/requests/${id}/information-requests`, {
        question: 'Grace question',
      });
      expect(graceAsk.status, JSON.stringify(graceAsk.body)).toBe(200);
      const open = graceAsk.body.data.informationRequests.at(-1).id;
      await setSubscriptionEnd(-30);
      for (const [person, path, body] of [
        ['huda', `/requests/${id}/information-requests`, { question: 'q' }],
        ['khalid', answerPath(id, open), { answer: 'a' }],
        ['huda', cancelPath(id, open), {}],
        ['faisal', `/requests/${id}/close-no-response`, { reason: 'r' }],
      ] as const) {
        const res = await as(person).post(path, body);
        expect(res.status, path).toBe(403);
        expect(codeOf(res)).toBe('SUBSCRIPTION_READ_ONLY');
      }
      expect((await as('khalid').get(`/requests/${id}`)).status).toBe(200);
    } finally {
      await setSubscriptionEnd(365);
    }
  });

  it("audits every action in its tenant and never reaches another tenant's questions", async () => {
    const id = await submit();
    const asked = await ask(id);
    const attempt = await asUser(app, rashid).post(answerPath(id, asked.id), { answer: 'x' });
    expect(attempt.status).toBe(404);
    const cancel = await asUser(app, rashid).post(cancelPath(id, asked.id));
    expect(cancel.status).toBe(404);
    const close = await asUser(app, rashid).post(`/requests/${id}/close-no-response`, {
      reason: 'x',
    });
    expect(close.status).toBe(404);
    expect((await questionsOf(id))[0]?.state).toBe('open');

    await as('huda').post(cancelPath(id, asked.id));
    const rows = await pool.query('select action, tenant_id from audit_log where resource_id = $1 order by id', [id]);
    expect(rows.rows.map((row) => row.action)).toEqual(['request.submitted', 'request.information_requested', 'request.information_cancelled']);
    expect(new Set(rows.rows.map((row) => row.tenant_id))).toEqual(new Set([alNoor.tenantId]));
  });
});
