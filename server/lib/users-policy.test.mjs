/**
 * Garde-fous comptes EL — hash WP + droits, hors router HTTP.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canManageUsers,
  canMutateUser,
  allowedRolesForActor,
  hashUserPassword,
  generateTempPassword,
  elUserPolicy,
  elUsersStore,
} from './users.mjs';

describe('users EL policy (safety)', () => {
  it('only editors/admins manage users', () => {
    assert.equal(canManageUsers('admin'), true);
    assert.equal(canManageUsers('editor'), true);
    assert.equal(canManageUsers('author'), false);
    assert.equal(canManageUsers('subscriber'), false);
  });

  it('editors cannot mutate admins', () => {
    assert.equal(canMutateUser('editor', 'admin'), false);
    assert.equal(canMutateUser('editor', 'subscriber'), true);
    assert.equal(canMutateUser('admin', 'admin'), true);
  });

  it('role lists stay bounded', () => {
    assert.deepEqual(allowedRolesForActor('editor'), [
      'author',
      'subscriber',
      'other',
    ]);
    assert.ok(allowedRolesForActor('admin').includes('admin'));
  });

  it('hashes with wordpress-compatible phpass ($P$)', () => {
    const plain = generateTempPassword(14);
    assert.ok(plain.length >= 14);
    const hash = hashUserPassword(plain);
    assert.match(hash, /^\$P\$/);
    assert.notEqual(hash, plain);
  });

  it('rejects weak passwords', () => {
    assert.throws(() => hashUserPassword('short'), /8 caractères/);
  });

  it('wires store + policy for core router', () => {
    assert.equal(elUsersStore.tableName, 'el_users');
    assert.equal(elUserPolicy.hashPassword, hashUserPassword);
    assert.equal(typeof elUserPolicy.generateTempPassword, 'function');
    assert.equal(elUserPolicy.ROLES.ADMIN, 'admin');
  });
});
