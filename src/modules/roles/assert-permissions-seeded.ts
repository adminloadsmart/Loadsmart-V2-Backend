import { DataSource } from 'typeorm';
import * as permissionConstants from '../../shared/constants/permissions';
import { PermissionEntity } from './entities/permission.entity';

/** Startup guard, called once from server.ts's bootstrap(): every permission key referenced by
 *  requirePermission(...) call sites (the exported string constants in
 *  shared/constants/permissions.ts) must actually exist in auth.permissions. Without this, a
 *  typo'd or unseeded constant doesn't error anywhere — the gated route just silently 403s
 *  everyone forever, since no JWT could ever contain a key nobody granted. Object.values() picks
 *  up every export automatically, so a newly added constant is covered with no second list to
 *  maintain. */
export async function assertPermissionsSeeded(dataSource: DataSource): Promise<void> {
    const seeded = new Set((await dataSource.getRepository(PermissionEntity).find()).map((p) => p.key));
    const missing = Object.values(permissionConstants).filter((key) => !seeded.has(key));

    if (missing.length > 0) {
        throw new Error(
            'shared/constants/permissions.ts defines permission key(s) not present in auth.permissions: ' +
            `${missing.join(', ')}. Add them to db/seed-roles.ts's PERMISSIONS list and run "npm run seed:roles".`,
        );
    }
}
