export function apiErrorMessage(error: unknown) {
  const data = (error as { data?: { error?: { message?: string; details?: Array<{ path?: string; message?: string }> } } })
    .data?.error;
  if (data?.details?.length) {
    return data.details.map((detail) => detail.message).filter(Boolean).join(" · ");
  }
  return data?.message ?? "Opération impossible";
}
