/**
 * Timesheet Agent - AI-basert hjelper for timeregistrering i Tripletex
 * 
 * Hjelper med å:
 * - Finne prosjekter og aktiviteter basert på naturlig språk
 * - Registrere timer smart (parse naturlig språk → finn prosjekt → finn aktivitet → opprett)
 * - Lage timeoversikter per prosjekt/aktivitet
 * 
 * Bruker GPT for fuzzy matching av prosjekt- og aktivitetsnavn.
 */

import { generateObject } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { type TripletexClient } from "../client.js";
import { type Project, type Activity, type TimesheetEntry } from "../types.js";

// Cache per selskap (companyId) - 1 uke TTL
const projectCache = new Map<number, { projects: Project[]; timestamp: number }>();
const activityCache = new Map<number, { activities: Activity[]; timestamp: number }>();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 1 uke i millisekunder

// Schema for prosjektmatching
const ProjectMatchSchema = z.object({
  matchedProjectId: z.number().nullable().describe("ID til best matchende prosjekt, eller null hvis ingen passer"),
  confidence: z.enum(["high", "medium", "low"]).describe("Hvor sikker matchingen er"),
  reason: z.string().describe("Kort forklaring (maks 50 tegn)"),
});

// Schema for aktivitetsmatching
const ActivityMatchSchema = z.object({
  matchedActivityId: z.number().nullable().describe("ID til best matchende aktivitet, eller null hvis ingen passer"),
  confidence: z.enum(["high", "medium", "low"]).describe("Hvor sikker matchingen er"),
  reason: z.string().describe("Kort forklaring (maks 50 tegn)"),
});

export interface TimesheetSummary {
  employeeId?: number;
  employeeName?: string;
  dateFrom: string;
  dateTo: string;
  totalHours: number;
  byProject: {
    projectId: number;
    projectName: string;
    hours: number;
    entries: number;
    activities: {
      activityId: number;
      activityName: string;
      hours: number;
      entries: number;
    }[];
  }[];
  byDate: {
    date: string;
    hours: number;
    entries: number;
  }[];
}

export function createTimesheetAgent(client: TripletexClient, companyId: number) {

  /**
   * Hent alle prosjekter med caching
   */
  async function getProjectsWithCache(): Promise<Project[]> {
    const cached = projectCache.get(companyId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.projects;
    }

    const allProjects: Project[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await client.getProjects({ from, count: 1000, isClosed: false });
      allProjects.push(...response.values);
      if (response.values.length < 1000) {
        hasMore = false;
      } else {
        from += 1000;
        if (from > 10000) hasMore = false;
      }
    }

    projectCache.set(companyId, { projects: allProjects, timestamp: now });
    return allProjects;
  }

  /**
   * Hent alle aktiviteter med caching
   */
  async function getActivitiesWithCache(): Promise<Activity[]> {
    const cached = activityCache.get(companyId);
    const now = Date.now();

    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      return cached.activities;
    }

    const allActivities: Activity[] = [];
    let from = 0;
    let hasMore = true;

    while (hasMore) {
      const response = await client.getActivities({ from, count: 1000, isInactive: false });
      allActivities.push(...response.values);
      if (response.values.length < 1000) {
        hasMore = false;
      } else {
        from += 1000;
        if (from > 5000) hasMore = false;
      }
    }

    activityCache.set(companyId, { activities: allActivities, timestamp: now });
    return allActivities;
  }

  /**
   * Finn prosjekt basert på naturlig språk (fuzzy matching med AI)
   */
  async function findProjectByName(query: string): Promise<{ project: Project | null; confidence: string; reason: string }> {
    const projects = await getProjectsWithCache();

    if (projects.length === 0) {
      return { project: null, confidence: "low", reason: "Ingen prosjekter funnet" };
    }

    // Rask eksakt/substring match først
    const lowerQuery = query.toLowerCase();
    const exactMatch = projects.find(p =>
      p.name?.toLowerCase() === lowerQuery ||
      p.number?.toString() === query ||
      p.displayName?.toLowerCase() === lowerQuery
    );
    if (exactMatch) {
      return { project: exactMatch, confidence: "high", reason: "Eksakt match" };
    }

    const substringMatch = projects.find(p =>
      p.name?.toLowerCase().includes(lowerQuery) ||
      p.displayName?.toLowerCase().includes(lowerQuery)
    );
    if (substringMatch) {
      return { project: substringMatch, confidence: "high", reason: "Substring match" };
    }

    // Bruk AI for fuzzy matching
    const projectList = projects
      .map(p => `ID:${p.id} - ${p.number || ""} - ${p.name}${p.displayName ? ` (${p.displayName})` : ""}`)
      .join("\n");

    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: ProjectMatchSchema,
      prompt: `Du er en norsk prosjektassistent. Finn prosjektet som best matcher brukerens beskrivelse.

BRUKERENS SØK: "${query}"

TILGJENGELIGE PROSJEKTER:
${projectList}

REGLER:
- Velg prosjektet som best matcher beskrivelsen
- Bruk fuzzy matching (stavefeil, forkortelser, delvis match)
- Returner null hvis ingen prosjekter passer godt
- confidence "high" = helt sikker, "medium" = sannsynlig, "low" = usikker`,
    });

    if (object.matchedProjectId === null) {
      return { project: null, confidence: object.confidence, reason: object.reason };
    }

    const matched = projects.find(p => p.id === object.matchedProjectId);
    return {
      project: matched || null,
      confidence: object.confidence,
      reason: object.reason,
    };
  }

  /**
   * Finn aktivitet basert på naturlig språk (fuzzy matching med AI)
   */
  async function findActivityByName(
    query: string,
    projectId?: number
  ): Promise<{ activity: Activity | null; confidence: string; reason: string }> {
    // Prøv prosjektspesifikke aktiviteter først, fall tilbake til alle aktiviteter
    let activities: Activity[];
    if (projectId) {
      try {
        const response = await client.getActivitiesForTimeSheet(projectId);
        activities = response.values;
        // Hvis prosjektet ikke har egne aktiviteter, bruk alle aktiviteter
        if (activities.length === 0) {
          activities = await getActivitiesWithCache();
        }
      } catch {
        activities = await getActivitiesWithCache();
      }
    } else {
      activities = await getActivitiesWithCache();
    }

    if (activities.length === 0) {
      return { activity: null, confidence: "low", reason: "Ingen aktiviteter funnet" };
    }

    // Rask eksakt/substring match
    const lowerQuery = query.toLowerCase();
    const exactMatch = activities.find(a =>
      a.name?.toLowerCase() === lowerQuery ||
      a.number?.toString() === query ||
      a.displayName?.toLowerCase() === lowerQuery
    );
    if (exactMatch) {
      return { activity: exactMatch, confidence: "high", reason: "Eksakt match" };
    }

    const substringMatch = activities.find(a =>
      a.name?.toLowerCase().includes(lowerQuery) ||
      a.displayName?.toLowerCase().includes(lowerQuery)
    );
    if (substringMatch) {
      return { activity: substringMatch, confidence: "high", reason: "Substring match" };
    }

    // Bruk AI for fuzzy matching
    const activityList = activities
      .map(a => `ID:${a.id} - ${a.number || ""} - ${a.name}${a.displayName ? ` (${a.displayName})` : ""}`)
      .join("\n");

    const { object } = await generateObject({
      model: openai("gpt-4.1-mini"),
      schema: ActivityMatchSchema,
      prompt: `Du er en norsk prosjektassistent. Finn aktiviteten som best matcher brukerens beskrivelse.

BRUKERENS SØK: "${query}"

TILGJENGELIGE AKTIVITETER:
${activityList}

REGLER:
- Velg aktiviteten som best matcher beskrivelsen
- Bruk fuzzy matching (stavefeil, forkortelser, delvis match)
- Returner null hvis ingen aktiviteter passer godt
- confidence "high" = helt sikker, "medium" = sannsynlig, "low" = usikker`,
    });

    if (object.matchedActivityId === null) {
      return { activity: null, confidence: object.confidence, reason: object.reason };
    }

    const matched = activities.find(a => a.id === object.matchedActivityId);
    return {
      activity: matched || null,
      confidence: object.confidence,
      reason: object.reason,
    };
  }

  /**
   * Lag aggregert timeoversikt for en periode
   */
  async function getTimesheetSummary(
    dateFrom: string,
    dateTo: string,
    employeeId?: number
  ): Promise<TimesheetSummary> {
    const response = await client.getTimesheetEntries({
      dateFrom,
      dateTo,
      employeeId: employeeId?.toString(),
      count: 1000,
    });

    const entries = response.values;

    // Aggreger per prosjekt
    const projectMap = new Map<number, {
      projectId: number;
      projectName: string;
      hours: number;
      entries: number;
      activityMap: Map<number, {
        activityId: number;
        activityName: string;
        hours: number;
        entries: number;
      }>;
    }>();

    // Aggreger per dato
    const dateMap = new Map<string, { date: string; hours: number; entries: number }>();

    let totalHours = 0;
    let employeeName: string | undefined;

    for (const entry of entries) {
      const hours = entry.hours || 0;
      totalHours += hours;

      // Sett ansattnavn fra første entry
      if (!employeeName && entry.employee) {
        employeeName = `${entry.employee.firstName || ""} ${entry.employee.lastName || ""}`.trim();
      }

      // Per prosjekt
      const projId = entry.project?.id || 0;
      const projName = entry.project?.name || "Uten prosjekt";
      if (!projectMap.has(projId)) {
        projectMap.set(projId, {
          projectId: projId,
          projectName: projName,
          hours: 0,
          entries: 0,
          activityMap: new Map(),
        });
      }
      const proj = projectMap.get(projId)!;
      proj.hours += hours;
      proj.entries += 1;

      // Per aktivitet innenfor prosjektet
      const actId = entry.activity?.id || 0;
      const actName = entry.activity?.name || "Ukjent aktivitet";
      if (!proj.activityMap.has(actId)) {
        proj.activityMap.set(actId, {
          activityId: actId,
          activityName: actName,
          hours: 0,
          entries: 0,
        });
      }
      const act = proj.activityMap.get(actId)!;
      act.hours += hours;
      act.entries += 1;

      // Per dato
      const date = entry.date || "ukjent";
      if (!dateMap.has(date)) {
        dateMap.set(date, { date, hours: 0, entries: 0 });
      }
      const day = dateMap.get(date)!;
      day.hours += hours;
      day.entries += 1;
    }

    // Bruk sumAllHours fra API hvis tilgjengelig
    if (response.sumAllHours !== undefined) {
      totalHours = response.sumAllHours;
    }

    return {
      employeeId,
      employeeName,
      dateFrom,
      dateTo,
      totalHours,
      byProject: Array.from(projectMap.values())
        .map(p => ({
          projectId: p.projectId,
          projectName: p.projectName,
          hours: p.hours,
          entries: p.entries,
          activities: Array.from(p.activityMap.values()),
        }))
        .sort((a, b) => b.hours - a.hours),
      byDate: Array.from(dateMap.values())
        .sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  /**
   * Tøm cacher for dette selskapet
   */
  function clearCache() {
    projectCache.delete(companyId);
    activityCache.delete(companyId);
  }

  return {
    getProjectsWithCache,
    getActivitiesWithCache,
    findProjectByName,
    findActivityByName,
    getTimesheetSummary,
    clearCache,
  };
}

export type TimesheetAgent = ReturnType<typeof createTimesheetAgent>;
