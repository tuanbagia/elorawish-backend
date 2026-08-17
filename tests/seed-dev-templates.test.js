import { describe, expect, it, vi } from 'vitest';
import {
  assertTemplateSeedEnvironment,
  DEVELOPMENT_TEMPLATE_ACTOR,
  DEVELOPMENT_TEMPLATES,
  REQUIRED_CATEGORY_KEYS,
  seedDevelopmentTemplates,
} from '../scripts/seed-dev-templates.js';

const TYPE_ID = 'resolved-wedding-type';

function categoryId(categoryKey) {
  return `resolved-category-${categoryKey.toLowerCase()}`;
}

function setup({ withTemplates = false, withVersions = false } = {}) {
  const templates = new Map();
  const versions = new Map();
  const unrelatedTemplate = {
    templateId: 'unrelated-template',
    templateKey: 'UNRELATED_TEMPLATE',
    createdBy: 'OTHER_OWNER',
  };
  const unrelatedVersion = {
    versionId: 'unrelated-version',
    templateId: unrelatedTemplate.templateId,
    versionNo: '9.9.9',
    rendererKey: 'unrelated-renderer',
    currentFlag: true,
    activeFlag: true,
    deletedFlag: false,
    createdBy: 'OTHER_OWNER',
  };
  templates.set(unrelatedTemplate.templateKey, unrelatedTemplate);
  versions.set(versionKey(unrelatedVersion.templateId, unrelatedVersion.versionNo), unrelatedVersion);

  if (withTemplates) {
    for (const definition of DEVELOPMENT_TEMPLATES) {
      const row = matchingTemplate(definition);
      templates.set(row.templateKey, row);
      if (withVersions) {
        const version = matchingVersion(definition, row.templateId);
        versions.set(versionKey(row.templateId, version.versionNo), version);
      }
    }
  }

  const createInvitation = vi.fn();
  let repository;
  repository = {
    transaction: vi.fn(async (work) => work(repository)),
    findInvitationTypeByKey: vi.fn(async (typeKey) => ({
      invitationTypeId: TYPE_ID,
      typeKey,
      activeFlag: true,
      deletedFlag: false,
    })),
    findCategoriesByKeys: vi.fn(async (keys) => keys.map((key) => ({
      categoryId: categoryId(key),
      categoryKey: key,
      activeFlag: true,
      deletedFlag: false,
    }))),
    findTemplateByKey: vi.fn(async (key) => templates.get(key) ?? null),
    createTemplate: vi.fn(async (input) => {
      const row = {
        templateId: `generated-template-${templates.size}`,
        createdBy: input.createdBy,
        deletedFlag: false,
        deletedBy: null,
        deletedAt: null,
        ...input,
      };
      templates.set(row.templateKey, row);
      return row;
    }),
    updateTemplate: vi.fn(async (templateId, changes) => {
      const row = [...templates.values()].find((candidate) => candidate.templateId === templateId);
      Object.assign(row, changes);
      return row;
    }),
    findVersionByNumber: vi.fn(async (templateId, versionNo) =>
      versions.get(versionKey(templateId, versionNo)) ?? null),
    findActiveCurrentVersions: vi.fn(async (templateId) =>
      [...versions.values()].filter((version) =>
        version.templateId === templateId &&
        version.currentFlag &&
        version.activeFlag &&
        !version.deletedFlag)),
    createVersion: vi.fn(async (input) => {
      const row = {
        versionId: `generated-version-${versions.size + 1}`,
        createdBy: input.createdBy,
        deletedFlag: false,
        deletedBy: null,
        deletedAt: null,
        ...input,
      };
      versions.set(versionKey(row.templateId, row.versionNo), row);
      return row;
    }),
    updateVersion: vi.fn(async (versionId, changes) => {
      const row = [...versions.values()].find((candidate) => candidate.versionId === versionId);
      Object.assign(row, changes);
      return row;
    }),
    createInvitation,
  };
  return {
    createInvitation,
    repository,
    templates,
    unrelatedTemplate,
    unrelatedVersion,
    versions,
  };
}

describe('development template seed', () => {
  it('refuses production execution', () => {
    expect(() => assertTemplateSeedEnvironment('production')).toThrow(/disabled/);
    expect(() => assertTemplateSeedEnvironment('development')).not.toThrow();
  });

  it('creates all six templates and versions through resolved master keys', async () => {
    const state = setup();
    const results = await seedDevelopmentTemplates({ repository: state.repository });

    expect(results).toHaveLength(6);
    expect(results.every(({ template, version }) =>
      template.action === 'inserted' && version.action === 'inserted')).toBe(true);
    expect(state.repository.findInvitationTypeByKey).toHaveBeenCalledWith('WEDDING');
    expect(state.repository.findCategoriesByKeys).toHaveBeenCalledWith(REQUIRED_CATEGORY_KEYS);
    expect(state.repository.createTemplate).toHaveBeenCalledTimes(6);
    expect(state.repository.createVersion).toHaveBeenCalledTimes(6);

    for (const [index, definition] of DEVELOPMENT_TEMPLATES.entries()) {
      const templateInput = state.repository.createTemplate.mock.calls[index][0];
      const versionInput = state.repository.createVersion.mock.calls[index][0];
      expect(templateInput).toMatchObject({
        templateKey: definition.templateKey,
        invitationTypeId: TYPE_ID,
        categoryId: categoryId(definition.categoryKey),
        createdBy: DEVELOPMENT_TEMPLATE_ACTOR,
        changedBy: DEVELOPMENT_TEMPLATE_ACTOR,
      });
      expect(templateInput).not.toHaveProperty('templateId');
      expect(versionInput).toMatchObject({
        templateId: expect.any(String),
        rendererKey: definition.rendererKey,
        defaultConfig: { theme: definition.rendererKey },
        createdBy: DEVELOPMENT_TEMPLATE_ACTOR,
        changedBy: DEVELOPMENT_TEMPLATE_ACTOR,
      });
      expect(versionInput).not.toHaveProperty('versionId');
    }
  });

  it('is idempotent when rerun against matching rows', async () => {
    const state = setup({ withTemplates: true, withVersions: true });
    const results = await seedDevelopmentTemplates({ repository: state.repository });

    expect(results.every(({ template, version }) =>
      template.action === 'unchanged' && version.action === 'unchanged')).toBe(true);
    expect(state.repository.createTemplate).not.toHaveBeenCalled();
    expect(state.repository.updateTemplate).not.toHaveBeenCalled();
    expect(state.repository.createVersion).not.toHaveBeenCalled();
    expect(state.repository.updateVersion).not.toHaveBeenCalled();
  });

  it('reconciles mismatched controlled fields and soft-delete state', async () => {
    const state = setup({ withTemplates: true, withVersions: true });
    const template = state.templates.get('SUNDAY_BLOOM');
    template.description = 'Wrong description';
    template.activeFlag = false;
    template.deletedFlag = true;
    template.deletedBy = 'someone';
    template.deletedAt = new Date();
    const version = state.versions.get(versionKey(template.templateId, '1.0.0'));
    version.rendererKey = 'wrong-renderer';
    version.currentFlag = false;
    version.activeFlag = false;
    version.deletedFlag = true;

    const results = await seedDevelopmentTemplates({ repository: state.repository });

    expect(results[0].template).toMatchObject({
      action: 'updated',
      fields: expect.arrayContaining(['description', 'activeFlag', 'deletedFlag', 'deletedBy', 'deletedAt']),
    });
    expect(results[0].version).toMatchObject({
      action: 'updated',
      fields: expect.arrayContaining(['rendererKey', 'currentFlag', 'activeFlag', 'deletedFlag']),
    });
    expect(template).toMatchObject({
      description: 'Bright botanical wedding',
      activeFlag: true,
      deletedFlag: false,
      deletedBy: null,
      deletedAt: null,
    });
  });

  it('creates version 1.0.0 when controlled templates already exist without versions', async () => {
    const state = setup({ withTemplates: true });
    const results = await seedDevelopmentTemplates({ repository: state.repository });

    expect(results.every(({ template, version }) =>
      template.action === 'unchanged' && version.action === 'inserted')).toBe(true);
    expect(state.repository.createTemplate).not.toHaveBeenCalled();
    expect(state.repository.createVersion).toHaveBeenCalledTimes(6);
  });

  it('fails safely for missing, inactive, or deleted required master data', async () => {
    const missingType = setup();
    missingType.repository.findInvitationTypeByKey.mockResolvedValue(null);
    await expect(seedDevelopmentTemplates({ repository: missingType.repository }))
      .rejects.toThrow(/WEDDING is missing/);

    const inactiveType = setup();
    inactiveType.repository.findInvitationTypeByKey.mockResolvedValue({
      invitationTypeId: TYPE_ID,
      typeKey: 'WEDDING',
      activeFlag: false,
      deletedFlag: false,
    });
    await expect(seedDevelopmentTemplates({ repository: inactiveType.repository }))
      .rejects.toThrow(/must be active/);

    const deletedCategory = setup();
    deletedCategory.repository.findCategoriesByKeys.mockImplementation(async (keys) =>
      keys.map((key) => ({
        categoryId: categoryId(key),
        categoryKey: key,
        activeFlag: true,
        deletedFlag: key === 'ISLAMIC',
      })));
    await expect(seedDevelopmentTemplates({ repository: deletedCategory.repository }))
      .rejects.toThrow(/ISLAMIC must be active/);
  });

  it('refuses to overwrite rows with conflicting ownership', async () => {
    const state = setup({ withTemplates: true });
    state.templates.get('SUNDAY_BLOOM').createdBy = 'OTHER_OWNER';

    await expect(seedDevelopmentTemplates({ repository: state.repository }))
      .rejects.toThrow(/not owned by DEV_SEED/);
    expect(state.repository.updateTemplate).not.toHaveBeenCalled();
  });

  it('leaves unrelated data untouched and never creates invitation transactions', async () => {
    const state = setup();
    await seedDevelopmentTemplates({ repository: state.repository });

    expect(state.templates.get('UNRELATED_TEMPLATE')).toBe(state.unrelatedTemplate);
    expect(state.versions.get(versionKey('unrelated-template', '9.9.9')))
      .toBe(state.unrelatedVersion);
    expect(state.createInvitation).not.toHaveBeenCalled();
  });

  it('uses only the six local thumbnail asset URLs', () => {
    expect(DEVELOPMENT_TEMPLATES.map(({ thumbnailUrl }) => thumbnailUrl)).toEqual([
      '/template-thumbnails/sunday-bloom.svg',
      '/template-thumbnails/afterglow.svg',
      '/template-thumbnails/paper-hearts.svg',
      '/template-thumbnails/midnight-kiss.svg',
      '/template-thumbnails/cherry-love.svg',
      '/template-thumbnails/soft-promise.svg',
    ]);
  });
});

function matchingTemplate(definition) {
  return {
    templateId: `generated-template-${definition.sortOrder}`,
    templateKey: definition.templateKey,
    templateName: definition.templateName,
    invitationTypeId: TYPE_ID,
    categoryId: categoryId(definition.categoryKey),
    description: definition.description,
    thumbnailUrl: definition.thumbnailUrl,
    previewUrl: null,
    premiumFlag: false,
    activeFlag: true,
    sortOrder: definition.sortOrder,
    createdBy: DEVELOPMENT_TEMPLATE_ACTOR,
    deletedFlag: false,
    deletedBy: null,
    deletedAt: null,
  };
}

function matchingVersion(definition, templateId) {
  return {
    versionId: `generated-version-${definition.sortOrder}`,
    templateId,
    versionNo: '1.0.0',
    rendererKey: definition.rendererKey,
    defaultConfig: { theme: definition.rendererKey },
    currentFlag: true,
    activeFlag: true,
    createdBy: DEVELOPMENT_TEMPLATE_ACTOR,
    deletedFlag: false,
    deletedBy: null,
    deletedAt: null,
  };
}

function versionKey(templateId, versionNo) {
  return `${templateId}:${versionNo}`;
}
