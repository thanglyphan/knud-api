/**
 * Test script for Tripletex Timesheet feature
 * 
 * Run with: npx tsx src/tripletex/test-timesheet.ts
 * 
 * Tests:
 * 1. Create session token
 * 2. Get projects
 * 3. Get activities
 * 4. Get activities for timesheet (per project)
 * 5. Get projects for timesheet
 * 6. Create timesheet entry
 * 7. Get timesheet entries
 * 8. Update timesheet entry
 * 9. Get timesheet total hours
 * 10. Delete timesheet entry
 * 11. Get timesheet summary (via timesheetAgent)
 */

import "dotenv/config";
import { createTripletexClient } from "./client.js";
import { createTimesheetAgent } from "./subagents/timesheetAgent.js";

const API_URL = process.env.TRIPLETEX_API_URL || "https://api-test.tripletex.tech/v2";
const CONSUMER_TOKEN = process.env.TRIPLETEX_CONSUMER_TOKEN!;
// Use THANG's employee token
const EMPLOYEE_TOKEN = "eyJ0b2tlbklkIjoyNTI0LCJ0b2tlbiI6InRlc3QtNDYwNjZmMzAtZjFjMy00NGMzLWE3NzktZDVlYmU2YzI3OTNiIn0=";

let passed = 0;
let failed = 0;

function log(label: string, data: unknown) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${label}`);
  console.log("=".repeat(60));
  console.log(JSON.stringify(data, null, 2));
}

function ok(label: string) {
  passed++;
  console.log(`  ✅ ${label}`);
}

function fail(label: string, error: unknown) {
  failed++;
  console.error(`  ❌ ${label}: ${error instanceof Error ? error.message : String(error)}`);
}

async function createSession(): Promise<string> {
  const expDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const url = `${API_URL}/token/session/:create?consumerToken=${encodeURIComponent(CONSUMER_TOKEN)}&employeeToken=${encodeURIComponent(EMPLOYEE_TOKEN)}&expirationDate=${expDate}`;

  const response = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session creation failed: ${response.status} - ${text}`);
  }

  const data = await response.json();
  return data.value.token;
}

async function getCompanyId(sessionToken: string): Promise<number> {
  const credentials = Buffer.from(`0:${sessionToken}`).toString("base64");
  const response = await fetch(`${API_URL}/token/session/%3EwhoAmI`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!response.ok) throw new Error("whoAmI failed");
  const data = await response.json();
  return data.value.companyId;
}

async function main() {
  console.log("\n🧪 Tripletex Timesheet Test Suite\n");

  // Step 1: Create session
  console.log("Creating session token...");
  let sessionToken: string;
  let companyId: number;
  try {
    sessionToken = await createSession();
    companyId = await getCompanyId(sessionToken);
    ok(`Session created (companyId: ${companyId})`);
  } catch (e) {
    fail("Session creation", e);
    console.error("\nCannot proceed without session. Exiting.");
    process.exit(1);
  }

  const client = createTripletexClient(sessionToken, String(companyId));
  const today = new Date().toISOString().split("T")[0];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  // Cleanup: delete any leftover test entries from previous runs
  try {
    const leftovers = await client.getTimesheetEntries({
      dateFrom: monthAgo,
      dateTo: tomorrow,
      comment: "Knud",
    });
    for (const entry of leftovers.values) {
      if (entry.comment?.includes("Knud") && !entry.locked) {
        try {
          await client.deleteTimesheetEntry(entry.id);
          console.log(`  🧹 Cleaned up leftover entry ${entry.id}`);
        } catch { /* ignore cleanup errors */ }
      }
    }
  } catch { /* ignore cleanup errors */ }

  // Step 2: Get employees (to find our employee ID)
  let employeeId: number | undefined;
  try {
    const employees = await client.getEmployees();
    log("Employees", { count: employees.values.length, employees: employees.values.map(e => ({ id: e.id, name: `${e.firstName} ${e.lastName}` })) });
    if (employees.values.length > 0) {
      employeeId = employees.values[0].id;
    }
    ok(`Got ${employees.values.length} employees`);
  } catch (e) {
    fail("Get employees", e);
  }

  // Step 3: Get projects
  let projectId: number | undefined;
  let projectName: string | undefined;
  try {
    const projects = await client.getProjects({ isClosed: false, count: 20 });
    log("Projects", { count: projects.values.length, projects: projects.values.map(p => ({ id: p.id, name: p.name, number: p.number })) });
    if (projects.values.length > 0) {
      projectId = projects.values[0].id;
      projectName = projects.values[0].name || undefined;
    }
    ok(`Got ${projects.values.length} projects`);
  } catch (e) {
    fail("Get projects", e);
  }

  // Step 4: Get activities
  let activityId: number | undefined;
  try {
    const activities = await client.getActivities({ count: 20 });
    log("Activities", { count: activities.values.length, activities: activities.values.map(a => ({ id: a.id, name: a.name, type: a.activityType })) });
    if (activities.values.length > 0) {
      activityId = activities.values[0].id;
    }
    ok(`Got ${activities.values.length} activities`);
  } catch (e) {
    fail("Get activities", e);
  }

  // Step 5: Get activities for timesheet (per project)
  if (projectId) {
    try {
      const tsActivities = await client.getActivitiesForTimeSheet(projectId);
      log(`Activities for timesheet (project ${projectId})`, {
        count: tsActivities.values.length,
        activities: tsActivities.values.map(a => ({ id: a.id, name: a.name })),
      });
      // Prefer a timesheet-specific activity
      if (tsActivities.values.length > 0) {
        activityId = tsActivities.values[0].id;
      }
      ok(`Got ${tsActivities.values.length} activities for timesheet`);
    } catch (e) {
      fail("Get activities for timesheet", e);
    }
  }

  // Step 6: Get projects for timesheet
  try {
    const tsProjects = await client.getProjectsForTimeSheet(employeeId);
    log("Projects for timesheet", {
      count: tsProjects.values.length,
      projects: tsProjects.values.map(p => ({ id: p.id, name: p.name })),
    });
    // Prefer a timesheet-specific project
    if (tsProjects.values.length > 0 && !projectId) {
      projectId = tsProjects.values[0].id;
    }
    ok(`Got ${tsProjects.values.length} projects for timesheet`);
  } catch (e) {
    fail("Get projects for timesheet", e);
  }

  // Step 7: Create timesheet entry (use tomorrow to avoid conflicts with previous test runs)
  let createdEntryId: number | undefined;
  if (employeeId && activityId) {
    try {
      const entry = await client.createTimesheetEntry({
        employee: { id: employeeId },
        activity: { id: activityId },
        project: projectId ? { id: projectId } : undefined,
        date: tomorrow,
        hours: 1.5,
        comment: "Test timeregistrering fra Knud",
      });
      log("Created timesheet entry", entry.value);
      createdEntryId = entry.value.id;
      ok(`Created timesheet entry (id: ${createdEntryId})`);
    } catch (e) {
      // If duplicate, that's expected - find the existing one
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg.includes("allerede registrert") || errorMsg.includes("already")) {
        console.log("  ⚠️  Entry already exists for this date/activity combo - finding it...");
        try {
          const existing = await client.getTimesheetEntries({
            dateFrom: tomorrow,
            dateTo: tomorrow,
            employeeId: employeeId.toString(),
          });
          if (existing.values.length > 0) {
            createdEntryId = existing.values[0].id;
            ok(`Found existing entry (id: ${createdEntryId})`);
          } else {
            fail("Create timesheet entry", "Duplicate reported but no entry found");
          }
        } catch (e2) {
          fail("Create timesheet entry (find existing)", e2);
        }
      } else {
        fail("Create timesheet entry", e);
      }
    }
  } else {
    console.log("  ⏭️  Skipping create (no employeeId or activityId)");
  }

  // Step 8: Get timesheet entries (search ALL employees, broader range)
  try {
    const entries = await client.getTimesheetEntries({
      dateFrom: monthAgo,
      dateTo: tomorrow,
    });
    log("Timesheet entries (last month, all employees)", {
      count: entries.values.length,
      sumAllHours: entries.sumAllHours,
      entries: entries.values.slice(0, 10).map(e => ({
        id: e.id,
        date: e.date,
        hours: e.hours,
        project: e.project?.name,
        activity: e.activity?.name,
        employee: e.employee ? `${e.employee.firstName} ${e.employee.lastName}` : undefined,
        comment: e.comment,
      })),
    });
    ok(`Got ${entries.values.length} timesheet entries (total: ${entries.sumAllHours}h)`);
  } catch (e) {
    fail("Get timesheet entries", e);
  }

  // Step 9: Update timesheet entry
  if (createdEntryId) {
    try {
      const updated = await client.updateTimesheetEntry(createdEntryId, {
        hours: 2.0,
        comment: "Oppdatert test timeregistrering fra Knud",
      });
      log("Updated timesheet entry", {
        id: updated.value.id,
        hours: updated.value.hours,
        comment: updated.value.comment,
      });
      ok(`Updated timesheet entry ${createdEntryId} to 2.0 hours`);
    } catch (e) {
      fail("Update timesheet entry", e);
    }
  }

  // Step 10: Get total hours
  try {
    const totalHours = await client.getTimesheetTotalHours({
      employeeId,
      startDate: monthAgo,
      endDate: today,
    });
    log("Total hours (last month)", totalHours);
    ok(`Got total hours: ${JSON.stringify(totalHours.value)}`);
  } catch (e) {
    fail("Get total hours", e);
  }

  // Step 11: Delete timesheet entry (no version - auto-fetches current)
  if (createdEntryId) {
    try {
      await client.deleteTimesheetEntry(createdEntryId);
      ok(`Deleted timesheet entry ${createdEntryId}`);
    } catch (e) {
      fail("Delete timesheet entry", e);
    }
  }

  // Step 12: Test timesheetAgent summary
  try {
    const agent = createTimesheetAgent(client, companyId);
    const summary = await agent.getTimesheetSummary(monthAgo, tomorrow, employeeId);
    log("Timesheet summary (last month)", {
      totalHours: summary.totalHours,
      projectCount: summary.byProject.length,
      byProject: summary.byProject.map(p => ({
        name: p.projectName,
        hours: p.hours,
        activities: p.activities.map(a => `${a.activityName}: ${a.hours}h`),
      })),
      dayCount: summary.byDate.length,
    });
    ok(`Timesheet summary: ${summary.totalHours}h across ${summary.byProject.length} projects`);
  } catch (e) {
    fail("Timesheet summary (agent)", e);
  }

  // Summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
