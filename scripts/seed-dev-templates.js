import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../src/config/env.js';
import { PrismaTemplateCatalogRepository } from '../src/modules/template/template-catalog.repository.js';

export const DEVELOPMENT_TEMPLATE_ACTOR = 'DEV_SEED';
export const DEVELOPMENT_TEMPLATE_VERSION = '1.0.0';
export const REQUIRED_CATEGORY_KEYS = Object.freeze([
  'FLORAL',
  'MINIMALIST',
  'ISLAMIC',
  'GEN_Z',
  'CUTE',
  'ELEGANT',
]);

export const DEVELOPMENT_TEMPLATES = Object.freeze([
  template({
    templateKey: 'SUNDAY_BLOOM',
    templateName: 'Sunday Bloom',
    categoryKey: 'FLORAL',
    rendererKey: 'sunday-bloom',
    description: 'Bright botanical wedding',
    sortOrder: 1,
  }),
  template({
    templateKey: 'AFTERGLOW',
    templateName: 'Afterglow',
    categoryKey: 'ELEGANT',
    rendererKey: 'afterglow',
    description: 'Warm romantic sunset theme',
    sortOrder: 2,
  }),
  template({
    templateKey: 'PAPER_HEARTS',
    templateName: 'Paper Hearts',
    categoryKey: 'CUTE',
    rendererKey: 'paper-hearts',
    description: 'Playful editorial wedding',
    sortOrder: 3,
  }),
  template({
    templateKey: 'MIDNIGHT_KISS',
    templateName: 'Midnight Kiss',
    categoryKey: 'ELEGANT',
    rendererKey: 'midnight-kiss',
    description: 'Dark modern wedding',
    sortOrder: 4,
  }),
  template({
    templateKey: 'CHERRY_LOVE',
    templateName: 'Cherry Love',
    categoryKey: 'GEN_Z',
    rendererKey: 'cherry-love',
    description: 'Bold pink-red Gen Z wedding',
    sortOrder: 5,
  }),
  template({
    templateKey: 'SOFT_PROMISE',
    templateName: 'Soft Promise',
    categoryKey: 'MINIMALIST',
    rendererKey: 'soft-promise',
    description: 'Minimal soft romantic wedding',
    sortOrder: 6,
  }),
]);

export function assertTemplateSeedEnvironment(nodeEnv) {
  if (nodeEnv === 'production') {
    throw new Error('Development template seed is disabled when NODE_ENV=production');
  }
}

export async function seedDevelopmentTemplates({ repository, now = () => new Date() }) {
  return repository.transaction(async (catalog) => {
    const invitationType = await catalog.findInvitationTypeByKey('WEDDING');
    assertActiveMaster(invitationType, 'Invitation type WEDDING');

    const categories = await catalog.findCategoriesByKeys(REQUIRED_CATEGORY_KEYS);
    const categoriesByKey = new Map(categories.map((category) => [category.categoryKey, category]));
    for (const categoryKey of REQUIRED_CATEGORY_KEYS) {
      assertActiveMaster(categoriesByKey.get(categoryKey), `Template category ${categoryKey}`);
    }

    const results = [];
    for (const expected of DEVELOPMENT_TEMPLATES) {
      const category = categoriesByKey.get(expected.categoryKey);
      const timestamp = now();
      const templateResult = await reconcileTemplate(catalog, expected, {
        invitationTypeId: invitationType.invitationTypeId,
        categoryId: category.categoryId,
        timestamp,
      });
      const versionResult = await reconcileVersion(
        catalog,
        expected,
        templateResult.row,
        timestamp,
      );
      results.push({
        templateKey: expected.templateKey,
        categoryKey: expected.categoryKey,
        rendererKey: expected.rendererKey,
        template: templateResult,
        version: versionResult,
      });
    }
    return results;
  });
}

async function reconcileTemplate(catalog, expected, resolved) {
  const existing = await catalog.findTemplateByKey(expected.templateKey);
  const desired = {
    templateKey: expected.templateKey,
    templateName: expected.templateName,
    invitationTypeId: resolved.invitationTypeId,
    categoryId: resolved.categoryId,
    description: expected.description,
    thumbnailUrl: expected.thumbnailUrl,
    previewUrl: null,
    premiumFlag: false,
    activeFlag: true,
    sortOrder: expected.sortOrder,
  };

  if (!existing) {
    const row = await catalog.createTemplate({
      ...desired,
      createdBy: DEVELOPMENT_TEMPLATE_ACTOR,
      changedBy: DEVELOPMENT_TEMPLATE_ACTOR,
      changedAt: resolved.timestamp,
    });
    return { action: 'inserted', row };
  }

  assertSeedOwnership(existing, `Template ${expected.templateKey}`);
  const changes = changesFor(existing, desired, [
    'templateName',
    'invitationTypeId',
    'categoryId',
    'description',
    'thumbnailUrl',
    'premiumFlag',
    'activeFlag',
    'sortOrder',
  ]);
  appendSoftDeleteRestoration(existing, changes);
  if (Object.keys(changes).length === 0) return { action: 'unchanged', row: existing };

  const row = await catalog.updateTemplate(existing.templateId, changes, {
    changedBy: DEVELOPMENT_TEMPLATE_ACTOR,
    changedAt: resolved.timestamp,
  });
  return { action: 'updated', row, fields: Object.keys(changes) };
}

async function reconcileVersion(catalog, expected, templateRow, timestamp) {
  const existing = await catalog.findVersionByNumber(
    templateRow.templateId,
    DEVELOPMENT_TEMPLATE_VERSION,
  );
  const currentVersions = await catalog.findActiveCurrentVersions(templateRow.templateId);
  const conflictingCurrent = currentVersions.find(
    (version) => version.versionId !== existing?.versionId,
  );
  if (conflictingCurrent) {
    throw new Error(
      `Template ${expected.templateKey} already has another active current version (${conflictingCurrent.versionNo})`,
    );
  }

  const desired = {
    templateId: templateRow.templateId,
    versionNo: DEVELOPMENT_TEMPLATE_VERSION,
    rendererKey: expected.rendererKey,
    defaultConfig: { theme: expected.rendererKey },
    currentFlag: true,
    activeFlag: true,
  };
  if (!existing) {
    const row = await catalog.createVersion({
      ...desired,
      createdBy: DEVELOPMENT_TEMPLATE_ACTOR,
      changedBy: DEVELOPMENT_TEMPLATE_ACTOR,
      changedAt: timestamp,
    });
    return { action: 'inserted', row };
  }

  assertSeedOwnership(existing, `Template version ${expected.templateKey}@${DEVELOPMENT_TEMPLATE_VERSION}`);
  const changes = changesFor(existing, desired, [
    'rendererKey',
    'defaultConfig',
    'currentFlag',
    'activeFlag',
  ]);
  appendSoftDeleteRestoration(existing, changes);
  if (Object.keys(changes).length === 0) return { action: 'unchanged', row: existing };

  const row = await catalog.updateVersion(existing.versionId, changes, {
    changedBy: DEVELOPMENT_TEMPLATE_ACTOR,
    changedAt: timestamp,
  });
  return { action: 'updated', row, fields: Object.keys(changes) };
}

function assertActiveMaster(master, label) {
  if (!master) throw new Error(`${label} is missing`);
  if (!master.activeFlag || master.deletedFlag) {
    throw new Error(`${label} must be active and not deleted`);
  }
}

function assertSeedOwnership(row, label) {
  if (row.createdBy !== DEVELOPMENT_TEMPLATE_ACTOR) {
    throw new Error(`${label} is not owned by ${DEVELOPMENT_TEMPLATE_ACTOR}; refusing to overwrite it`);
  }
}

function changesFor(existing, desired, fields) {
  const changes = {};
  for (const field of fields) {
    if (!sameValue(existing[field], desired[field])) changes[field] = desired[field];
  }
  return changes;
}

function appendSoftDeleteRestoration(existing, changes) {
  if (!existing.deletedFlag) return;
  changes.deletedFlag = false;
  changes.deletedBy = null;
  changes.deletedAt = null;
}

function sameValue(left, right) {
  if (typeof left === 'object' && left !== null) {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return left === right;
}

function template(definition) {
  return Object.freeze({
    ...definition,
    premiumFlag: false,
    thumbnailUrl: `/template-thumbnails/${definition.rendererKey}.svg`,
  });
}

async function main() {
  assertTemplateSeedEnvironment(process.env.NODE_ENV);
  const config = loadEnv();
  assertTemplateSeedEnvironment(config.NODE_ENV);

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const results = await seedDevelopmentTemplates({
      repository: new PrismaTemplateCatalogRepository(prisma),
    });
    for (const result of results) {
      const templateFields = result.template.fields?.join(', ');
      const versionFields = result.version.fields?.join(', ');
      process.stdout.write(
        `${result.template.action}: ${result.templateKey} -> ${result.template.row.templateId}` +
          `${templateFields ? ` (${templateFields})` : ''}; ` +
          `version ${result.version.action}: ${result.version.row.versionId}` +
          `${versionFields ? ` (${versionFields})` : ''}\n`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
