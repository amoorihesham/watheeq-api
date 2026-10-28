import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLogger } from '../src/logging/logger.js';
import { type AlNoorType, asUser, type PersonType, seedAlNoor, vendorAnswers } from './helpers/al-noor.js';
import { testApp } from './helpers/app.js';
import { connectToTestDb } from './helpers/db.js';
import { fixture, uploadAs } from './helpers/files.js';

// Phase 6 spec, R6.20 and R6.24 for current stage assignees: steps 6.3 and 6.4 were built before stage runs existed,
// so the assignee side of asking and attaching is tested here, on the merged code.

const pool = connectToTestDb();
const app = testApp(pool, createLogger('silent'));

let alNoor: AlNoorType;

const as = (person: PersonType) => asUser(app, alNoor.tokens[person]);
const codeOf = (res: { body: { error: { code: string } } }) => res.body.error.code;

type RunType = { id: string; state: string; stage: { name: string } };

/** Khalid's request, accepted by Huda with Faisal handling it: Business approval waits on Majed. */
async function inBusinessApproval(): Promise<{ id: string; runId: string }> {
  const submitted = await as('khalid').post('/requests', {
    serviceId: alNoor.serviceId,
    priorityId: alNoor.priorities.high,
    title: 'Gulf Supplies contract',
    answers: vendorAnswers(alNoor),
  });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
  const id = submitted.body.data.id as string;
  const accepted = await as('huda').post(`/requests/${id}/accept`, {
    handlerId: alNoor.ids.faisal,
    workflowId: alNoor.workflows.vendor,
  });
  expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);
  const run = (accepted.body.data.stages as RunType[]).find((r) => r.state === 'active');
  expect(run?.stage.name).toBe('Business approval');
  return { id, runId: run?.id ?? '' };
}

async function pendingUpload(person: PersonType, name: string): Promise<string> {
  const res = await uploadAs(app, alNoor.tokens[person], name, fixture('contract.pdf'));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.data.id;
}

beforeAll(async () => {
  alNoor = await seedAlNoor(pool, app, 'pty-al-noor');
});

afterAll(async () => {
  await pool.end();
});

describe('a current stage assignee as a party (R6.20, R6.24)', () => {
  it('lets Majed ask Khalid a question and attach a file while Business approval waits on him', async () => {
    const { id } = await inBusinessApproval();
    const page = await as('majed').get(`/requests/${id}`);
    expect(page.body.data.allowedActions).toEqual(expect.arrayContaining(['attach_files', 'ask_information', 'complete']));

    const asked = await as('majed').post(`/requests/${id}/information-requests`, {
      question: 'Is this within the Q4 budget?',
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(200);

    const fileId = await pendingUpload('majed', 'budget-approval.pdf');
    const attached = await as('majed').post(`/requests/${id}/files`, { fileIds: [fileId] });
    expect(attached.status, JSON.stringify(attached.body)).toBe(200);
    expect(attached.body.data.files.map((f: { id: string }) => f.id)).toContain(fileId);
  });

  it('refuses Nora, who sees the request but is not an assignee', async () => {
    const { id } = await inBusinessApproval();
    expect((await as('nora').get(`/requests/${id}`)).status).toBe(200);
    const asked = await as('nora').post(`/requests/${id}/information-requests`, {
      question: 'Anything?',
    });
    expect(asked.status).toBe(403);
    const fileId = await pendingUpload('nora', 'notes.pdf');
    const attached = await as('nora').post(`/requests/${id}/files`, { fileIds: [fileId] });
    expect(attached.status).toBe(403);
  });

  it('stops treating Majed as a party once his stage is completed', async () => {
    const { id, runId } = await inBusinessApproval();
    const done = await as('majed').post(`/requests/${id}/stages/${runId}/complete`, {});
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    // Majed still sees it through his department scope over Procurement, but no longer acts on it.
    expect((await as('majed').get(`/requests/${id}`)).status).toBe(200);
    const asked = await as('majed').post(`/requests/${id}/information-requests`, {
      question: 'One more thing?',
    });
    expect(asked.status).toBe(403);
    const fileId = await pendingUpload('majed', 'late.pdf');
    const attached = await as('majed').post(`/requests/${id}/files`, { fileIds: [fileId] });
    expect(attached.status).toBe(403);
  });
});

describe('closing as no response with a live stage (R6.21)', () => {
  it('cancels the live run and closes the open question', async () => {
    const { id } = await inBusinessApproval();
    const asked = await as('majed').post(`/requests/${id}/information-requests`, {
      question: 'Is this within the Q4 budget?',
    });
    expect(asked.status).toBe(200);
    const closed = await as('faisal').post(`/requests/${id}/close-no-response`, {
      reason: 'No answer from Procurement',
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const request = closed.body.data;
    expect(request.state).toBe('rejected_no_response');
    expect((request.stages as RunType[]).map((r) => r.state)).toEqual(['cancelled']);
    expect(request.informationRequests.map((q: { state: string }) => q.state)).toEqual(['closed']);
    expect(request.activeStage).toBeNull();
    expect(codeOf(await as('faisal').post(`/requests/${id}/close-no-response`, { reason: 'x' }))).toBe('INVALID_REQUEST_STATE');
  });
});

describe('a deactivated member whose token is still valid (D31)', () => {
  async function whileInactive(person: PersonType, check: () => Promise<void>): Promise<void> {
    await pool.query('update users set is_active = false where id = $1', [alNoor.ids[person]]);
    try {
      await check();
    } finally {
      await pool.query('update users set is_active = true where id = $1', [alNoor.ids[person]]);
    }
  }

  it("refuses Khalid's withdraw and his answer", async () => {
    const submitted = await as('khalid').post('/requests', {
      serviceId: alNoor.serviceId,
      priorityId: alNoor.priorities.high,
      title: 'Gulf Supplies contract',
      answers: vendorAnswers(alNoor),
    });
    const id = submitted.body.data.id as string;
    await whileInactive('khalid', async () => {
      expect((await as('khalid').post(`/requests/${id}/withdraw`, { reason: 'r' })).status).toBe(403);
    });
    expect((await as('khalid').post(`/requests/${id}/withdraw`, { reason: 'r' })).status).toBe(200);

    const { id: open } = await inBusinessApproval();
    const asked = await as('majed').post(`/requests/${open}/information-requests`, {
      question: 'Is this within the Q4 budget?',
    });
    const infoId = asked.body.data.informationRequests[0].id as string;
    await whileInactive('khalid', async () => {
      const answered = await as('khalid').post(`/requests/${open}/information-requests/${infoId}/answer`, { answer: 'Yes' });
      expect(answered.status).toBe(403);
    });
  });

  it("refuses Majed's question while his stage waits on him", async () => {
    const { id } = await inBusinessApproval();
    await whileInactive('majed', async () => {
      const asked = await as('majed').post(`/requests/${id}/information-requests`, {
        question: 'Anything?',
      });
      expect(asked.status).toBe(403);
    });
  });
});

describe('a deactivated handler (section 5)', () => {
  it("refuses Faisal's stage actions until he is replaced", async () => {
    const { id, runId } = await inBusinessApproval();
    await pool.query('update users set is_active = false where id = $1', [alNoor.ids.faisal]);
    try {
      expect((await as('faisal').post(`/requests/${id}/stages/${runId}/refresh`, {})).status).toBe(403);
    } finally {
      await pool.query('update users set is_active = true where id = $1', [alNoor.ids.faisal]);
    }
  });
});
