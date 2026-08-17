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

function invitationRow() {
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
      renderer_key: 'sunday-bloom',
      tb_m_template: {
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
  };
}
