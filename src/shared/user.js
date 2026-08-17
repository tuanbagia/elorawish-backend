export const USER_ROLES = Object.freeze({ CLIENT: 'CLIENT', ADMIN: 'ADMIN' });
export const USER_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
});

export function isDeleted(value) {
  return value === true || value === 'Y' || value === '1' || value === 1;
}

export function isAuthenticatable(user) {
  return Boolean(user) && user.statusCode === USER_STATUSES.ACTIVE && !isDeleted(user.deletedFlag);
}

export function toSafeUser(user) {
  return {
    id: String(user.userId),
    email: user.email,
    fullName: user.fullName,
    phoneNumber: user.phoneNumber ?? null,
    role: user.roleCode,
    status: user.statusCode,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}
