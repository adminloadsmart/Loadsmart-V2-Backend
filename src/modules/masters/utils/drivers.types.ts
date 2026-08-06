export type DriverStatus = "active" | "inactive" | "blacklisted";

export type DriverDocumentType =
  | "driving_license_front"
  | "driving_license_back";
export type DriverDocumentVerificationSource = "sarathi" | "manual";

export type DriverVerificationType = "sarathi_dl";
export type DriverVerificationStatus =
  | "pending"
  | "verified"
  | "not_found"
  | "manual_review";

export type DriverBankVerificationStatus = "pending" | "verified" | "rejected";
