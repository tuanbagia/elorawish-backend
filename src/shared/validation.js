import { ValidationError } from './errors.js';

export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      'Invalid request data',
      result.error.issues.map(({ path, message }) => ({
        field: path.join('.'),
        message,
      })),
    );
  }
  return result.data;
}
