import argon2 from 'argon2';

export const argonPasswordHasher = {
  hash(password) {
    return argon2.hash(password, { type: argon2.argon2id });
  },
  verify(hash, password) {
    return argon2.verify(hash, password);
  },
};
