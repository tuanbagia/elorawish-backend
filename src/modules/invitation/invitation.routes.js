import { parseBody } from '../../shared/validation.js';
import { createInvitationSchema, invitationParamsSchema } from './invitation.schemas.js';

export default async function invitationRoutes(fastify, { invitationService }) {
  const clientOnly = { preHandler: fastify.requireRole('CLIENT') };

  fastify.get('/catalog', clientOnly, async () => ({
    data: { invitationTypes: await invitationService.getCatalog() },
  }));

  fastify.get('/', clientOnly, async (request) => ({
    data: { invitations: await invitationService.listInvitations(request.currentUser.id) },
  }));

  fastify.get('/:invitationId', clientOnly, async (request) => {
    const { invitationId } = parseBody(invitationParamsSchema, request.params);
    return {
      data: {
        invitation: await invitationService.getInvitation(
          request.currentUser.id,
          invitationId,
        ),
      },
    };
  });

  fastify.post('/', clientOnly, async (request, reply) => {
    const input = parseBody(createInvitationSchema, request.body);
    const invitation = await invitationService.createInvitation(request.currentUser.id, input);
    return reply.code(201).send({ data: { invitation } });
  });
}
