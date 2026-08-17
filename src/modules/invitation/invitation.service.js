import { ConflictError, NotFoundError, ValidationError } from '../../shared/errors.js';

const TEMPLATE_UNAVAILABLE = 'Selected invitation template is unavailable';

export class InvitationService {
  constructor({ invitationRepository, clock = () => new Date() }) {
    this.invitations = invitationRepository;
    this.clock = clock;
  }

  getCatalog() {
    return this.invitations.getCatalog();
  }

  listInvitations(userId) {
    return this.invitations.findAllOwnedBy(userId);
  }

  async getInvitation(userId, invitationId) {
    const invitation = await this.invitations.findOwnedById(userId, invitationId);
    if (!invitation) throw new NotFoundError('Invitation not found');
    return invitation;
  }

  async createInvitation(userId, input) {
    const selection = await this.invitations.findUsableTemplateVersion(
      input.invitationTypeKey,
      input.templateVersionId,
    );
    if (!selection) {
      throw new ValidationError(TEMPLATE_UNAVAILABLE, [{
        field: 'templateVersionId',
        message: 'Select an active current template',
      }]);
    }

    try {
      return await this.invitations.createAtomic({
        ...input,
        userId,
        invitationTypeId: selection.invitationTypeId,
        templateVersionId: selection.templateVersionId,
        now: this.clock(),
      });
    } catch (error) {
      if (isSlugConflict(error)) {
        throw new ConflictError('This invitation URL is already in use');
      }
      throw error;
    }
  }
}

function isSlugConflict(error) {
  if (error?.code !== 'P2002') return false;
  const target = error.meta?.target;
  return !target || String(target).includes('slug');
}
