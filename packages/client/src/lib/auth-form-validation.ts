export type FieldErrors<T extends string> = Partial<Record<T, string>>;

export type SignInFieldName = "email" | "password";
export type SignUpFieldName = "name" | "email" | "password";
export type ForgotPasswordFieldName = "email";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(value: string): string | null {
  const email = value.trim();
  if (email.length === 0) {
    return "Enter your email address.";
  }
  if (!EMAIL_PATTERN.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

export function validateSignInFields(input: {
  email: string;
  password: string;
}): FieldErrors<SignInFieldName> {
  const errors: FieldErrors<SignInFieldName> = {};
  const emailError = validateEmail(input.email);
  if (emailError) {
    errors.email = emailError;
  }
  if (input.password.length === 0) {
    errors.password = "Enter your password.";
  }
  return errors;
}

export function validateSignUpFields(input: {
  name: string;
  email: string;
  password: string;
}): FieldErrors<SignUpFieldName> {
  const errors: FieldErrors<SignUpFieldName> = {};
  if (input.name.trim().length === 0) {
    errors.name = "Enter your name.";
  }
  const emailError = validateEmail(input.email);
  if (emailError) {
    errors.email = emailError;
  }
  if (input.password.length === 0) {
    errors.password = "Enter a password.";
  } else if (input.password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }
  return errors;
}

export function validateForgotPasswordFields(input: {
  email: string;
}): FieldErrors<ForgotPasswordFieldName> {
  const errors: FieldErrors<ForgotPasswordFieldName> = {};
  const emailError = validateEmail(input.email);
  if (emailError) {
    errors.email = emailError;
  }
  return errors;
}
