export function isLinkSender(sender, runtimeId) {
  return !!runtimeId && sender?.id === runtimeId && !sender.tab;
}

export function linkCodeInput(value) {
  const code = String(value || "").trim();
  if (!/^\d{6}$/.test(code)) throw new Error("Enter the 6-digit code from the Mac app.");
  return code;
}

export function codeCountdown(until, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  if (!Number.isFinite(seconds) || !seconds) return "Code expired. Show a new code.";
  return `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function linkError(error) {
  if ([400, 404, 410, 422].includes(error?.status)) return "That code is wrong or expired. Get a new code from the Mac app.";
  if (error?.status === 429) return "Too many tries. Wait a minute, then try again.";
  return error?.message || "Couldn’t link. Try again.";
}
