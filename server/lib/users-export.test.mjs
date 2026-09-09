import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { usersExportCsv, USERS_EXPORT_COLUMNS } from './users-export.mjs';

describe('usersExportCsv (csv)', () => {
  it('writes french headers and yes/no cells', () => {
    const csv = usersExportCsv(
      [
        {
          id: 9,
          login: 'marie@el.info',
          email: 'marie@el.info',
          name: 'Marie',
          role: 'subscriber',
          status: 'active',
          entitled: true,
          desk: false,
          newsletter_opt_in: true,
          notes: 'dit « ok »; suite',
        },
      ],
      'csv'
    );
    assert.ok(csv.startsWith('\uFEFF'));
    assert.match(csv, /identifiant;email;nom/);
    assert.match(csv, /marie@el.info/);
    assert.match(csv, /oui;non/);
    assert.match(csv, /"dit « ok »; suite"/);
    assert.ok(!csv.includes('password'));
    assert.equal(USERS_EXPORT_COLUMNS.length, 19);
  });
});
