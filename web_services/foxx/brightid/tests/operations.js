"use strict";

const db = require('../db.js');
const errors = require('../errors.js');
const _ = require('lodash');
const { getMessage } = require('../operations');
const arango = require('@arangodb').db;
const query = require('@arangodb').query;
const request = require("@arangodb/request");
const nacl = require('tweetnacl');
nacl.setPRNG(function(x, n) {
  for (let i = 0; i < n; i++) {
    x[i] = Math.floor(Math.random() * 256);
  }
});
const {
  b64ToUrlSafeB64,
  uInt8ArrayToB64,
  strToUint8Array,
  b64ToUint8Array,
  hash
} = require('../encoding');

const { baseUrl } = module.context;
const applyBaseUrl = baseUrl.replace('/brightid6', '/apply6');

const connectionsColl = arango._collection('connections');
const groupsColl = arango._collection('groups');
const usersInGroupsColl = arango._collection('usersInGroups');
const usersColl = arango._collection('users');
const operationsColl = arango._collection('operations');
const appsColl = arango._collection('apps');
const sponsorshipsColl = arango._collection('sponsorships');
const operationsHashesColl = arango._collection('operationsHashes');
const invitationsColl = arango._collection('invitations');
const verificationsColl = arango._collection('verifications');

const chai = require('chai');
const should = chai.should();

const u1 = nacl.sign.keyPair();
const u2 = nacl.sign.keyPair();
const u3 = nacl.sign.keyPair();
const u4 = nacl.sign.keyPair();
const u5 = nacl.sign.keyPair();
const u6 = nacl.sign.keyPair();
const u7 = nacl.sign.keyPair();
const u8 = nacl.sign.keyPair();
const u9 = nacl.sign.keyPair();

function apply(op) {
  let resp = request.post(`${baseUrl}/operations`, {
    body: op,
    json: true
  });
  resp.status.should.equal(200);
  let h = hash(getMessage(op));
  resp.json.data.hash.should.equal(h);
  op = operationsColl.document(h);
  op = _.omit(op, ['_rev','_id', '_key', 'hash', 'state']);
  op.blockTime = op.timestamp;
  resp = request.put(`${applyBaseUrl}/operations/${h}`, {
    body: op,
    json: true
  });
  resp.json.success.should.equal(true);
  return resp;
}

function connect(u1, u2, level) {

  const timestamp = Date.now();
  let op = {
    'v': 6,
    'name': 'Connect',
    'id1': u1.id,
    'id2': u2.id,
    level,
    timestamp,
  }
  const message = getMessage(op);
  op.sig1 = uInt8ArrayToB64(
    Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
  );
  apply(op);
  connectionsColl.firstExample({
    '_from': 'users/' + u1.id,
    '_to': 'users/' + u2.id,
  }).level.should.equal(level);
}

describe('operations', function(){
  before(function () {
    operationsHashesColl.truncate();
    usersColl.truncate();
    connectionsColl.truncate();
    groupsColl.truncate();
    usersInGroupsColl.truncate();
    operationsColl.truncate();
    appsColl.truncate();
    sponsorshipsColl.truncate();
    invitationsColl.truncate();
    verificationsColl.truncate();
    [u1, u2, u3, u4, u5, u6].map((u) => {
      u.signingKey = uInt8ArrayToB64(Object.values(u.publicKey));
      u.id = b64ToUrlSafeB64(u.signingKey);
      db.createUser(u.id, Date.now());
    });
  });

  after(function () {
    operationsHashesColl.truncate();
    appsColl.truncate();
    usersColl.truncate();
    connectionsColl.truncate();
    groupsColl.truncate();
    usersInGroupsColl.truncate();
    operationsColl.truncate();
    sponsorshipsColl.truncate();
    invitationsColl.truncate();
    verificationsColl.truncate();
  });

  it('should be able to "Connect"', function () {
    connect(u1, u2, 'just met');
    connect(u2, u1, 'just met');
    connect(u1, u3, 'just met');
    connect(u3, u1, 'just met');
    connect(u2, u3, 'just met');
    connect(u2, u4, 'just met');
    connect(u3, u4, 'just met');
  });

  it('should be able to report using "Connect" by providing requestProof', function () {
    const timestamp = Date.now();

    const requestProofMessage = u1.id + '|' + timestamp;
    const requestProof = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(requestProofMessage), u1.secretKey))
    );
    let op = {
      'v': 6,
      'name': 'Connect',
      'id1': u2.id,
      'id2': u1.id,
      'level': 'reported',
      'reportReason': 'spammer',
      requestProof,
      timestamp,
    }
    const message = getMessage(op);
    op.sig1 = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u2.secretKey))
    );
    apply(op);
    const conn = connectionsColl.firstExample({
      '_from': 'users/' + u2.id,
      '_to': 'users/' + u1.id,
    })
    conn.level.should.equal('reported');
    conn.requestProof.should.equal(requestProof);
  });

  it('should be able to "Add Group"', function () {
    const timestamp = Date.now();
    const type = 'general';
    const url = 'http://url.com/dummy';
    const groupId = hash('randomstr');

    const op = {
      'v': 6,
      'name': 'Add Group',
      'group': groupId,
      'id1': u1.id,
      url,
      type,
      timestamp,
    }
    const message = getMessage(op);
    op.sig1 = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
    );
    apply(op);

    const members = db.groupMembers(groupId);
    members.should.include(u1.id);
  });

  it('should be able to "Add Membership"', function () {
    const groupId = db.userGroups(u1.id)[0].id;
    const timestamp = Date.now();
    db.invite(u1.id, u2.id, groupId, 'data', timestamp);
    const op = {
      'v': 5,
      'name': 'Add Membership',
      'id': u2.id,
      'group': groupId,
      timestamp,
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u2.secretKey))
    );
    apply(op);
    const members = db.groupMembers(groupId);
    members.should.include(u2.id);
  });

  it('should be able to "Remove Membership"', function () {
    const timestamp = Date.now();
    const groupId = db.userGroups(u1.id)[0].id;
    const op = {
      'v': 6,
      'name': 'Remove Membership',
      'id': u2.id,
      'group': groupId,
      timestamp,
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u2.secretKey))
    );
    apply(op);
    const members = db.groupMembers(groupId, false);
    members.should.not.include(u2.id);
    members.should.include(u1.id);
  });

  it('admins should be able to "Invite" someone to the group', function () {
    const timestamp = Date.now();
    const groupId = db.userGroups(u1.id)[0].id;
    const data = 'some data';
    const op = {
      'v': 6,
      'name': 'Invite',
      'inviter': u1.id,
      'invitee': u2.id,
      'group': groupId,
      data,
      timestamp,
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
    );
    apply(op);
    invitationsColl.byExample({
      '_from': 'users/' + u2.id,
      '_to': 'groups/' + groupId
    }).count().should.equal(1);
  });

  it('admins should be able to "Dismiss" someone from the group', function () {
    const timestamp = Date.now();
    const groupId = db.userGroups(u1.id)[0].id;
    db.addMembership(groupId, u2.id, Date.now());
    db.groupMembers(groupId).should.include(u2.id);
    const op = {
      'v': 6,
      'name': 'Dismiss',
      'dismisser': u1.id,
      'dismissee': u2.id,
      'group': groupId,
      timestamp,
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
    );
    apply(op);
    db.groupMembers(groupId).should.not.include(u2.id);
  });

  it('admins should be able to "Add Admin" to the group', function () {
    const timestamp = Date.now();
    const groupId = db.userGroups(u1.id)[0].id;
    db.invite(u1.id, u2.id, groupId, 'data', Date.now());
    db.addMembership(groupId, u2.id, Date.now());
    db.groupMembers(groupId).should.include(u2.id);
    const op = {
      'v': 6,
      'name': 'Add Admin',
      'id': u1.id,
      'admin': u2.id,
      'group': groupId,
      timestamp,
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
    );
    apply(op);
    groupsColl.document(groupId).admins.should.include(u2.id);
  });

  it('admins should be able "Update Group" to edit name and photo for groups', function () {
    const newUrl = 'http://url.com/newDummyUrl';
    const timestamp = Date.now();
    const groupId = db.userGroups(u2.id)[0].id;
    const op = {
      'v': 6,
      'name': 'Update Group',
      'id': u2.id,
      'url': newUrl,
      'group': groupId,
      timestamp,
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u2.secretKey))
    );
    apply(op);
    groupsColl.document(groupId).url.should.equal(newUrl);
  });

  it("should not be able to make a recovery connection when the other side connection is not equal to 'recovery' or 'already known'", function () {
    const timestamp = Date.now();

    let op = {
      'v': 6,
      'name': 'Connect',
      'id1': u1.id,
      'id2': u2.id,
      'level': 'recovery',
      timestamp,
    }
    const message = getMessage(op);
    op.sig1 = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
    );
    const resp = apply(op);
    resp.json.result.errorNum.should.equal(errors.INELIGIBLE_RECOVERY_CONNECTION);
    connectionsColl.firstExample({
      '_from': 'users/' + u1.id,
      '_to': 'users/' + u2.id,
    }).level.should.equal('just met');
  });

  it('should be able to "Social Recovery"', function () {
    connect(u2, u1, 'already known');
    connect(u3, u1, 'already known');
    connect(u1, u2, 'recovery');
    connect(u1, u3, 'recovery');
    const timestamp = Date.now();
    const op = {
      'v': 6,
      'name': 'Social Recovery',
      'id': u1.id,
      'id1': u2.id,
      'id2': u3.id,
      'signingKey': u4.signingKey,
      timestamp,
    }
    const message = getMessage(op);
    op.sig1 = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u2.secretKey))
    );
    op.sig2 = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u3.secretKey))
    );
    apply(op);
    db.loadUser(u1.id).signingKeys.should.deep.equal([u4.signingKey]);
    u1.secretKey = u4.secretKey;
  });

  it('should be able to "Add Signing Key"', function () {
    const addSigningKey = (u, signingKey) => {
      const timestamp = Date.now();
      const op = {
        'v': 6,
        'id': u.id,
        'name': 'Add Signing Key',
        signingKey,
        timestamp
      }
      const message = getMessage(op);
      op.sig = uInt8ArrayToB64(
        Object.values(nacl.sign.detached(strToUint8Array(message), u.secretKey))
      );
      apply(op);
    }
    addSigningKey(u2, u5.signingKey);
    addSigningKey(u2, u6.signingKey);
    db.loadUser(u2.id).signingKeys.should.deep.equal([u2.signingKey, u5.signingKey, u6.signingKey]);
  });

  it('should be able to "Remove Signing Key"', function () {
    const timestamp = Date.now();
    const op = {
      'v': 6,
      'id': u2.id,
      'name': 'Remove Signing Key',
      'signingKey': u5.signingKey,
      timestamp
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u2.secretKey))
    );
    apply(op);
    db.loadUser(u2.id).signingKeys.should.deep.equal([u2.signingKey, u6.signingKey]);
  });

  it('should be able to sign an operation using new Signing Key', function () {
    const timestamp = Date.now();
    let op = {
      'v': 6,
      'name': 'Connect',
      'id1': u2.id,
      'id2': u3.id,
      'level': 'reported',
      'reportReason': 'duplicate',
      timestamp,
    }
    const message = getMessage(op);
    op.sig1 = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u6.secretKey))
    );
    apply(op);
    db.userConnections(u2.id).filter(
      u => u.id == u3.id
    )[0].level.should.equal('reported');
  });

  it('should be able to "Remove All Signing Keys"', function () {
    const timestamp = Date.now();
    const op = {
      'v': 6,
      'id': u2.id,
      'name': 'Remove All Signing Keys',
      timestamp
    }
    const message = getMessage(op);
    op.sig = uInt8ArrayToB64(
      Object.values(nacl.sign.detached(strToUint8Array(message), u6.secretKey))
    );
    apply(op);
    db.loadUser(u2.id).signingKeys.should.deep.equal([u6.signingKey]);
  });

  describe('family groups', function() {
    before(function() {
      usersColl.truncate();
      connectionsColl.truncate();
      groupsColl.truncate();
      usersInGroupsColl.truncate();
      invitationsColl.truncate();

      [u7, u8, u9].map((u) => {
        u.signingKey = uInt8ArrayToB64(Object.values(u.publicKey));
        u.id = b64ToUrlSafeB64(u.signingKey);
      });

      const connect = (u1, u2) => {
        const timestamp = Date.now();
        let op = {
          'v': 5,
          'name': 'Connect',
          'id1': u1.id,
          'id2': u2.id,
          'level': 'already known',
          timestamp,
        }
        const message = getMessage(op);
        op.sig1 = uInt8ArrayToB64(
          Object.values(nacl.sign.detached(strToUint8Array(message), u1.secretKey))
        );
        apply(op);
      }
      connect(u7, u8);
      connect(u8, u7);

      connect(u7, u9);
      connect(u9, u7);

      connect(u8, u9);
      connect(u9, u8);
    });

    it('should be able to create a family group by "Add Group"', function () {
      const timestamp = Date.now();
      const type = 'family';
      const url = 'http://url.com/dummy';
      const groupId = hash('randomstr1');
      const op = {
        'v': 5,
        'name': 'Add Group',
        'group': groupId,
        'id1': u7.id,
        url,
        type,
        timestamp,
      }
      const message = getMessage(op);
      op.sig1 = uInt8ArrayToB64(
        Object.values(nacl.sign.detached(strToUint8Array(message), u7.secretKey))
      );
      apply(op);

      db.invite(u7.id, u8.id, groupId, 'data', Date.now());
      db.addMembership(groupId, u8.id, Date.now());

      const members = db.groupMembers(groupId);
      members.should.include(u7.id);
      members.should.include(u8.id);
    });

    it('eligible users should be able to vouch family groups by "Vouch Family Group"', function () {
      const timestamp = Date.now();
      const groupId = hash('randomstr1');
      db.userEligibleGroupsToVouch(u9.id).should.include(groupId);
      const op = {
        'v': 5,
        'name': 'Vouch Family Group',
        'group': groupId,
        'id': u9.id,
        timestamp,
      }
      const message = getMessage(op);
      op.sig = uInt8ArrayToB64(
        Object.values(nacl.sign.detached(strToUint8Array(message), u9.secretKey))
      );
      apply(op);
      groupsColl.document(groupId).vouchers.should.include(u9.id);
    });
  });
});
