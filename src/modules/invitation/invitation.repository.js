const invitationSelection = {
  invitation_id: true,
  title: true,
  slug: true,
  status_cd: true,
  opening_title: true,
  opening_message: true,
  closing_message: true,
  created_dt: true,
  changed_dt: true,
  tb_m_invitation_type: {
    select: { type_key: true, type_name: true },
  },
  tb_m_template_version: {
    select: {
      renderer_key: true,
      tb_m_template: {
        select: {
          template_key: true,
          template_name: true,
          thumbnail_url: true,
        },
      },
    },
  },
  tb_r_invitation_person: {
    where: { deleted_flag: false },
    orderBy: { sort_order: 'asc' },
    select: {
      invitation_person_id: true,
      person_role_cd: true,
      display_name: true,
      full_name: true,
      father_name: true,
      mother_name: true,
    },
  },
  tb_r_invitation_event: {
    where: { deleted_flag: false, active_flag: true },
    orderBy: { sort_order: 'asc' },
    select: {
      invitation_event_id: true,
      event_type_cd: true,
      event_title: true,
      event_date: true,
      start_time: true,
      end_time: true,
      timezone: true,
      venue_name: true,
      venue_address: true,
      map_url: true,
    },
  },
};

export class PrismaInvitationRepository {
  constructor(prisma) {
    this.prisma = prisma;
  }

  async getCatalog() {
    const rows = await this.prisma.tb_m_invitation_type.findMany({
      where: {
        active_flag: true,
        deleted_flag: false,
        tb_m_template: {
          some: {
            active_flag: true,
            deleted_flag: false,
            tb_m_template_category: {
              is: { active_flag: true, deleted_flag: false },
            },
            tb_m_template_version: {
              some: { active_flag: true, current_flag: true, deleted_flag: false },
            },
          },
        },
      },
      orderBy: { sort_order: 'asc' },
      select: {
        invitation_type_cd: true,
        type_key: true,
        type_name: true,
        description: true,
        tb_m_template: {
          where: {
            active_flag: true,
            deleted_flag: false,
            tb_m_template_category: {
              is: { active_flag: true, deleted_flag: false },
            },
            tb_m_template_version: {
              some: { active_flag: true, current_flag: true, deleted_flag: false },
            },
          },
          orderBy: { sort_order: 'asc' },
          select: {
            template_cd: true,
            template_key: true,
            template_name: true,
            description: true,
            thumbnail_url: true,
            premium_flag: true,
            tb_m_template_category: {
              select: {
                template_category_cd: true,
                category_key: true,
                category_name: true,
              },
            },
            tb_m_template_version: {
              where: { active_flag: true, current_flag: true, deleted_flag: false },
              take: 1,
              select: {
                template_version_cd: true,
                version_no: true,
                renderer_key: true,
                default_config: true,
              },
            },
          },
        },
      },
    });
    return rows.map(toCatalogType);
  }

  async findUsableTemplateVersion(invitationTypeKey, templateVersionId) {
    const row = await this.prisma.tb_m_template_version.findFirst({
      where: {
        template_version_cd: templateVersionId,
        active_flag: true,
        current_flag: true,
        deleted_flag: false,
        tb_m_template: {
          is: {
            active_flag: true,
            deleted_flag: false,
            tb_m_invitation_type: {
              is: {
                type_key: invitationTypeKey,
                active_flag: true,
                deleted_flag: false,
              },
            },
          },
        },
      },
      select: {
        template_version_cd: true,
        tb_m_template: { select: { invitation_type_cd: true } },
      },
    });
    if (!row) return null;
    return {
      templateVersionId: row.template_version_cd,
      invitationTypeId: row.tb_m_template.invitation_type_cd,
    };
  }

  async findAllOwnedBy(userId) {
    const rows = await this.prisma.tb_r_invitation_h.findMany({
      where: { user_id: userId, deleted_flag: false },
      orderBy: [
        { changed_dt: { sort: 'desc', nulls: 'last' } },
        { created_dt: 'desc' },
      ],
      select: invitationSelection,
    });
    return rows.map(toInvitation);
  }

  async findOwnedById(userId, invitationId) {
    const row = await this.prisma.tb_r_invitation_h.findFirst({
      where: {
        invitation_id: invitationId,
        user_id: userId,
        deleted_flag: false,
      },
      select: invitationSelection,
    });
    return row ? toInvitation(row) : null;
  }

  createAtomic(input) {
    return this.prisma.$transaction(async (transaction) => {
      const header = await transaction.tb_r_invitation_h.create({
        data: {
          user_id: input.userId,
          invitation_type_cd: input.invitationTypeId,
          template_version_cd: input.templateVersionId,
          title: input.title,
          slug: input.slug,
          status_cd: 'DRAFT',
          opening_title: input.openingTitle,
          opening_message: input.openingMessage,
          closing_message: input.closingMessage,
          music_autoplay_flag: false,
          created_by: input.userId,
          changed_by: input.userId,
          changed_dt: input.now,
          deleted_flag: false,
        },
        select: { invitation_id: true },
      });

      const people = [...input.people].sort(
        (left, right) => personOrder(left.role) - personOrder(right.role),
      );
      for (const person of people) {
        await transaction.tb_r_invitation_person.create({
          data: {
            invitation_id: header.invitation_id,
            person_role_cd: person.role,
            display_name: person.displayName,
            full_name: person.fullName,
            gender_cd: person.role === 'GROOM' ? 'MALE' : 'FEMALE',
            father_name: person.fatherName,
            mother_name: person.motherName,
            sort_order: personOrder(person.role),
            created_by: input.userId,
            changed_by: input.userId,
            changed_dt: input.now,
            deleted_flag: false,
          },
        });
      }

      await transaction.tb_r_invitation_event.create({
        data: {
          invitation_id: header.invitation_id,
          event_type_cd: 'WEDDING',
          event_title: input.event.title,
          event_date: dateValue(input.event.date),
          start_time: timeValue(input.event.startTime),
          end_time: timeValue(input.event.endTime),
          timezone: 'Asia/Jakarta',
          venue_name: input.event.venueName,
          venue_address: input.event.venueAddress,
          map_url: input.event.mapUrl,
          sort_order: 1,
          active_flag: true,
          created_by: input.userId,
          changed_by: input.userId,
          changed_dt: input.now,
          deleted_flag: false,
        },
      });

      const created = await transaction.tb_r_invitation_h.findFirst({
        where: {
          invitation_id: header.invitation_id,
          user_id: input.userId,
          deleted_flag: false,
        },
        select: invitationSelection,
      });
      return toInvitation(created);
    });
  }
}

function toCatalogType(row) {
  return {
    id: row.invitation_type_cd,
    key: row.type_key,
    name: row.type_name,
    description: row.description,
    templates: row.tb_m_template.map((template) => {
      const version = template.tb_m_template_version[0];
      return {
        id: template.template_cd,
        key: template.template_key,
        name: template.template_name,
        description: template.description,
        thumbnailUrl: template.thumbnail_url,
        premium: template.premium_flag,
        category: {
          id: template.tb_m_template_category.template_category_cd,
          key: template.tb_m_template_category.category_key,
          name: template.tb_m_template_category.category_name,
        },
        currentVersion: {
          id: version.template_version_cd,
          version: version.version_no,
          rendererKey: version.renderer_key,
          defaultConfig: version.default_config,
        },
      };
    }),
  };
}

function toInvitation(row) {
  const template = row.tb_m_template_version.tb_m_template;
  return {
    id: row.invitation_id,
    title: row.title,
    slug: row.slug,
    status: row.status_cd,
    openingTitle: row.opening_title,
    openingMessage: row.opening_message,
    closingMessage: row.closing_message,
    createdAt: row.created_dt.toISOString(),
    updatedAt: (row.changed_dt ?? row.created_dt).toISOString(),
    invitationType: {
      key: row.tb_m_invitation_type.type_key,
      name: row.tb_m_invitation_type.type_name,
    },
    template: {
      key: template.template_key,
      name: template.template_name,
      thumbnailUrl: template.thumbnail_url,
      rendererKey: row.tb_m_template_version.renderer_key,
    },
    people: row.tb_r_invitation_person.map((person) => ({
      id: person.invitation_person_id,
      role: person.person_role_cd,
      displayName: person.display_name,
      fullName: person.full_name,
      fatherName: person.father_name,
      motherName: person.mother_name,
    })),
    events: row.tb_r_invitation_event.map((event) => ({
      id: event.invitation_event_id,
      type: event.event_type_cd,
      title: event.event_title,
      date: dateText(event.event_date),
      startTime: timeText(event.start_time),
      endTime: timeText(event.end_time),
      timezone: event.timezone,
      venueName: event.venue_name,
      venueAddress: event.venue_address,
      mapUrl: event.map_url,
    })),
  };
}

function personOrder(role) {
  return role === 'GROOM' ? 1 : 2;
}

function dateValue(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function timeValue(value) {
  return value ? new Date(`1970-01-01T${value}:00.000Z`) : null;
}

function dateText(value) {
  return value.toISOString().slice(0, 10);
}

function timeText(value) {
  return value ? value.toISOString().slice(11, 16) : null;
}
