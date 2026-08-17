import { z } from 'zod';

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200),
    email: z.string().trim().toLowerCase().email().max(320),
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
    email: z.string().trim().toLowerCase().email().max(320),
    password: z.string().min(1).max(128),
    rememberMe: z.boolean().default(false),
  })
  .strict();
