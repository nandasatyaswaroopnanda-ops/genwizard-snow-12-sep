// ==============================================================================
// Genwizard ITSM — Native mongosh Seed Script for Identity Management & atr-mongo
// ==============================================================================
// Usage:
//   docker exec -i atr-mongo mongosh -u atr -p <password> --authenticationDatabase admin < scripts/seed_im_mongo.js
// Or from inside mongosh:
//   load("scripts/seed_im_mongo.js")
// ==============================================================================

// Dynamic database discovery in atr-mongo:
// Locates the existing Identity Management database (containing collections:
// 'aDGroup', 'group', 'user', 'permission', 'mongobeelock', 'userIdentityProviderGroups')
// as well as the ITSM database 'nexus_itsm'.
let targetDbs = ["nexus_itsm"];

try {
  const adminDb = db.getSiblingDB("admin");
  const dbsRes = adminDb.runCommand({ listDatabases: 1 });
  const allDbs = (dbsRes && dbsRes.databases) ? dbsRes.databases.map(function(d) { return d.name; }) : [];
  
  allDbs.forEach(function(dName) {
    if (["admin", "config", "local"].includes(dName)) return;
    const testDb = db.getSiblingDB(dName);
    const colls = testDb.getCollectionNames();
    
    // Check for signature collections of Spring Boot Identity Management
    const hasImSignature = colls.some(function(c) {
      const lower = c.toLowerCase();
      return lower === "adgroup" || lower === "useridentityprovidergroups" || 
             lower === "mongobeelock" || lower === "jwtpublickey" || lower === "dbchnagelog" || lower === "dbchangelog";
    }) || (colls.includes("group") && colls.includes("user"));

    if (hasImSignature && !targetDbs.includes(dName)) {
      targetDbs.push(dName);
      print("  ✓ Auto-detected existing Identity Management database: [" + dName + "]");
    }
  });
} catch (e) {
  print("  (!) Notice: listDatabases restricted or unavailable (" + e.message + "). Using candidate databases.");
  ["identity_management", "identity-management", "im", "aaam", "aaam-atr-v3", "im_db"].forEach(function(d) {
    if (!targetDbs.includes(d)) targetDbs.push(d);
  });
}

targetDbs.forEach(function(dbName) {
  const currentDb = db.getSiblingDB(dbName);
  print("\n========================================================");
  print(">>> Configuring Groups & DLs in database: " + dbName);
  print("========================================================");

  // 1. Core Groups with Attached Permissions
  const groupsToSeed = [
    {
      name: "IM_SAML",
      description: "Default SSO End-User Group for creating tickets, viewing own tickets, updating comments/worknotes, and viewing applications/projects.",
      permissions: JSON.stringify([
        "ticket_create",
        "ticket_read_own",
        "ticket_update",
        "applications_read",
        "projects_read"
      ]),
      active: true,
      created_at: new Date()
    },
    {
      name: "ATR_SAML",
      description: "Default SSO End-User Group (ATR SAML) for creating tickets, viewing own tickets, updating comments/worknotes, and viewing applications/projects.",
      permissions: JSON.stringify([
        "ticket_create",
        "ticket_read_own",
        "ticket_update",
        "applications_read",
        "projects_read"
      ]),
      active: true,
      created_at: new Date()
    },
    {
      name: "itsm_admin",
      description: "ITSM Platform Administrator Group with full management and operational permissions.",
      permissions: JSON.stringify([
        "admin_all",
        "ticket_create",
        "ticket_read",
        "ticket_update",
        "ticket_delete",
        "ticket_assign",
        "ticket_resolve",
        "ticket_close",
        "admin_routing",
        "admin_slas",
        "admin_config",
        "users_manage",
        "applications_read",
        "projects_read"
      ]),
      active: true,
      created_at: new Date()
    },
    {
      name: "itsm_user",
      description: "ITSM Support Fulfiller Group with queue assignment and ticket resolution permissions.",
      permissions: JSON.stringify([
        "ticket_create",
        "ticket_read",
        "ticket_update",
        "ticket_assign",
        "ticket_resolve",
        "applications_read",
        "projects_read"
      ]),
      active: true,
      created_at: new Date()
    },
    {
      name: "itsm_read",
      description: "ITSM Read-Only Group with read access to tickets, applications, and projects.",
      permissions: JSON.stringify([
        "ticket_read",
        "applications_read",
        "projects_read"
      ]),
      active: true,
      created_at: new Date()
    }
  ];

  const groupMap = {};

  // 1. Seed into all group collections: 'group' (Spring Data entity), 'groups', and 'custom_groups'
  ["group", "groups", "custom_groups"].forEach(function(collName) {
    if (currentDb.getCollectionNames().includes(collName) || collName === "group" || collName === "custom_groups") {
      groupsToSeed.forEach(function(g) {
        const existing = currentDb[collName].findOne({ name: g.name });
        const permsList = [
          "ticket_create", "ticket_read_own", "ticket_update", "applications_read", "projects_read",
          "tickets:create", "tickets:read_own", "tickets:update", "applications:read", "projects:read"
        ];
        // Dynamic permissions array based on group
        let specificPerms = ["ticket_create", "ticket_read_own", "ticket_update", "applications_read", "projects_read"];
        if (g.name === "itsm_admin") {
          specificPerms = [
            "admin_all", "ticket_create", "ticket_read", "ticket_update", "ticket_delete",
            "ticket_assign", "ticket_resolve", "ticket_close", "admin_routing", "admin_slas",
            "admin_config", "users_manage", "applications_read", "projects_read"
          ];
        } else if (g.name === "itsm_user") {
          specificPerms = ["ticket_create", "ticket_read", "ticket_update", "ticket_assign", "ticket_resolve", "applications_read", "projects_read"];
        } else if (g.name === "itsm_read") {
          specificPerms = ["ticket_read", "applications_read", "projects_read"];
        }

        if (!existing) {
          const lastDoc = currentDb[collName].find().sort({ id: -1 }).limit(1).toArray();
          const nextId = (lastDoc.length > 0 && lastDoc[0].id) ? lastDoc[0].id + 1 : 1;
          const toInsert = {
            id: nextId,
            name: g.name,
            description: g.description,
            permissions: specificPerms,
            permissions_str: g.permissions,
            active: true,
            created_at: new Date()
          };
          currentDb[collName].insertOne(toInsert);
          groupMap[g.name] = nextId;
          print("  ✓ Created group [" + g.name + "] in collection [" + collName + "]");
        } else {
          groupMap[g.name] = existing.id || existing._id;
          currentDb[collName].updateOne(
            { _id: existing._id },
            { $set: { permissions: specificPerms, permissions_str: g.permissions, description: g.description, active: true } }
          );
          print("  ✓ Refreshed group [" + g.name + "] in collection [" + collName + "]");
        }
      });
    }
  });

  // 2. Associate Existing Admin User with itsm_admin Group
  // Checked in 'user' (Spring Data entity) and 'users'
  ["user", "users"].forEach(function(collName) {
    if (currentDb.getCollectionNames().includes(collName)) {
      const adminDoc = currentDb[collName].findOne({
        $or: [{ username: "admin" }, { role: "admin" }, { role: "administrator" }, { role: "itsm_admin" }]
      });
      if (adminDoc) {
        let userGroups = adminDoc.custom_groups || adminDoc.groups || [];
        if (!Array.isArray(userGroups)) {
          userGroups = [userGroups];
        }
        if (!userGroups.includes("itsm_admin")) {
          userGroups.push("itsm_admin");
        }
        currentDb[collName].updateOne(
          { _id: adminDoc._id },
          { $set: { role: "itsm_admin", custom_groups: userGroups, groups: userGroups } }
        );
        print("  ✓ Added [itsm_admin] group to admin user in collection [" + collName + "]");
      }
    }
  });

  // 3. Permissions Catalog Collection ('permission', 'permissions', 'permission_catalog')
  const permCatalog = [
    { code: "ticket_create", name: "ticket_create", category: "Tickets", description: "Create incidents and service requests" },
    { code: "ticket_read", name: "ticket_read", category: "Tickets", description: "View incidents and service requests" },
    { code: "ticket_read_own", name: "ticket_read_own", category: "Tickets", description: "View own created tickets" },
    { code: "ticket_update", name: "ticket_update", category: "Tickets", description: "Update ticket status and work notes" },
    { code: "ticket_assign", name: "ticket_assign", category: "Tickets", description: "Assign tickets to groups or engineers" },
    { code: "ticket_resolve", name: "ticket_resolve", category: "Tickets", description: "Resolve incidents and requests" },
    { code: "ticket_close", name: "ticket_close", category: "Tickets", description: "Close or resolve incidents and requests" },
    { code: "ticket_delete", name: "ticket_delete", category: "Tickets", description: "Delete or archive ticket records" },
    { code: "admin_all", name: "admin_all", category: "Administration", description: "Full administrative control" },
    { code: "admin_routing", name: "admin_routing", category: "Administration", description: "Manage 6-tier routing rules" },
    { code: "admin_slas", name: "admin_slas", category: "Administration", description: "Configure SLA policies and calendars" },
    { code: "applications_read", name: "applications_read", category: "Administration", description: "View applications list" },
    { code: "projects_read", name: "projects_read", category: "Administration", description: "View projects list" }
  ];

  ["permission", "permissions", "permission_catalog"].forEach(function(collName) {
    if (currentDb.getCollectionNames().includes(collName) || collName === "permission") {
      permCatalog.forEach(function(p) {
        currentDb[collName].updateOne(
          { $or: [{ code: p.code }, { name: p.code }] },
          { $set: p },
          { upsert: true }
        );
      });
      print("  ✓ Synchronized permissions catalog into [" + collName + "]");
    }
  });
});

// 3. Initialize ITSM Collections and Indexes in nexus_itsm
print("\n========================================================");
print(">>> Initializing Native ITSM Indexes in nexus_itsm");
print("========================================================");
const itsmDb = db.getSiblingDB("nexus_itsm");

const collectionsAndIndexes = [
  { name: "incidents", index: { ticket_number: 1 }, unique: true },
  { name: "incidents", index: { project_id: 1, state: 1 }, unique: false },
  { name: "service_requests", index: { ticket_number: 1 }, unique: true },
  { name: "change_requests", index: { change_number: 1 }, unique: true },
  { name: "users", index: { username: 1 }, unique: true },
  { name: "users", index: { email: 1 }, unique: false },
  { name: "projects", index: { code: 1 }, unique: true },
  { name: "applications", index: { project_id: 1, name: 1 }, unique: false },
  { name: "assignment_groups", index: { name: 1 }, unique: true },
  { name: "sla_policies", index: { project_id: 1, assignment_group_id: 1, active: 1 }, unique: false },
  { name: "audit_logs", index: { entity_type: 1, entity_id: 1, created_at: -1 }, unique: false }
];

collectionsAndIndexes.forEach(function(ci) {
  try {
    itsmDb[ci.name].createIndex(ci.index, { unique: ci.unique, background: true });
    print("  ✓ Ensured index on " + ci.name + ": " + JSON.stringify(ci.index));
  } catch (e) {
    print("  - Index notice on " + ci.name + ": " + e.message);
  }
});

print("\n>>> MongoDB Identity Management & ITSM initialization complete!\n");
