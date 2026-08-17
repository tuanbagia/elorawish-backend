import { describe, expect, it, vi } from 'vitest';
import { PrismaTemplateCatalogRepository } from '../src/modules/template/template-catalog.repository.js';

function templateRow() {
  return {
    template_cd: 'TPL-generated',
    template_key: 'SUNDAY_BLOOM',
    template_name: 'Sunday Bloom',
    invitation_type_cd: 'resolved-type',
    template_category_cd: 'resolved-category',
    description: 'Bright botanical wedding',
    thumbnail_url: '/template-thumbnails/sunday-bloom.svg',
    preview_url: null,
    premium_flag: false,
    active_flag: true,
    sort_order: 1,
    created_by: 'DEV_SEED',
    deleted_flag: false,
    deleted_by: null,
    deleted_dt: null,
  };
}

function versionRow() {
  return {
    template_version_cd: 'TPV-generated',
    template_cd: 'TPL-generated',
    version_no: '1.0.0',
    renderer_key: 'sunday-bloom',
    default_config: { theme: 'sunday-bloom' },
    current_flag: true,
    active_flag: true,
    created_by: 'DEV_SEED',
    deleted_flag: false,
    deleted_by: null,
    deleted_dt: null,
  };
}

describe('PrismaTemplateCatalogRepository authoritative mapping', () => {
  it('resolves invitation type and categories by business key', async () => {
    const typeDelegate = {
      findUnique: vi.fn().mockResolvedValue({
        invitation_type_cd: 'resolved-type',
        type_key: 'WEDDING',
        active_flag: true,
        deleted_flag: false,
      }),
    };
    const categoryDelegate = {
      findMany: vi.fn().mockResolvedValue([{
        template_category_cd: 'resolved-category',
        category_key: 'FLORAL',
        active_flag: true,
        deleted_flag: false,
      }]),
    };
    const repository = new PrismaTemplateCatalogRepository({
      tb_m_invitation_type: typeDelegate,
      tb_m_template_category: categoryDelegate,
    });

    await expect(repository.findInvitationTypeByKey('WEDDING')).resolves.toMatchObject({
      invitationTypeId: 'resolved-type',
    });
    await expect(repository.findCategoriesByKeys(['FLORAL'])).resolves.toEqual([
      expect.objectContaining({ categoryId: 'resolved-category' }),
    ]);
    expect(typeDelegate.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { type_key: 'WEDDING' },
    }));
    expect(categoryDelegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { category_key: { in: ['FLORAL'] } },
    }));
  });

  it('omits database-generated template and version IDs on create', async () => {
    const templateDelegate = { create: vi.fn().mockResolvedValue(templateRow()) };
    const versionDelegate = { create: vi.fn().mockResolvedValue(versionRow()) };
    const repository = new PrismaTemplateCatalogRepository({
      tb_m_template: templateDelegate,
      tb_m_template_version: versionDelegate,
    });
    const changedAt = new Date('2026-08-17T09:00:00.000Z');

    await repository.createTemplate({
      templateKey: 'SUNDAY_BLOOM',
      templateName: 'Sunday Bloom',
      invitationTypeId: 'resolved-type',
      categoryId: 'resolved-category',
      description: 'Bright botanical wedding',
      thumbnailUrl: '/template-thumbnails/sunday-bloom.svg',
      previewUrl: null,
      premiumFlag: false,
      activeFlag: true,
      sortOrder: 1,
      createdBy: 'DEV_SEED',
      changedBy: 'DEV_SEED',
      changedAt,
    });
    await repository.createVersion({
      templateId: 'TPL-generated',
      versionNo: '1.0.0',
      rendererKey: 'sunday-bloom',
      defaultConfig: { theme: 'sunday-bloom' },
      currentFlag: true,
      activeFlag: true,
      createdBy: 'DEV_SEED',
      changedBy: 'DEV_SEED',
      changedAt,
    });

    const templateData = templateDelegate.create.mock.calls[0][0].data;
    const versionData = versionDelegate.create.mock.calls[0][0].data;
    expect(templateData).not.toHaveProperty('template_cd');
    expect(versionData).not.toHaveProperty('template_version_cd');
    expect(versionData).not.toHaveProperty('schema_config');
    expect(templateData).toMatchObject({ created_by: 'DEV_SEED', changed_by: 'DEV_SEED' });
    expect(versionData).toMatchObject({
      template_cd: 'TPL-generated',
      default_config: { theme: 'sunday-bloom' },
      created_by: 'DEV_SEED',
      changed_by: 'DEV_SEED',
    });
  });
});
