import { z } from 'zod';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const optionalText = (maximum) =>
  z.preprocess(
    blankToUndefined,
    z.string().trim().max(maximum).optional(),
  ).transform((value) => value ?? null);

const optionalUrl = z.preprocess(
  blankToUndefined,
  z.string().trim().url().max(1000).optional(),
).transform((value) => value ?? null);

const optionalTime = z.preprocess(
  blankToUndefined,
  z.string().regex(TIME_PATTERN, 'Time must use HH:mm format').optional(),
).transform((value) => value ?? null);

const personSchema = z
  .object({
    role: z.enum(['GROOM', 'BRIDE']),
    displayName: z.string().trim().min(1).max(150),
    fullName: optionalText(200),
    fatherName: optionalText(200),
    motherName: optionalText(200),
  })
  .strict();

const eventSchema = z
  .object({
    title: z.string().trim().min(1).max(150),
    date: z.string().regex(DATE_PATTERN, 'Date must use YYYY-MM-DD format').refine(
      isCalendarDate,
      'Date must be a valid calendar date',
    ),
    startTime: optionalTime,
    endTime: optionalTime,
    venueName: optionalText(255),
    venueAddress: optionalText(2000),
    mapUrl: optionalUrl,
  })
  .strict()
  .superRefine((event, context) => {
    if (event.startTime && event.endTime && event.endTime < event.startTime) {
      context.addIssue({
        code: 'custom',
        path: ['endTime'],
        message: 'End time must not be earlier than start time',
      });
    }
  });

export const createInvitationSchema = z
  .object({
    invitationTypeKey: z.string().trim().max(50).regex(/^[A-Z0-9_]+$/),
    templateVersionId: z.string().trim().min(1).max(30),
    title: z.string().trim().min(1).max(200),
    slug: z.string().transform(normalizeSlug).pipe(
      z.string().min(1, 'Slug must contain letters or numbers').max(150).regex(SLUG_PATTERN),
    ),
    openingTitle: optionalText(255),
    openingMessage: optionalText(5000),
    closingMessage: optionalText(5000),
    people: z.array(personSchema).length(2),
    event: eventSchema,
  })
  .strict()
  .superRefine((input, context) => {
    for (const role of ['GROOM', 'BRIDE']) {
      if (input.people.filter((person) => person.role === role).length !== 1) {
        context.addIssue({
          code: 'custom',
          path: ['people'],
          message: `Exactly one ${role} is required`,
        });
      }
    }
  });

export const invitationParamsSchema = z
  .object({ invitationId: z.string().trim().min(1).max(30) })
  .strict();

export function normalizeSlug(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function blankToUndefined(value) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function isCalendarDate(value) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
