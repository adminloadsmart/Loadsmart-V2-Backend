/* Route parameter shapes, used to type `Request<P>` in the controller. */

export type VehicleParams = { vehicleId: string };
export type VehicleDocumentParams = { vehicleId: string; documentId: string };
export type DriverParams = { driverId: string };
export type DriverDocumentParams = { driverId: string; documentId: string };
export type DriverBankDetailsParams = { driverId: string; bankDetailsId: string };
export type LinkParams = { linkId: string };
