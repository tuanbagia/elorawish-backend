import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(255);

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(1).max(150),
    email: emailSchema,
    phoneNumber: z.string().trim().min(6).max(30),
    password: z.string().min(8).max(128),
    confirmPassword: z.string(),
  })
  .strict()
  .refine((value) => value.password === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().default(false),
  })
  .strict();
