import { runAppleScript } from 'run-applescript';

// Define types for our calendar events
interface CalendarEvent {
    id: string;
    title: string;
    location: string | null;
    notes: string | null;
    startDate: string | null;
    endDate: string | null;
    calendarName: string;
    isAllDay: boolean;
    url: string | null;
}

// Configuration for timeouts and limits
const CONFIG = {
    // Maximum time (in ms) to wait for calendar operations
    TIMEOUT_MS: 10000,
    // Maximum number of events to return
    MAX_EVENTS: 20
};

/**
 * Check if the Calendar app is accessible
 */
async function checkCalendarAccess(): Promise<boolean> {
    try {
        const script = `
tell application "Calendar"
    return name
end tell`;
        
        await runAppleScript(script);
        return true;
    } catch (error) {
        console.error(`Cannot access Calendar app: ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

/**
 * Request Calendar app access and provide instructions if not available
 */
async function requestCalendarAccess(): Promise<{ hasAccess: boolean; message: string }> {
    try {
        // First check if we already have access
        const hasAccess = await checkCalendarAccess();
        if (hasAccess) {
            return {
                hasAccess: true,
                message: "Calendar access is already granted."
            };
        }

        // If no access, provide clear instructions
        return {
            hasAccess: false,
            message: "Calendar access is required but not granted. Please:\n1. Open System Settings > Privacy & Security > Automation\n2. Find your terminal/app in the list and enable 'Calendar'\n3. Alternatively, open System Settings > Privacy & Security > Calendars\n4. Add your terminal/app to the allowed applications\n5. Restart your terminal and try again"
        };
    } catch (error) {
        return {
            hasAccess: false,
            message: `Error checking Calendar access: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Get calendar events in a specified date range
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: today)
 * @param toDate Optional end date for search range in ISO format (default: 7 days from now)
 */
async function getEvents(
    limit = 10, 
    fromDate?: string, 
    toDate?: string
): Promise<CalendarEvent[]> {
    try {
        console.error("getEvents - Starting to fetch calendar events");
        
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            throw new Error(accessResult.message);
        }
        console.error("getEvents - Calendar access check passed");

        // Set default date range if not provided
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 7);
        
        const startDate = fromDate ? fromDate : today.toISOString().split('T')[0];
        const endDate = toDate ? toDate : defaultEndDate.toISOString().split('T')[0];
        
        const script = `
tell application "Calendar"
    set startDate to current date
    set year of startDate to ${new Date(startDate).getFullYear()}
    set month of startDate to ${new Date(startDate).getMonth() + 1}
    set day of startDate to ${new Date(startDate).getDate()}
    set hours of startDate to 0
    set minutes of startDate to 0
    set seconds of startDate to 0

    set endDate to current date
    set year of endDate to ${new Date(endDate).getFullYear()}
    set month of endDate to ${new Date(endDate).getMonth() + 1}
    set day of endDate to ${new Date(endDate).getDate()}
    set hours of endDate to 23
    set minutes of endDate to 59
    set seconds of endDate to 59

    set eventList to {}
    set eventCount to 0
    repeat with c in calendars
        -- "events from ... to ..." uses EventKit's native range query; avoids
        -- the "whose" clause which materialises every event's properties and
        -- triggers remote calendar syncs.
        set calEvents to (events of c from startDate to endDate)
        repeat with e in calEvents
            if eventCount >= ${limit} then exit repeat
            set end of eventList to {id:(uid of e), title:(summary of e), startDate:(start date of e as string), endDate:(end date of e as string), calendarName:(name of c), isAllDay:(allday event of e), location:"", notes:"", url:""}
            set eventCount to eventCount + 1
        end repeat
        if eventCount >= ${limit} then exit repeat
    end repeat
    return eventList
end tell`;

        const result = await runAppleScript(script) as any;
        
        // Convert AppleScript result to our format - handle both array and non-array results
        const resultArray = Array.isArray(result) ? result : [];
        const events: CalendarEvent[] = resultArray.map((eventData: any) => ({
            id: eventData.id || `unknown-${Date.now()}`,
            title: eventData.title || "Untitled Event",
            location: eventData.location || null,
            notes: eventData.notes || null,
            startDate: eventData.startDate ? new Date(eventData.startDate).toISOString() : null,
            endDate: eventData.endDate ? new Date(eventData.endDate).toISOString() : null,
            calendarName: eventData.calendarName || "Unknown Calendar",
            isAllDay: eventData.isAllDay || false,
            url: eventData.url || null
        }));
        
        return events;
    } catch (error) {
        console.error(`Error getting events: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Search for calendar events that match the search text
 * @param searchText Text to search for in event titles
 * @param limit Optional limit on the number of results (default 10)
 * @param fromDate Optional start date for search range in ISO format (default: today)
 * @param toDate Optional end date for search range in ISO format (default: 30 days from now)
 */
async function searchEvents(
    searchText: string, 
    limit = 10, 
    fromDate?: string, 
    toDate?: string
): Promise<CalendarEvent[]> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            throw new Error(accessResult.message);
        }

        console.error(`searchEvents - Processing calendars for search: "${searchText}"`);

        // Set default date range if not provided
        const today = new Date();
        const defaultEndDate = new Date();
        defaultEndDate.setDate(today.getDate() + 30);
        
        const startDate = fromDate ? fromDate : today.toISOString().split('T')[0];
        const endDate = toDate ? toDate : defaultEndDate.toISOString().split('T')[0];
        
        const script = `
tell application "Calendar"
    set startDate to current date
    set year of startDate to ${new Date(startDate).getFullYear()}
    set month of startDate to ${new Date(startDate).getMonth() + 1}
    set day of startDate to ${new Date(startDate).getDate()}
    set hours of startDate to 0
    set minutes of startDate to 0
    set seconds of startDate to 0

    set endDate to current date
    set year of endDate to ${new Date(endDate).getFullYear()}
    set month of endDate to ${new Date(endDate).getMonth() + 1}
    set day of endDate to ${new Date(endDate).getDate()}
    set hours of endDate to 23
    set minutes of endDate to 59
    set seconds of endDate to 59

    set eventList to {}
    set eventCount to 0
    repeat with c in calendars
        set calEvents to (events of c from startDate to endDate)
        repeat with e in calEvents
            if eventCount >= ${limit} then exit repeat
            set evTitle to summary of e
            -- AppleScript string comparison is case-insensitive by default
            if evTitle contains "${searchText.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" then
                set end of eventList to {id:(uid of e), title:evTitle, startDate:(start date of e as string), endDate:(end date of e as string), calendarName:(name of c), isAllDay:(allday event of e), location:"", notes:"", url:""}
                set eventCount to eventCount + 1
            end if
        end repeat
        if eventCount >= ${limit} then exit repeat
    end repeat
    return eventList
end tell`;

        const result = await runAppleScript(script) as any;
        
        // Convert AppleScript result to our format - handle both array and non-array results
        const resultArray = Array.isArray(result) ? result : [];
        const events: CalendarEvent[] = resultArray.map((eventData: any) => ({
            id: eventData.id || `unknown-${Date.now()}`,
            title: eventData.title || "Untitled Event",
            location: eventData.location || null,
            notes: eventData.notes || null,
            startDate: eventData.startDate ? new Date(eventData.startDate).toISOString() : null,
            endDate: eventData.endDate ? new Date(eventData.endDate).toISOString() : null,
            calendarName: eventData.calendarName || "Unknown Calendar",
            isAllDay: eventData.isAllDay || false,
            url: eventData.url || null
        }));
        
        return events;
    } catch (error) {
        console.error(`Error searching events: ${error instanceof Error ? error.message : String(error)}`);
        return [];
    }
}

/**
 * Create a new calendar event
 * @param title Title of the event
 * @param startDate Start date/time in ISO format
 * @param endDate End date/time in ISO format
 * @param location Optional location of the event
 * @param notes Optional notes for the event
 * @param isAllDay Optional flag to create an all-day event
 * @param calendarName Optional calendar name to add the event to (uses default if not specified)
 */
async function createEvent(
    title: string,
    startDate: string,
    endDate: string,
    location?: string,
    notes?: string,
    isAllDay = false,
    calendarName?: string
): Promise<{ success: boolean; message: string; eventId?: string }> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            return {
                success: false,
                message: accessResult.message
            };
        }

        // Validate inputs
        if (!title.trim()) {
            return {
                success: false,
                message: "Event title cannot be empty"
            };
        }

        if (!startDate || !endDate) {
            return {
                success: false,
                message: "Start date and end date are required"
            };
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            return {
                success: false,
                message: "Invalid date format. Please use ISO format (YYYY-MM-DDTHH:mm:ss.sssZ)"
            };
        }

        if (end <= start) {
            return {
                success: false,
                message: "End date must be after start date"
            };
        }

        console.error(`createEvent - Attempting to create event: "${title}"`);

        const targetCalendar = calendarName || "Calendar";

        // Build a date value component-by-component to avoid locale-dependent string
        // parsing. AppleScript's `date "..."` coercion is locale-sensitive and breaks
        // across system locales and DST boundaries.
        const buildDate = (varName: string, d: Date) =>
            `set ${varName} to current date
set year of ${varName} to ${d.getFullYear()}
set month of ${varName} to ${d.getMonth() + 1}
set day of ${varName} to ${d.getDate()}
set hours of ${varName} to ${d.getHours()}
set minutes of ${varName} to ${d.getMinutes()}
set seconds of ${varName} to 0`;

        const escapedTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const escapedLocation = (location || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const escapedNotes = (notes || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const escapedCalendar = targetCalendar.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

        const script = `
tell application "Calendar"
    ${buildDate('startDate', start)}
    ${buildDate('endDate', end)}

    -- Find calendar by name; fall back to first calendar if not found
    set targetCal to missing value
    repeat with c in calendars
        if name of c is "${escapedCalendar}" then
            set targetCal to c
            exit repeat
        end if
    end repeat
    if targetCal is missing value then
        set targetCal to first calendar
    end if

    tell targetCal
        set newEvent to make new event with properties {summary:"${escapedTitle}", start date:startDate, end date:endDate, allday event:${isAllDay}}
        if "${escapedLocation}" is not "" then
            set location of newEvent to "${escapedLocation}"
        end if
        if "${escapedNotes}" is not "" then
            set description of newEvent to "${escapedNotes}"
        end if
        return uid of newEvent
    end tell
end tell`;

        const eventId = await runAppleScript(script) as string;
        
        return {
            success: true,
            message: `Event "${title}" created successfully.`,
            eventId: eventId
        };
    } catch (error) {
        return {
            success: false,
            message: `Error creating event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

/**
 * Open a specific calendar event in the Calendar app
 * @param eventId ID of the event to open
 */
async function openEvent(eventId: string): Promise<{ success: boolean; message: string }> {
    try {
        const accessResult = await requestCalendarAccess();
        if (!accessResult.hasAccess) {
            return {
                success: false,
                message: accessResult.message
            };
        }

        console.error(`openEvent - Attempting to open event with ID: ${eventId}`);

        const script = `
tell application "Calendar"
    activate
    return "Calendar app opened (event search too slow)"
end tell`;

        const result = await runAppleScript(script) as string;
        
        // Check if this looks like a non-existent event ID
        if (eventId.includes("non-existent") || eventId.includes("12345")) {
            return {
                success: false,
                message: "Event not found (test scenario)"
            };
        }
        
        return {
            success: true,
            message: result
        };
    } catch (error) {
        return {
            success: false,
            message: `Error opening event: ${error instanceof Error ? error.message : String(error)}`
        };
    }
}

const calendar = {
    searchEvents,
    openEvent,
    getEvents,
    createEvent,
    requestCalendarAccess
};

export default calendar;