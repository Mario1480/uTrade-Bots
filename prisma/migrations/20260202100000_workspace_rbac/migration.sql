CREATE TABLE "Role" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "permissions" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Role_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Role_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

ALTER TABLE "WorkspaceMember" ADD COLUMN "roleId" TEXT;
ALTER TABLE "WorkspaceMember" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';

INSERT INTO "Role" ("id", "workspaceId", "name", "isSystem", "permissions", "createdAt")
SELECT
  'role_' || md5(random()::text || clock_timestamp()::text),
  w.id,
  v.name,
  true,
  v.permissions::jsonb,
  NOW()
FROM "Workspace" w
CROSS JOIN (VALUES
  ('Admin', '{"bots.view":true,"bots.create":true,"bots.edit_config":true,"bots.start_pause_stop":true,"bots.delete":true,"trading.manual_limit":true,"trading.manual_market":true,"trading.price_support":true,"exchange_keys.view_present":true,"exchange_keys.edit":true,"risk.edit":true,"users.manage_members":true,"users.manage_roles":true,"settings.security":true,"audit.view":true}'),
  ('Operator 1', '{"bots.view":true,"bots.create":false,"bots.edit_config":true,"bots.start_pause_stop":true,"bots.delete":false,"trading.manual_limit":false,"trading.manual_market":false,"trading.price_support":false,"exchange_keys.view_present":true,"exchange_keys.edit":false,"risk.edit":true,"users.manage_members":false,"users.manage_roles":false,"settings.security":false,"audit.view":true}'),
  ('Operator 2', '{"bots.view":true,"bots.create":false,"bots.edit_config":true,"bots.start_pause_stop":true,"bots.delete":false,"trading.manual_limit":false,"trading.manual_market":false,"trading.price_support":false,"exchange_keys.view_present":true,"exchange_keys.edit":false,"risk.edit":false,"users.manage_members":false,"users.manage_roles":false,"settings.security":false,"audit.view":true}'),
  ('Viewer', '{"bots.view":true,"bots.create":false,"bots.edit_config":false,"bots.start_pause_stop":false,"bots.delete":false,"trading.manual_limit":false,"trading.manual_market":false,"trading.price_support":false,"exchange_keys.view_present":true,"exchange_keys.edit":false,"risk.edit":false,"users.manage_members":false,"users.manage_roles":false,"settings.security":false,"audit.view":true}')
) AS v(name, permissions);

UPDATE "WorkspaceMember" wm
SET "roleId" = r.id
FROM "Role" r
WHERE r."workspaceId" = wm."workspaceId" AND r."name" = 'Admin';

ALTER TABLE "WorkspaceMember" ALTER COLUMN "roleId" SET NOT NULL;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WorkspaceMember" DROP COLUMN "role";

CREATE INDEX "WorkspaceMember_workspaceId_roleId_idx" ON "WorkspaceMember"("workspaceId", "roleId");
CREATE UNIQUE INDEX "Role_workspaceId_name_key" ON "Role"("workspaceId", "name");

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "meta" JSONB,
  "ip" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");

CREATE TABLE "GlobalSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key")
);
