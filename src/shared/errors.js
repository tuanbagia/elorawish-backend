export class AppError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details) {
    super(400, 'VALIDATION_ERROR', message);
    this.details = details;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(403, 'FORBIDDEN', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConflictError extends AppError {
  constructor(message) {
    super(409, 'CONFLICT', message);
  }
}

export class EditConflictError extends AppError {
  constructor() {
    super(
      409,
      'EDIT_CONFLICT',
      'This invitation was updated elsewhere. Reload the latest version before saving.',
    );
  }
}

export class InvitationNotEditableError extends AppError {
  constructor() {
    super(409, 'INVITATION_NOT_EDITABLE', 'Only draft invitations can be edited');
  }
}

export class InvitationStructureError extends AppError {
  constructor() {
    super(409, 'INVITATION_STRUCTURE_INVALID', 'This invitation cannot be edited safely');
  }
}
