import { createHmac, timingSafeEqual } from "node:crypto";
import { fail } from "./domain.js";
type Reservation = {
  id: string;
  openingId: string;
  uploadedBy: string;
  expiresAt: Date;
  size: number;
  contentType: string;
};
function signature(reservation: Reservation) {
  const secret = process.env.HIRING_UPLOAD_SIGNING_SECRET;
  if (!secret || secret.length < 32)
    return fail(
      503,
      "UPLOAD_SIGNING_UNCONFIGURED",
      "Upload signing is not configured",
    );
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        reservation.id,
        reservation.openingId,
        reservation.uploadedBy,
        reservation.expiresAt.toISOString(),
        reservation.size,
        reservation.contentType,
      ]),
    )
    .digest("hex");
}
export function uploadTicket(reservation: Reservation) {
  return signature(reservation);
}
export function verifyUploadTicket(reservation: Reservation, ticket: string) {
  if (
    !/^[a-f0-9]{64}$/.test(ticket) ||
    !timingSafeEqual(
      Buffer.from(signature(reservation), "hex"),
      Buffer.from(ticket, "hex"),
    )
  )
    fail(403, "INVALID_UPLOAD_TICKET", "Invalid upload signature");
}
