export interface NotificationsGateway {
  /** LS_N_0055 — an open workshop visit (breakdown or service) was closed and the truck is back
   *  in front of dispatch. Called after the closing transaction commits; best-effort, never
   *  throws (a notification problem must not fail the close). */
  vehicleBackInService(event: { tenantId: string; jobId: string }): Promise<void>;
}
