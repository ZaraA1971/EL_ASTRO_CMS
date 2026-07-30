import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessPremium,
  canPublish,
  canAccessDesk,
  canEditAll,
  normalizeRole,
  mapWpRoleToEl,
  publicUser,
  effectiveStatus,
  ROLES,
} from './roles.mjs';

describe('normalizeRole / mapWpRoleToEl', () => {
  it('maps WP administrator → admin', () => {
    assert.equal(mapWpRoleToEl('administrator'), ROLES.ADMIN);
    assert.equal(normalizeRole('administrator'), ROLES.ADMIN);
  });
  it('keeps EL roles', () => {
    assert.equal(normalizeRole('editor'), ROLES.EDITOR);
    assert.equal(normalizeRole('subscriber'), ROLES.SUBSCRIBER);
  });
});

describe('desk ACL', () => {
  it('desk for staff only', () => {
    assert.equal(canAccessDesk('admin'), true);
    assert.equal(canAccessDesk('editor'), true);
    assert.equal(canAccessDesk('author'), true);
    assert.equal(canAccessDesk('subscriber'), false);
    assert.equal(canAccessDesk('other'), false);
  });
  it('publish for editor/admin only', () => {
    assert.equal(canPublish('admin'), true);
    assert.equal(canPublish('editor'), true);
    assert.equal(canPublish('author'), false);
    assert.equal(canEditAll('author'), false);
  });
});

describe('canAccessPremium', () => {
  it('allows active subscriber', () => {
    assert.equal(
      canAccessPremium({ role: 'subscriber', status: 'active' }),
      true
    );
  });
  it('denies disabled / other / expired status', () => {
    assert.equal(
      canAccessPremium({ role: 'subscriber', status: 'disabled' }),
      false
    );
    assert.equal(
      canAccessPremium({ role: 'other', status: 'active' }),
      false
    );
    assert.equal(
      canAccessPremium({ role: 'subscriber', status: 'expired' }),
      false
    );
  });
  it('denies past access_until', () => {
    assert.equal(
      canAccessPremium({
        role: 'subscriber',
        status: 'active',
        access_until: '2020-01-01T00:00:00Z',
      }),
      false
    );
  });
  it('allows future access_until', () => {
    assert.equal(
      canAccessPremium({
        role: 'subscriber',
        status: 'active',
        access_until: '2099-01-01T00:00:00Z',
      }),
      true
    );
  });
  it('staff always entitled when active', () => {
    assert.equal(canAccessPremium({ role: 'admin', status: 'active' }), true);
    assert.equal(canAccessPremium({ role: 'author', status: 'active' }), true);
  });

  it('staff ignores access_until and stripe expired', () => {
    assert.equal(
      canAccessPremium({
        role: 'admin',
        status: 'active',
        access_until: '2020-01-01T00:00:00Z',
      }),
      true
    );
    assert.equal(
      canAccessPremium({
        role: 'editor',
        status: 'expired',
        access_until: '2020-01-01T00:00:00Z',
      }),
      true
    );
  });
});

describe('publicUser / effectiveStatus', () => {
  it('marks expired from access_until', () => {
    const u = publicUser({
      id: 1,
      login: 'x',
      display_name: 'X',
      role: 'subscriber',
      status: 'active',
      access_until: '2020-01-01',
    });
    assert.equal(u.status, 'expired');
    assert.equal(u.entitled, false);
    assert.equal(u.tier, 'autre');
  });
  it('effectiveStatus mirrors access_until', () => {
    assert.equal(
      effectiveStatus({
        status: 'active',
        access_until: '2020-01-01',
      }),
      'expired'
    );
  });
});
