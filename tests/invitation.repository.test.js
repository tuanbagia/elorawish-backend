import { describe, expect, it, vi } from 'vitest';
import { PrismaInvitationRepository } from '../src/modules/invitation/invitation.repository.js';

describe('PrismaInvitationRepository catalog and ownership queries', () => {
  it('queries and maps only active, non-deleted templates with current versions', async () => {
    const delegate = { findMany: vi.fn().mockResolvedValue([catalogRow()]) };
    const repository = new PrismaInvitationRepository({ tb_m_invitation_type: delegate });

    const result = await repository.getCatalog();

    const query = delegate.findMany.mock.calls[0][0];
    expect(query.where).toMatchObject({
      active_flag: true,
      deleted_flag: false,
      tb_m_template: {
        some: {
          active_flag: true,
          deleted_flag: false,
          tb_m_template_version: {
            some: { active_flag: true, current_flag: true, deleted_flag: false },
          },
        },
      },
    });
    expect(query.select.tb_m_template.where).toMatchObject({
      active_flag: true,
      deleted_flag: false,
      tb_m_template_version: {
        some: { active_flag: true, current_flag: true, deleted_flag: false },
      },
    });
    expect(query.select.tb_m_template.select.tb_m_template_version.where).toEqual({
      active_flag: true,
      current_flag: true,
      deleted_flag: false,
    });
    expect(result[0].templates[0]).toMatchObject({
      key: 'SUNDAY_BLOOM',
      currentVersion: { id: 'TPV-001', rendererKey: 'sunday-bloom' },
    });
    expect(result[0].templates[0]).not.toHaveProperty('createdBy');
  });

  it('validates type/template/version state in one authoritative lookup', async () => {
    const delegate = {
      findFirst: vi.fn().mockResolvedValue({
        template_version_cd: 'TPV-001',
        tb_m_template: { invitation_type_cd: 'ITY-001' },
      }),
    };
    const repository = new PrismaInvitationRepository({ tb_m_template_version: delegate });

    await expect(repository.findUsableTemplateVersion('WEDDING', 'TPV-001')).resolves.toEqual({
      invitationTypeId: 'ITY-001',
      templateVersionId: 'TPV-001',
    });
    expect(delegate.findFirst.mock.calls[0][0].where).toMatchObject({
      template_version_cd: 'TPV-001',
      active_flag: true,
      current_flag: true,
      deleted_flag: false,
      tb_m_template: {
        is: {
          active_flag: true,
          deleted_flag: false,
          tb_m_invitation_type: {
            is: { type_key: 'WEDDING', active_flag: true, deleted_flag: false },
          },
        },
      },
    });
  });

  it('filters list and detail by owner and soft-delete inside Prisma queries', async () => {
    const delegate = {
      findMany: vi.fn().mockResolvedValue([invitationRow()]),
      findFirst: vi.fn().mockResolvedValue(invitationRow()),
    };
    const repository = new PrismaInvitationRepository({ tb_r_invitation_h: delegate });

    await repository.findAllOwnedBy('USR-CLIENT');
    await repository.findOwnedById('USR-CLIENT', 'INV-001');

    expect(delegate.findMany.mock.calls[0][0].where).toEqual({
      user_id: 'USR-CLIENT',
      deleted_flag: false,
    });
    expect(delegate.findFirst.mock.calls[0][0].where).toEqual({
      invitation_id: 'INV-001',
      user_id: 'USR-CLIENT',
      deleted_flag: false,
    });
  });
});

describe('PrismaInvitationRepository atomic creation', () => {
  it('creates header, two people, and event in one transaction without supplied IDs', async () => {
    const database = transactionDatabase();
    const repository = new PrismaInvitationRepository(database.prisma);

    const created = await repository.createAtomic(createInput());

    expect(database.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(database.state.headers).toHaveLength(1);
    expect(database.state.people).toHaveLength(2);
    expect(database.state.events).toHaveLength(1);
    expect(created).toMatchObject({ id: 'INV-generated', status: 'DRAFT' });

    const header = database.state.headers[0];
    expect(header).toMatchObject({
      user_id: 'USR-CLIENT',
      invitation_type_cd: 'ITY-resolved',
      template_version_cd: 'TPV-resolved',
      status_cd: 'DRAFT',
      music_autoplay_flag: false,
      created_by: 'USR-CLIENT',
      changed_by: 'USR-CLIENT',
      deleted_flag: false,
    });
    expect(header).not.toHaveProperty('invitation_id');
    expect(header).not.toHaveProperty('theme_config');
    expect(header).not.toHaveProperty('seo_config');

    expect(database.state.people.map((person) => person.person_role_cd)).toEqual([
      'GROOM',
      'BRIDE',
    ]);
    for (const person of database.state.people) {
      expect(person).not.toHaveProperty('invitation_person_id');
      expect(person).not.toHaveProperty('additional_data');
      expect(person).toMatchObject({
        invitation_id: 'INV-generated',
        created_by: 'USR-CLIENT',
        changed_by: 'USR-CLIENT',
      });
    }

    expect(database.state.events[0]).toMatchObject({
      invitation_id: 'INV-generated',
      event_type_cd: 'WEDDING',
      timezone: 'Asia/Jakarta',
      sort_order: 1,
      active_flag: true,
      created_by: 'USR-CLIENT',
      changed_by: 'USR-CLIENT',
    });
    expect(database.state.events[0]).not.toHaveProperty('invitation_event_id');
  });

  it('rolls back the complete transaction when a child insert fails', async () => {
    const database = transactionDatabase({ failEvent: true });
    const repository = new PrismaInvitationRepository(database.prisma);

    await expect(repository.createAtomic(createInput())).rejects.toThrow('child failure');
    expect(database.state.headers).toHaveLength(0);
    expect(database.state.people).toHaveLength(0);
    expect(database.state.events).toHaveLength(0);
  });
});

describe('PrismaInvitationRepository atomic draft update', () => {
  it('updates header and stable child IDs in one transaction with one audit timestamp', async () => {
    const database = updateDatabase();
    const repository = new PrismaInvitationRepository(database.prisma);
    const updated = await repository.updateAtomic(updateInput());

    expect(database.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(updated).toMatchObject({
      id: 'INV-generated',
      title: 'Updated Raka & Nadia',
      updatedAt: '2026-08-17T10:00:00.000Z',
      template: { id: 'TPL-001', versionId: 'TPV-resolved', version: '1.0.0' },
    });
    expect(database.state.header.invitation_id).toBe('INV-generated');
    expect(database.state.header.user_id).toBe('USR-CLIENT');
    expect(database.state.header.status_cd).toBe('DRAFT');
    expect(database.state.header.created_by).toBe('ORIGINAL-CREATOR');
    expect(database.state.people.map((person) => person.invitation_person_id)).toEqual([
      'PRS-001',
      'PRS-002',
    ]);
    expect(database.state.event.invitation_event_id).toBe('EVT-001');

    const writes = [
      database.calls.header.data,
      ...database.calls.people.map((call) => call.data),
      database.calls.event.data,
    ];
    for (const data of writes) {
      expect(data.changed_by).toBe('USR-CLIENT');
      expect(data.changed_dt).toEqual(new Date('2026-08-17T10:00:00.000Z'));
      expect(data).not.toHaveProperty('created_by');
      expect(data).not.toHaveProperty('created_dt');
      expect(data).not.toHaveProperty('user_id');
      expect(data).not.toHaveProperty('status_cd');
    }
  });

  it('represents two tabs and rejects the stale tab without changing newer data', async () => {
    const database = updateDatabase();
    const repository = new PrismaInvitationRepository(database.prisma);
    await repository.updateAtomic(updateInput({ title: 'Tab A saved' }));
    const afterTabA = structuredClone(database.state);

    await expect(repository.updateAtomic(updateInput({ title: 'Tab B stale overwrite' })))
      .rejects.toMatchObject({ code: 'EDIT_CONFLICT', statusCode: 409 });
    expect(database.state).toEqual(afterTabA);
  });

  it('uses createdAt as the token when changed_dt is null', async () => {
    const database = updateDatabase({ nullChangedAt: true });
    const repository = new PrismaInvitationRepository(database.prisma);
    const updated = await repository.updateAtomic(updateInput({
      expectedUpdatedAt: '2026-08-17T08:00:00.000Z',
    }));

    expect(updated.updatedAt).toBe('2026-08-17T10:00:00.000Z');
    expect(database.calls.header.where).toMatchObject({ changed_dt: null });
    expect(database.calls.header.where).not.toHaveProperty('created_dt');
  });

  it('rolls back the header when a required child update fails', async () => {
    const database = updateDatabase({ failPersonUpdate: true });
    const repository = new PrismaInvitationRepository(database.prisma);
    const before = structuredClone(database.state);

    await expect(repository.updateAtomic(updateInput()))
      .rejects.toMatchObject({ code: 'INVITATION_STRUCTURE_INVALID' });
    expect(database.state).toEqual(before);
  });

  it('rejects structurally inconsistent children before writing', async () => {
    const database = updateDatabase({ missingBride: true });
    const repository = new PrismaInvitationRepository(database.prisma);

    await expect(repository.updateAtomic(updateInput()))
      .rejects.toMatchObject({ code: 'INVITATION_STRUCTURE_INVALID' });
    expect(database.calls.header).toBeNull();
  });

  it('rejects an unavailable template inside the transaction before writing', async () => {
    const database = updateDatabase({ invalidTemplate: true });
    const repository = new PrismaInvitationRepository(database.prisma);

    await expect(repository.updateAtomic(updateInput()))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(database.calls.header).toBeNull();
  });

  it('allows the current slug and maps another invitation slug through Prisma P2002', async () => {
    const database = updateDatabase();
    const repository = new PrismaInvitationRepository(database.prisma);
    await expect(repository.updateAtomic(updateInput({ slug: 'raka-nadia' }))).resolves.toBeTruthy();

    const duplicate = updateDatabase({ slugConflict: true });
    await expect(new PrismaInvitationRepository(duplicate.prisma).updateAtomic(updateInput({
      slug: 'owned-by-another-invitation',
    }))).rejects.toMatchObject({ code: 'P2002' });
  });
});

function transactionDatabase({ failEvent = false } = {}) {
  const state = { headers: [], people: [], events: [] };
  const transaction = {
    tb_r_invitation_h: {
      create: vi.fn(async ({ data }) => {
        state.headers.push(data);
        return { invitation_id: 'INV-generated' };
      }),
      findFirst: vi.fn(async () => invitationRow()),
    },
    tb_r_invitation_person: {
      create: vi.fn(async ({ data }) => {
        state.people.push(data);
        return {};
      }),
    },
    tb_r_invitation_event: {
      create: vi.fn(async ({ data }) => {
        if (failEvent) throw new Error('child failure');
        state.events.push(data);
        return {};
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work) => {
      const snapshot = {
        headers: [...state.headers],
        people: [...state.people],
        events: [...state.events],
      };
      try {
        return await work(transaction);
      } catch (error) {
        state.headers.splice(0, state.headers.length, ...snapshot.headers);
        state.people.splice(0, state.people.length, ...snapshot.people);
        state.events.splice(0, state.events.length, ...snapshot.events);
        throw error;
      }
    }),
  };
  return { prisma, state };
}

function createInput() {
  return {
    userId: 'USR-CLIENT',
    invitationTypeId: 'ITY-resolved',
    templateVersionId: 'TPV-resolved',
    title: 'Raka & Nadia',
    slug: 'raka-nadia',
    openingTitle: null,
    openingMessage: null,
    closingMessage: null,
    people: [
      {
        role: 'BRIDE',
        displayName: 'Nadia',
        fullName: null,
        fatherName: null,
        motherName: null,
      },
      {
        role: 'GROOM',
        displayName: 'Raka',
        fullName: null,
        fatherName: null,
        motherName: null,
      },
    ],
    event: {
      title: 'Wedding Celebration',
      date: '2026-12-12',
      startTime: '10:00',
      endTime: '13:00',
      venueName: 'Ubud Garden',
      venueAddress: 'Bali, Indonesia',
      mapUrl: null,
    },
    now: new Date('2026-08-17T09:00:00.000Z'),
  };
}

function updateInput(overrides = {}) {
  return {
    ...createInput(),
    invitationId: 'INV-generated',
    invitationTypeKey: 'WEDDING',
    templateVersionId: 'TPV-resolved',
    expectedUpdatedAt: '2026-08-17T09:00:00.000Z',
    title: 'Updated Raka & Nadia',
    now: new Date('2026-08-17T10:00:00.000Z'),
    ...overrides,
  };
}

function updateDatabase({
  failPersonUpdate = false,
  invalidTemplate = false,
  missingBride = false,
  nullChangedAt = false,
  slugConflict = false,
} = {}) {
  const state = {
    header: {
      invitation_id: 'INV-generated',
      user_id: 'USR-CLIENT',
      invitation_type_cd: 'ITY-resolved',
      template_version_cd: 'TPV-old',
      title: 'Raka & Nadia',
      slug: 'raka-nadia',
      status_cd: 'DRAFT',
      opening_title: null,
      opening_message: null,
      closing_message: null,
      created_by: 'ORIGINAL-CREATOR',
      created_dt: new Date('2026-08-17T08:00:00.000Z'),
      changed_by: 'USR-CLIENT',
      changed_dt: nullChangedAt ? null : new Date('2026-08-17T09:00:00.000Z'),
      deleted_flag: false,
    },
    people: [
      { invitation_person_id: 'PRS-001', invitation_id: 'INV-generated', person_role_cd: 'GROOM', display_name: 'Raka', deleted_flag: false },
      ...(!missingBride ? [{ invitation_person_id: 'PRS-002', invitation_id: 'INV-generated', person_role_cd: 'BRIDE', display_name: 'Nadia', deleted_flag: false }] : []),
    ],
    event: { invitation_event_id: 'EVT-001', invitation_id: 'INV-generated', active_flag: true, deleted_flag: false },
  };
  const calls = { header: null, people: [], event: null };
  const transaction = {
    tb_m_template_version: {
      findFirst: vi.fn(async () => invalidTemplate ? null : ({
        template_version_cd: 'TPV-resolved',
        tb_m_template: { invitation_type_cd: 'ITY-resolved' },
      })),
    },
    tb_r_invitation_h: {
      findFirst: vi.fn(async ({ select }) => {
        if (select.invitation_type_cd) {
          return {
            invitation_id: state.header.invitation_id,
            invitation_type_cd: state.header.invitation_type_cd,
            status_cd: state.header.status_cd,
            created_dt: state.header.created_dt,
            changed_dt: state.header.changed_dt,
            tb_r_invitation_person: state.people.map((person) => ({
              invitation_person_id: person.invitation_person_id,
              person_role_cd: person.person_role_cd,
              deleted_flag: person.deleted_flag,
            })),
            tb_r_invitation_event: [{
              invitation_event_id: state.event.invitation_event_id,
              active_flag: state.event.active_flag,
              deleted_flag: state.event.deleted_flag,
            }],
          };
        }
        return invitationRow({
          title: state.header.title,
          slug: state.header.slug,
          changed_dt: state.header.changed_dt,
        });
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        calls.header = { where, data };
        if (
          (state.header.changed_dt === null) !== (where.changed_dt === null) ||
          (state.header.changed_dt && state.header.changed_dt.getTime() !== where.changed_dt.getTime())
        ) return { count: 0 };
        if (slugConflict) {
          throw Object.assign(new Error('database detail'), {
            code: 'P2002',
            meta: { target: ['slug'] },
          });
        }
        Object.assign(state.header, data);
        return { count: 1 };
      }),
    },
    tb_r_invitation_person: {
      updateMany: vi.fn(async ({ where, data }) => {
        calls.people.push({ where, data });
        if (failPersonUpdate) return { count: 0 };
        const person = state.people.find((item) => item.invitation_person_id === where.invitation_person_id);
        if (!person) return { count: 0 };
        Object.assign(person, data);
        return { count: 1 };
      }),
    },
    tb_r_invitation_event: {
      updateMany: vi.fn(async ({ where, data }) => {
        calls.event = { where, data };
        Object.assign(state.event, data);
        return { count: 1 };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work) => {
      const snapshot = structuredClone(state);
      try {
        return await work(transaction);
      } catch (error) {
        state.header = snapshot.header;
        state.people = snapshot.people;
        state.event = snapshot.event;
        throw error;
      }
    }),
  };
  return { prisma, state, calls };
}

function catalogRow() {
  return {
    invitation_type_cd: 'ITY-001',
    type_key: 'WEDDING',
    type_name: 'Wedding',
    description: 'Undangan pernikahan',
    tb_m_template: [{
      template_cd: 'TPL-001',
      template_key: 'SUNDAY_BLOOM',
      template_name: 'Sunday Bloom',
      description: 'Bright botanical wedding',
      thumbnail_url: '/template-thumbnails/sunday-bloom.svg',
      premium_flag: false,
      tb_m_template_category: {
        template_category_cd: 'TPC-001',
        category_key: 'FLORAL',
        category_name: 'Floral',
      },
      tb_m_template_version: [{
        template_version_cd: 'TPV-001',
        version_no: '1.0.0',
        renderer_key: 'sunday-bloom',
        default_config: { theme: 'sunday-bloom' },
      }],
    }],
  };
}

function invitationRow(overrides = {}) {
  return {
    invitation_id: 'INV-generated',
    title: 'Raka & Nadia',
    slug: 'raka-nadia',
    status_cd: 'DRAFT',
    opening_title: null,
    opening_message: null,
    closing_message: null,
    created_dt: new Date('2026-08-17T09:00:00.000Z'),
    changed_dt: new Date('2026-08-17T09:00:00.000Z'),
    tb_m_invitation_type: { type_key: 'WEDDING', type_name: 'Wedding' },
    tb_m_template_version: {
      template_version_cd: 'TPV-resolved',
      version_no: '1.0.0',
      renderer_key: 'sunday-bloom',
      tb_m_template: {
        template_cd: 'TPL-001',
        template_key: 'SUNDAY_BLOOM',
        template_name: 'Sunday Bloom',
        thumbnail_url: '/template-thumbnails/sunday-bloom.svg',
      },
    },
    tb_r_invitation_person: [
      {
        invitation_person_id: 'PRS-001',
        person_role_cd: 'GROOM',
        display_name: 'Raka',
        full_name: null,
        father_name: null,
        mother_name: null,
      },
      {
        invitation_person_id: 'PRS-002',
        person_role_cd: 'BRIDE',
        display_name: 'Nadia',
        full_name: null,
        father_name: null,
        mother_name: null,
      },
    ],
    tb_r_invitation_event: [{
      invitation_event_id: 'EVT-001',
      event_type_cd: 'WEDDING',
      event_title: 'Wedding Celebration',
      event_date: new Date('2026-12-12T00:00:00.000Z'),
      start_time: new Date('1970-01-01T10:00:00.000Z'),
      end_time: new Date('1970-01-01T13:00:00.000Z'),
      timezone: 'Asia/Jakarta',
      venue_name: 'Ubud Garden',
      venue_address: 'Bali, Indonesia',
      map_url: null,
    }],
    ...overrides,
  };
}
