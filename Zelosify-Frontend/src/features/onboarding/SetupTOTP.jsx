"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import axiosInstance from "@/utils/Axios/AxiosInstance";
import CircleLoader from "@/components/UI/loaders/CircleLoader";

export default function SetupTOTP() {
  const [qrCode, setQrCode] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem("totpSetup") || "null");
      if (stored?.qrCode) setQrCode(stored.qrCode);
      else setError("No setup code is available in this tab. Return to sign in if you already have an account.");
    } catch {
      setError("Unable to load your setup code. Return to sign in and try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleVerifyTOTP = async (event) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setIsVerifying(true);
    setError("");
    try {
      await axiosInstance.post("/auth/verify-totp", { totp: totpCode.trim() });
      sessionStorage.removeItem("totpSetup");
      window.location.replace("/login");
    } catch (err) {
      const message = err.response?.data?.message;
      setError(
        message === "Invalid TOTP code"
          ? "Invalid code. Try the latest code from your authenticator app."
          : err.response?.status === 400 || message === "Invalid or expired temp token"
            ? "Your setup session expired. Save the QR code in your authenticator, then sign in to verify your code."
            : message || "Verification failed. Please try again.",
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-8 rounded-xl shadow-lg">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 text-center">
        Set up two-factor authentication
      </h1>
      {isLoading ? <CircleLoader /> : (
        <div className="space-y-6">
          {error && <p role="alert" className="text-red-600 dark:text-red-400">{error}</p>}
          {qrCode && <>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Scan this QR code with your authenticator app, then enter its 6-digit code.
              Keep the account in your authenticator; you will need it each time you sign in.
            </p>
            <div className="flex justify-center">
              <img src={qrCode} alt="Authenticator setup QR code" width={200} height={200} />
            </div>
            <form onSubmit={handleVerifyTOTP} className="space-y-4">
              <label htmlFor="totp-code" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Verification code
              </label>
              <input
                id="totp-code"
                name="totp"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                required
                value={totpCode}
                onChange={(event) => setTotpCode(event.target.value)}
                maxLength={6}
                className="w-full px-3 py-2 border rounded-lg dark:bg-gray-900 dark:text-white"
              />
              <button type="submit" disabled={isVerifying} className="w-full bg-black dark:bg-white text-white dark:text-black py-2 rounded-lg disabled:opacity-50">
                {isVerifying ? "Verifying..." : "Verify & complete setup"}
              </button>
            </form>
          </>}
          <Link href="/login" className="block text-center text-blue-600 dark:text-blue-400">Return to sign in</Link>
        </div>
      )}
    </div>
  );
}
