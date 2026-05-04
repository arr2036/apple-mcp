import EventKit
import Foundation

// calendar-query list   <from_iso> <to_iso> [limit]
// calendar-query search <text> <from_iso> <to_iso> [limit]
// calendar-query create <calendar_name> <json_fields>
// calendar-query update <event_id> <json_fields>
// calendar-query delete <event_id>
//
// create/update json_fields keys: title, startDate, endDate, isAllDay, location, notes

struct EventJSON: Encodable {
    let id: String
    let title: String
    let startDate: String
    let endDate: String
    let calendarName: String
    let isAllDay: Bool
    let location: String?
    let notes: String?
}

struct CreateFields: Decodable {
    let title: String
    let startDate: String
    let endDate: String
    var isAllDay: Bool?
    var location: String?
    var notes: String?
}

struct UpdateFields: Decodable {
    var title: String?
    var startDate: String?
    var endDate: String?
    var location: String?
    var notes: String?
}

let iso = ISO8601DateFormatter()
iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

func parseDate(_ s: String) -> Date? {
    let ymd = DateFormatter()
    ymd.dateFormat = "yyyy-MM-dd"
    ymd.timeZone = TimeZone.current
    return iso.date(from: s) ?? ymd.date(from: s)
}

func eventToJSON(_ e: EKEvent) -> EventJSON {
    EventJSON(
        id: e.eventIdentifier ?? "",
        title: e.title ?? "",
        startDate: iso.string(from: e.startDate),
        endDate: iso.string(from: e.endDate),
        calendarName: e.calendar.title,
        isAllDay: e.isAllDay,
        location: e.location,
        notes: e.notes
    )
}

func findEvent(_ store: EKEventStore, _ targetId: String) -> EKEvent? {
    let from = Date().addingTimeInterval(-86400 * 365 * 2)
    let to   = Date().addingTimeInterval(86400 * 365 * 2)
    let pred = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    return store.events(matching: pred).first(where: { $0.eventIdentifier == targetId })
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fputs("usage: calendar-query <list|search|create|update|delete> ...\n", stderr)
    exit(1)
}

let store = EKEventStore()
let sema = DispatchSemaphore(value: 0)
var granted = false

if #available(macOS 14.0, *) {
    store.requestFullAccessToEvents { ok, _ in granted = ok; sema.signal() }
} else {
    store.requestAccess(to: .event) { ok, _ in granted = ok; sema.signal() }
}
sema.wait()

guard granted else {
    fputs("calendar access denied\n", stderr)
    exit(1)
}

let encoder = JSONEncoder()

switch args[1] {
case "list":
    guard args.count >= 4 else { fputs("list: need from to\n", stderr); exit(1) }
    let limit = args.count >= 5 ? (Int(args[4]) ?? 20) : 20
    let from = parseDate(args[2]) ?? Date()
    let to   = parseDate(args[3]) ?? Date().addingTimeInterval(86400 * 7)
    let pred = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = Array(store.events(matching: pred).prefix(limit)).map(eventToJSON)
    print(String(data: try! encoder.encode(events), encoding: .utf8)!)

case "search":
    guard args.count >= 5 else { fputs("search: need text from to\n", stderr); exit(1) }
    let text  = args[2].lowercased()
    let limit = args.count >= 6 ? (Int(args[5]) ?? 20) : 20
    let from  = parseDate(args[3]) ?? Date().addingTimeInterval(-86400 * 365)
    let to    = parseDate(args[4]) ?? Date().addingTimeInterval(86400 * 365 * 3)
    let pred  = store.predicateForEvents(withStart: from, end: to, calendars: nil)
    let events = store.events(matching: pred)
        .filter { ($0.title ?? "").lowercased().contains(text) }
        .prefix(limit)
        .map(eventToJSON)
    print(String(data: try! encoder.encode(Array(events)), encoding: .utf8)!)

case "create":
    guard args.count >= 4 else { fputs("create: need calendar_name json\n", stderr); exit(1) }
    let calName = args[2]
    guard let jsonData = args[3].data(using: .utf8),
          let fields = try? JSONDecoder().decode(CreateFields.self, from: jsonData) else {
        fputs("create: invalid JSON\n", stderr); exit(1)
    }
    guard let startDate = parseDate(fields.startDate),
          let endDate   = parseDate(fields.endDate) else {
        fputs("create: invalid dates\n", stderr); exit(1)
    }
    let cal = store.calendars(for: .event).first(where: { $0.title == calName })
              ?? store.defaultCalendarForNewEvents
    guard let targetCal = cal else {
        fputs("create: no calendar available\n", stderr); exit(1)
    }
    let event = EKEvent(eventStore: store)
    event.calendar  = targetCal
    event.title     = fields.title
    event.startDate = startDate
    event.endDate   = endDate
    event.isAllDay  = fields.isAllDay ?? false
    if let loc   = fields.location { event.location = loc }
    if let notes = fields.notes    { event.notes    = notes }
    do {
        try store.save(event, span: .thisEvent, commit: true)
        print(event.eventIdentifier ?? "")
    } catch {
        fputs("create failed: \(error)\n", stderr); exit(1)
    }

case "update":
    guard args.count >= 4 else { fputs("update: need event_id json\n", stderr); exit(1) }
    guard let jsonData = args[3].data(using: .utf8),
          let fields = try? JSONDecoder().decode(UpdateFields.self, from: jsonData) else {
        fputs("update: invalid JSON\n", stderr); exit(1)
    }
    guard let event = findEvent(store, args[2]) else {
        fputs("event not found\n", stderr); exit(1)
    }
    if let title = fields.title               { event.title     = title }
    if let s = fields.startDate, let d = parseDate(s) { event.startDate = d }
    if let s = fields.endDate,   let d = parseDate(s) { event.endDate   = d }
    if let loc   = fields.location            { event.location  = loc }
    if let notes = fields.notes               { event.notes     = notes }
    do {
        try store.save(event, span: .thisEvent, commit: true)
        print(event.eventIdentifier ?? "")
    } catch {
        fputs("update failed: \(error)\n", stderr); exit(1)
    }

case "delete":
    guard args.count >= 3 else { fputs("delete: need event_id\n", stderr); exit(1) }
    guard let event = findEvent(store, args[2]) else {
        fputs("event not found\n", stderr); exit(1)
    }
    do {
        try store.remove(event, span: .thisEvent, commit: true)
        print("deleted")
    } catch {
        fputs("delete failed: \(error)\n", stderr); exit(1)
    }

default:
    fputs("unknown command: \(args[1])\n", stderr)
    exit(1)
}
