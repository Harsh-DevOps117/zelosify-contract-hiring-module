import axios from "axios";
export const hiringApi = axios.create({
  baseURL:
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:5000/api/v1",
  withCredentials: true,
  timeout: 1900,
});
export function errorMessage(error) {
  return (
    error.response?.data?.message ||
    (error.code === "ECONNABORTED"
      ? "The request timed out. Please try again."
      : "We couldn't complete this request. Please try again.")
  );
}
export function fileUrl(persona, id) {
  return `${hiringApi.defaults.baseURL}/${persona}/profiles/${id}/file`;
}
