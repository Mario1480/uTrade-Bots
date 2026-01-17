import { prisma } from "@mm/db";

export const PERMISSION_KEYS = [
  "bots.view",
  "bots.create",
  "bots.edit_config",
  "bots.start_pause_stop",
  "bots.delete",
  "trading.manual_limit",
  "trading.manual_market",
  "trading.price_support",
  "exchange_keys.view_present",
  "exchange_keys.edit",
  "risk.edit",
  "users.manage_members",
  "users.manage_roles",
  "settings.security",
  "audit.view"
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function buildPermissions(keys: PermissionKey[]) {
  return keys.reduce<Record<string, boolean>>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

export const DEFAULT_ROLES = [
  {
    name: "Admin",
    isSystem: true,
    permissions: buildPermissions(PERMISSION_KEYS as PermissionKey[])
  },
  {
    name: "Operator 1",
    isSystem: true,
    permissions: buildPermissions([
      "bots.view",
      "bots.edit_config",
      "bots.start_pause_stop",
      "exchange_keys.view_present",
      "risk.edit",
      "audit.view"
    ])
  },
  {
    name: "Operator 2",
    isSystem: true,
    permissions: buildPermissions([
      "bots.view",
      "bots.edit_config",
      "bots.start_pause_stop",
      "exchange_keys.view_present",
      "audit.view"
    ])
  },
  {
    name: "Viewer",
    isSystem: true,
    permissions: buildPermissions(["bots.view", "audit.view"])
  }
];

export async function ensureDefaultRoles(workspaceId: string) {
  const existing = await prisma.role.findMany({ where: { workspaceId } });
  if (existing.length > 0) {
    const admin = existing.find((r) => r.name === "Admin") ?? existing[0];
    return { adminRoleId: admin.id };
  }

  const created: { id: string; name: string }[] = [];
  for (const role of DEFAULT_ROLES) {
    const r = await prisma.role.create({
      data: {
        workspaceId,
        name: role.name,
        isSystem: role.isSystem,
        permissions: role.permissions
      }
    });
    created.push({ id: r.id, name: r.name });
  }

  const admin = created.find((r) => r.name === "Admin") ?? created[0];
  return { adminRoleId: admin.id };
}
