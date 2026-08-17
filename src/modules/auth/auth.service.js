import { ConflictError, UnauthorizedError } from '../../shared/errors.js';
import { isAuthenticatable, toSafeUser, USER_ROLES, USER_STATUSES } from '../../shared/user.js';

const INVALID_CREDENTIALS = 'Invalid email or password';

export class AuthService {
  constructor({ userRepository, passwordHasher, clock = () => new Date() }) {
    this.users = userRepository;
    this.passwordHasher = passwordHasher;
    this.clock = clock;
  }

  async register(input) {
    if (await this.users.findByEmail(input.email)) {
      throw new ConflictError('An account with this email already exists');
    }

    const passwordHash = await this.passwordHasher.hash(input.password);
    let user;
    try {
      user = await this.users.createPublicUser({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        phoneNumber: input.phoneNumber,
        roleCode: USER_ROLES.CLIENT,
        statusCode: USER_STATUSES.ACTIVE,
        now: this.clock(),
      });
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new ConflictError('An account with this email already exists');
      }
      throw error;
    }
    return toSafeUser(user);
  }

  async login(input) {
    const user = await this.users.findByEmail(input.email);
    if (!isAuthenticatable(user)) {
      throw new UnauthorizedError(INVALID_CREDENTIALS);
    }

    let matches = false;
    try {
      matches = await this.passwordHasher.verify(user.passwordHash, input.password);
    } catch {
      matches = false;
    }
    if (!matches) throw new UnauthorizedError(INVALID_CREDENTIALS);

    const updated = await this.users.updateLastLogin(user.userId, this.clock());
    return toSafeUser(updated);
  }

  async getCurrentUser(userId) {
    const user = await this.users.findById(userId);
    if (!isAuthenticatable(user)) throw new UnauthorizedError();
    return toSafeUser(user);
  }
}
