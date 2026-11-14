export function describeDbError(error, fallback = "Database error") {
  if (!error) return null;

  const message = String(error.message || "");

  if (/employees.*emp_code|company_id.*emp_code|unique.*emp_code|emp_code.*unique/i.test(message)) {
    return "This employee already exists.";
  }

  if (/row-level security/i.test(message)) {
    return "You do not have permission to perform this action.";
  }
  if (/duplicate key|unique constraint/i.test(message)) {
    return "That record already exists.";
  }
  if (/violates (not-null|check) constraint/i.test(message)) {
    return "A required or invalid field was rejected.";
  }
  return process.env.NODE_ENV === "development" ? `${fallback}: ${message}` : fallback;
}
