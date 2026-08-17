export class PrismaUserRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  findByEmail(email) {
    return this.prisma.tb_m_user
      .findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
      })
      .then(toDomainUser);
  }

  findById(userId) {
    return this.prisma.tb_m_user
      .findUnique({ where: { user_id: userId } })
      .then(toDomainUser);
  }

  createPublicUser({ email, passwordHash, fullName, phoneNumber, now }) {
    return this.createUser({
      email,
      passwordHash,
      fullName,
      phoneNumber,
      roleCode: 'CLIENT',
      statusCode: 'ACTIVE',
      auditActor: 'PUBLIC_REGISTER',
      now,
    });
  }

  createDevelopmentUser({ email, passwordHash, fullName, phoneNumber, roleCode, statusCode, now }) {
    return this.createUser({
      email,
      passwordHash,
      fullName,
      phoneNumber,
      roleCode,
      statusCode,
      auditActor: 'DEV_SEED',
      now,
    });
  }

  createUser({
    email,
    passwordHash,
    fullName,
    phoneNumber,
    roleCode,
    statusCode,
    auditActor,
    now,
  }) {
    // USER_ID is intentionally omitted: the existing database default/trigger
    // is authoritative. Never replace this with an application-side counter.
    return this.prisma.tb_m_user.create({
      data: {
        email,
        password_hash: passwordHash,
        full_name: fullName,
        phone_no: phoneNumber,
        role_cd: roleCode,
        status_cd: statusCode,
        created_by: auditActor,
        created_dt: now,
        changed_by: auditActor,
        changed_dt: now,
        deleted_flag: false,
      },
    }).then(toDomainUser);
  }

  updateDevelopmentUser(userId, changes, now) {
    const data = {
      changed_by: 'DEV_SEED',
      changed_dt: now,
    };
    const fieldMap = {
      email: 'email',
      passwordHash: 'password_hash',
      fullName: 'full_name',
      phoneNumber: 'phone_no',
      roleCode: 'role_cd',
      statusCode: 'status_cd',
      deletedFlag: 'deleted_flag',
      deletedBy: 'deleted_by',
      deletedAt: 'deleted_dt',
    };

    for (const [domainField, databaseField] of Object.entries(fieldMap)) {
      if (Object.hasOwn(changes, domainField)) data[databaseField] = changes[domainField];
    }

    return this.prisma.tb_m_user
      .update({ where: { user_id: userId }, data })
      .then(toDomainUser);
  }

  updateLastLogin(userId, now) {
    return this.prisma.tb_m_user
      .update({
        where: { user_id: userId },
        data: {
          last_login_dt: now,
          changed_dt: now,
          changed_by: String(userId),
        },
      })
      .then(toDomainUser);
  }
}

function toDomainUser(user) {
  if (!user) return null;
  return {
    userId: user.user_id,
    email: user.email,
    passwordHash: user.password_hash,
    fullName: user.full_name,
    phoneNumber: user.phone_no,
    roleCode: user.role_cd,
    statusCode: user.status_cd,
    lastLoginAt: user.last_login_dt,
    deletedFlag: user.deleted_flag,
  };
}
