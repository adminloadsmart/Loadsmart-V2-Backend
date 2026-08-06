import { z } from 'zod';

const uuid = z.string().uuid();
const userParams = z.object({ userId: uuid });
const userPermissionParams = z.object({ userId: uuid, permissionId: uuid });

export const roleValidators = {
    listRoles: z.object({
        query: z.object({ scope: z.enum(['platform', 'organization']).optional() }),
    }),
    listPermissions: z.object({
        query: z.object({ scope: z.enum(['platform', 'organization']).optional() }),
    }),
    getUserPermissions: z.object({ params: userParams }),

    assignRole: z.object({
        params: userParams,
        body: z.object({ roleId: uuid }),
    }),
    
    grantPermission: z.object({
        params: userParams,
        body: z.object({ permissionId: uuid }),
    }),
    revokePermission: z.object({ params: userPermissionParams }),
};
