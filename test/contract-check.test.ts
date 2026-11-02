import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classify, type OasdiffChangeType, OPENAPI_FILE, oasdiffChangelog, parseTrailers } from '../src/cli/contract-changes.js';

const change = (text: string, level: number, operation = 'GET', path = '/operator/plans'): OasdiffChangeType => ({ id: 'some-check', text, level, operation, path });

describe('classify', () => {
  it('counts a definite or a possible break as a contract change, and an addition as a heads-up', () => {
    const result = classify([change('removed the required property `data/items/discountPercent`', 3), change('the response property `data/name` became nullable', 2), change('endpoint added', 1)]);

    expect(result.contractChanges.map((grouped) => grouped.text)).toEqual(['removed the required property `data/items/discountPercent`', 'the response property `data/name` became nullable']);
    expect(result.additions.map((grouped) => grouped.text)).toEqual(['endpoint added']);
  });

  it('lists a change to a shared schema once, with every operation it reaches', () => {
    const text = 'added the new `quarterly` enum value to the `data/paymentPeriod` response property';
    const result = classify([change(text, 3, 'POST'), change(text, 3, 'GET', '/operator/plans/{planId}')]);

    expect(result.contractChanges).toEqual([{ text, operations: ['GET /operator/plans/{planId}', 'POST /operator/plans'] }]);
  });

  it('counts a new error or detail code as a heads-up, listed once', () => {
    const result = classify([
      change('added the new `PLAN_RETIRED` enum value to the `error/code` response property for the response status `400`', 3, 'POST', '/auth/login'),
      change('added the new `PLAN_RETIRED` enum value to the `error/code` response property for the response status `409`', 3, 'POST'),
      change('added the new `retired_plan` enum value to the `error/details/items/code` response property for the response status `400`', 3),
    ]);

    expect(result).toEqual({ contractChanges: [], additions: [], newCodes: ['PLAN_RETIRED', 'retired_plan'] });
  });

  it('still counts a new value of any other enum as a contract change', () => {
    const result = classify([change('added the new `suspended` enum value to the `data/subscription/state` response property for the response status `200`', 3)]);

    expect(result.contractChanges).toHaveLength(1);
    expect(result.newCodes).toEqual([]);
  });

  it('ignores the version check, since the document is not versioned per change', () => {
    expect(classify([{ id: 'api-version-not-bumped', text: 'a breaking change was detected but the version is still `1.0.0`', level: 1 }])).toEqual({ contractChanges: [], additions: [], newCodes: [] });
  });
});

describe('parseTrailers', () => {
  it('keeps each frontend issue once and reports any other value', () => {
    expect(parseTrailers('amoorihesham/watheeq-frontend#12\n\namoorihesham/watheeq-frontend#12\n#12\namoorihesham/watheeq-api#3\n')).toEqual({
      issues: ['amoorihesham/watheeq-frontend#12'],
      malformed: ['#12', 'amoorihesham/watheeq-api#3'],
    });
  });

  it('finds nothing in a range without trailers', () => {
    expect(parseTrailers('\n\n')).toEqual({ issues: [], malformed: [] });
  });
});

describe('the pinned oasdiff on our document', () => {
  it('reports a removed field, a new response enum value, and a new error code as their classes', () => {
    const base = readFileSync(OPENAPI_FILE, 'utf8');
    const head = JSON.parse(base);
    const schemas = head.components.schemas;
    schemas.Plan.required = schemas.Plan.required.filter((key: string) => key !== 'discountPercent');
    delete schemas.Plan.properties.discountPercent;
    schemas.SubscriptionStatus.properties.state.enum.push('suspended');
    schemas.Error.properties.error.properties.code.enum.push('PLAN_RETIRED');

    const result = classify(oasdiffChangelog(base, JSON.stringify(head)));

    expect(result.newCodes).toEqual(['PLAN_RETIRED']);
    expect(result.contractChanges.some((grouped) => grouped.text.includes('`data/items/discountPercent`'))).toBe(true);
    expect(result.contractChanges.some((grouped) => grouped.text.includes('`suspended`'))).toBe(true);
    expect(result.additions).toEqual([]);
  }, 120_000);

  it('reports nothing for an unchanged document', () => {
    const base = readFileSync(OPENAPI_FILE, 'utf8');

    expect(classify(oasdiffChangelog(base, base))).toEqual({ contractChanges: [], additions: [], newCodes: [] });
  }, 120_000);
});
