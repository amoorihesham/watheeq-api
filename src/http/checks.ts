/**
 * Whether the contract checks run: the response check of `sendData` and `sendPage`, and the detail-code check of
 * `validate()` (Phase 8 spec 4.2.2). They are on unless `buildApp` turns them off for production, so unit tests
 * that never build the app are checked too. Set once from configuration, so no code reads NODE_ENV itself.
 */
let enabled = true;

export const contractChecksEnabled = (): boolean => enabled;

export const setContractChecks = (on: boolean): void => {
  enabled = on;
};
