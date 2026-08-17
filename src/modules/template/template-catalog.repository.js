export class PrismaTemplateCatalogRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  transaction(work) {
    return this.prisma.$transaction((transaction) =>
      work(new PrismaTemplateCatalogRepository(transaction)),
    );
  }

  async findInvitationTypeByKey(typeKey) {
    const row = await this.prisma.tb_m_invitation_type.findUnique({
      where: { type_key: typeKey },
      select: {
        invitation_type_cd: true,
        type_key: true,
        active_flag: true,
        deleted_flag: true,
      },
    });
    return row ? toInvitationType(row) : null;
  }

  async findCategoriesByKeys(categoryKeys) {
    const rows = await this.prisma.tb_m_template_category.findMany({
      where: { category_key: { in: categoryKeys } },
      select: {
        template_category_cd: true,
        category_key: true,
        active_flag: true,
        deleted_flag: true,
      },
    });
    return rows.map(toCategory);
  }

  async findTemplateByKey(templateKey) {
    const row = await this.prisma.tb_m_template.findUnique({
      where: { template_key: templateKey },
    });
    return row ? toTemplate(row) : null;
  }

  async createTemplate(input) {
    const row = await this.prisma.tb_m_template.create({
      data: {
        template_key: input.templateKey,
        template_name: input.templateName,
        invitation_type_cd: input.invitationTypeId,
        template_category_cd: input.categoryId,
        description: input.description,
        thumbnail_url: input.thumbnailUrl,
        preview_url: input.previewUrl,
        premium_flag: input.premiumFlag,
        active_flag: input.activeFlag,
        sort_order: input.sortOrder,
        created_by: input.createdBy,
        changed_by: input.changedBy,
        changed_dt: input.changedAt,
        deleted_flag: false,
      },
    });
    return toTemplate(row);
  }

  async updateTemplate(templateId, changes, audit) {
    const row = await this.prisma.tb_m_template.update({
      where: { template_cd: templateId },
      data: {
        ...mapTemplateChanges(changes),
        changed_by: audit.changedBy,
        changed_dt: audit.changedAt,
      },
    });
    return toTemplate(row);
  }

  async findVersionByNumber(templateId, versionNo) {
    const row = await this.prisma.tb_m_template_version.findUnique({
      where: {
        template_cd_version_no: {
          template_cd: templateId,
          version_no: versionNo,
        },
      },
    });
    return row ? toVersion(row) : null;
  }

  async findActiveCurrentVersions(templateId) {
    const rows = await this.prisma.tb_m_template_version.findMany({
      where: {
        template_cd: templateId,
        current_flag: true,
        active_flag: true,
        deleted_flag: false,
      },
    });
    return rows.map(toVersion);
  }

  async createVersion(input) {
    const row = await this.prisma.tb_m_template_version.create({
      data: {
        template_cd: input.templateId,
        version_no: input.versionNo,
        renderer_key: input.rendererKey,
        default_config: input.defaultConfig,
        release_note: null,
        current_flag: input.currentFlag,
        active_flag: input.activeFlag,
        created_by: input.createdBy,
        changed_by: input.changedBy,
        changed_dt: input.changedAt,
        deleted_flag: false,
      },
    });
    return toVersion(row);
  }

  async updateVersion(versionId, changes, audit) {
    const row = await this.prisma.tb_m_template_version.update({
      where: { template_version_cd: versionId },
      data: {
        ...mapVersionChanges(changes),
        changed_by: audit.changedBy,
        changed_dt: audit.changedAt,
      },
    });
    return toVersion(row);
  }
}

function mapTemplateChanges(changes) {
  const fieldMap = {
    templateName: 'template_name',
    invitationTypeId: 'invitation_type_cd',
    categoryId: 'template_category_cd',
    description: 'description',
    thumbnailUrl: 'thumbnail_url',
    premiumFlag: 'premium_flag',
    activeFlag: 'active_flag',
    sortOrder: 'sort_order',
    deletedFlag: 'deleted_flag',
    deletedBy: 'deleted_by',
    deletedAt: 'deleted_dt',
  };
  return mapChanges(changes, fieldMap);
}

function mapVersionChanges(changes) {
  const fieldMap = {
    rendererKey: 'renderer_key',
    defaultConfig: 'default_config',
    currentFlag: 'current_flag',
    activeFlag: 'active_flag',
    deletedFlag: 'deleted_flag',
    deletedBy: 'deleted_by',
    deletedAt: 'deleted_dt',
  };
  return mapChanges(changes, fieldMap);
}

function mapChanges(changes, fieldMap) {
  const data = {};
  for (const [domainField, databaseField] of Object.entries(fieldMap)) {
    if (Object.hasOwn(changes, domainField)) data[databaseField] = changes[domainField];
  }
  return data;
}

function toInvitationType(row) {
  return {
    invitationTypeId: row.invitation_type_cd,
    typeKey: row.type_key,
    activeFlag: row.active_flag,
    deletedFlag: row.deleted_flag,
  };
}

function toCategory(row) {
  return {
    categoryId: row.template_category_cd,
    categoryKey: row.category_key,
    activeFlag: row.active_flag,
    deletedFlag: row.deleted_flag,
  };
}

function toTemplate(row) {
  return {
    templateId: row.template_cd,
    templateKey: row.template_key,
    templateName: row.template_name,
    invitationTypeId: row.invitation_type_cd,
    categoryId: row.template_category_cd,
    description: row.description,
    thumbnailUrl: row.thumbnail_url,
    previewUrl: row.preview_url,
    premiumFlag: row.premium_flag,
    activeFlag: row.active_flag,
    sortOrder: row.sort_order,
    createdBy: row.created_by,
    deletedFlag: row.deleted_flag,
    deletedBy: row.deleted_by,
    deletedAt: row.deleted_dt,
  };
}

function toVersion(row) {
  return {
    versionId: row.template_version_cd,
    templateId: row.template_cd,
    versionNo: row.version_no,
    rendererKey: row.renderer_key,
    defaultConfig: row.default_config,
    currentFlag: row.current_flag,
    activeFlag: row.active_flag,
    createdBy: row.created_by,
    deletedFlag: row.deleted_flag,
    deletedBy: row.deleted_by,
    deletedAt: row.deleted_dt,
  };
}
