export interface StaffImportMapping {
  fullName: string;
  phoneNumber: string;
  email: string;
  role: string;
  coverage: string;
}

export interface NormalizedStaffRow {
  fullName: string;
  phoneNumber: string;
  email: string;
  roleId: string;
  roleName: string;
  coverage: string;
}

export interface StaffImportParams {
  importId: string;
}
