const config = require('./config');
const groupTypes = require('./constants/groupTypes');
const ldapClient = require('./ldapClient');

const { isAdUser, getCnFromDn } = require('./helpers/distinguishedName');

async function getUser(loginId) {
  const conn = await ldapClient.createConnection('ad');
  const baseDn = config.AD_PEOPLE_BASE;
  const options = {
    filter: `(cn=${loginId})`,
    scope: 'sub',
  };

  try {
    const result = await conn.search(baseDn, options);
    return result.searchEntries[0];
  } finally {
    conn.unbind();
  }
}

async function getGroup(groupName) {
  const conn = await ldapClient.createConnection('ou');
  const baseDn = config.AD_GROUPS_BASE;
  const options = {
    filter: `(cn=${groupName})`,
    scope: 'sub',
    attributes: ['member'],
  };

  try {
    const result = await conn.search(baseDn, options);
    return result.searchEntries[0];
  } finally {
    conn.unbind();
  }
}

/**
 * Returns array of member DN in group
 * @param {string} groupName "dss-it-us-testers"
 */
async function getMembersFromGroup(groupName) {
  const ouGroup = await getGroup(groupName);
  let results = [];
  let memberList = [];

  if (Array.isArray(ouGroup.member) === false) {
    memberList = [ouGroup.member];
  } else {
    memberList = ouGroup.member;
  }

  for (const memberDn of memberList) {
    if (isAdUser(memberDn)) {
      results.push(memberDn);
    } else {
      const cn = getCnFromDn(memberDn);
      const members = await getMembersFromGroup(cn);
      results.push(members);
    }
  }

  return results.flat();
}

async function getEmailsFromGroup(cn) {
  const members = await getMembersFromGroup(cn);
  const logins = members.map((dn) => dn.match(/CN=([^,]+)/)[1]);

  const emails = await Promise.all(
    logins.map((login) => getEmailFromLogin(login))
  );

  return emails;
}

async function getEmailFromLogin(cn) {
  const user = await getUser(cn);
  return `${user.mail} ${user.displayName}`;
}

async function addGroupToGroup(childGroupName, groupName) {
  const childGroup = await getGroup(childGroupName);
  const group = await getGroup(groupName);

  const change = ldapClient.createChange('add', 'member', [entity.dn]);

  const conn = await ldapClient.createConnection('ou');
  await conn.modify(group.dn, change);
  conn.unbind();
}

async function addUsersToGroup(loginIds, groupName) {
  const ouGroup = await getGroup(groupName);
  const adUsers = await Promise.all(
    loginIds.map((loginId) => getUser(loginId))
  );

  const userDNs = adUsers.map((u) => u.dn);

  const change = ldapClient.createChange('add', 'member', userDNs);

  const conn = await ldapClient.createConnection('ou');
  await conn.modify(ouGroup.dn, change);
  conn.unbind();
}

// async function removeUserFromGroup(loginId, groupName) {
//   const adGroup = await getGroup(groupName);
//   const adUser = await getUser(loginId);

//   const change = ldapClient.createChange('delete', 'member', [adUser.dn]);

//   const conn = await ldapClient.createConnection('ou');
//   await conn.modify(adGroup.dn, change);
//   conn.unbind();
// }

async function removeUsersFromGroup(loginIds, groupName) {
  const ouGroup = await getGroup(groupName);
  const users = await Promise.all(loginIds.map((loginId) => getUser(loginId)));

  const changes = users.map((u) =>
    ldapClient.createChange('delete', 'member', [u.dn])
  );

  const conn = await ldapClient.createConnection('ou');
  await conn.modify(ouGroup.dn, changes);
  conn.unbind();
}

async function createGroup(groupName) {
  const conn = await ldapClient.createConnection('ou');
  const testDn =
    'OU=LS-OU-TEST,OU=LS,OU=DEPARTMENTS,DC=OU,DC=AD3,DC=UCDAVIS,DC=EDU';

  const cn = groupName.toUpperCase();
  const dn = `CN=${cn},${testDn}`;

  const entry = {
    cn: cn,
    objectClass: ['top', 'group'],
    description: 'test group created by web service',
    samaccountname: cn,
    objectCategory:
      'CN=Group,CN=Schema,CN=Configuration,DC=ad3,DC=ucdavis,DC=edu',
    groupType: groupTypes.UNIVERSAL_SECURITY,
  };

  await conn.add(dn, entry);
}

async function deleteGroup(groupName) {
  const adGroup = await getGroup(groupName);
  const conn = await ldapClient.createConnection('ou');
  await conn.del(adGroup.dn);
}

// updateGroupDescription

module.exports = {
  getMembersFromGroup,
  getEmailsFromGroup,
  getEmailFromLogin,
  addGroupToGroup,
  addUsersToGroup,
  // removeUserFromGroup,
  removeUsersFromGroup,
  createGroup,
  deleteGroup,
};
